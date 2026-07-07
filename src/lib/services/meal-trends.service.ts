/**
 * US-2637 — Tendances de repas (« mealtime patterns »).
 *
 * Deux projections **serveur** (aucun calcul clinique au front) sur les repas
 * insuline (`DiabetesEvent` avec `insulinMeal`) + relevés CGM/BGM :
 *  - `alignedCurve` : par moment (Matin/Midi/Soir/Nuit), courbe glycémique
 *    moyenne alignée sur l'heure du repas (t=0), tranches de 15 min sur
 *    [−60, +180] + moyennes pré / après (PPG 2 h) / pic.
 *  - `dailyJournal` : 1 entrée par repas (jour × moment) avec pré, après (PPG
 *    2 h), glucides, bolus — **numérique uniquement** : le texte libre repas
 *    (`DiabetesEvent.comment`, `GlycemiaEntry.mealDescription`) n'est **jamais
 *    lu ni sélectionné** par cette projection (AC-6 « non exposé »).
 *
 * Définitions cliniques : validées par `medical-domain-validator` (cf. US-2637).
 * Points de sécurité appliqués : unité **mg/dL** canonique interne ; heure locale
 * **Europe/Paris** (jamais le fuseau serveur) ; plage de relevés valides
 * **agrégat** 0.20–6.00 g/L (une hypo post-prandiale sévère reste visible) ; delta
 * **signé** (garde le risque d'hypo post-prandiale) ; excursion bornée au
 * **prochain apport glucidique** ; **pic non évaluable** si fenêtre < 90 min ;
 * **aucune interpolation** (BGM : pic seulement sur relevé réel) ; seuils
 * post-prandiaux **pathology-aware** (`getCgmDefaults`) ; libellés **non
 * prescriptifs** (l'onglet n'émet jamais d'`AdjustmentProposal`).
 */

import { DiabetesEventType, type Pathology } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { decimalToNumber } from "@/lib/db/decimal"
import { auditService, type AuditContext } from "@/lib/services/audit.service"
import { getCgmDefaults } from "@/lib/services/objectives.service"
import { CGM_AGGREGATE_RANGE_GL, MEAL_TREND, CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
import { DAY_MOMENTS, momentForHour, momentBoundsFrom, type DayMoment } from "@/lib/day-moments"

const CLINICAL_TZ = "Europe/Paris"
const DAY_MS = 24 * 3600_000
const MIN_MS = 60_000
/** Plage physiologique valide en mg/dL (= CGM_AGGREGATE_RANGE_GL × 100). */
const VALID_MIN_MGDL = CGM_AGGREGATE_RANGE_GL.MIN * 100
const VALID_MAX_MGDL = CGM_AGGREGATE_RANGE_GL.MAX * 100

/** Moments affichés — source unique `@/lib/day-moments`. */
export type MealMoment = DayMoment
const MOMENTS = DAY_MOMENTS

interface Reading { t: number; mgdl: number } // t = epoch ms

export interface AlignedBucket {
  /** Décalage au repas en minutes (multiple de 15, ∈ [−60, 180]). */
  offsetMin: number
  avgMgdl: number
}
export interface MomentCurve {
  moment: MealMoment
  /** Repas appariés (pré + ≥1 post) contribuant à la courbe. */
  pairedMeals: number
  /** `true` si `pairedMeals < MIN_PAIRED_MEALS` → « données insuffisantes ». */
  insufficient: boolean
  buckets: AlignedBucket[]
  avgPreMgdl: number | null
  /** Moyenne PPG 2 h (« après »). */
  avgPostMgdl: number | null
  avgPeakMgdl: number | null
  /** Plafond post-prandial pathology-aware (mg/dL) — bord haut de cible. */
  targetHighMgdl: number
  /** `avgPost` au-dessus du plafond → flag descriptif (jamais prescriptif). */
  highExcursion: boolean
}
export interface AlignedCurveResult {
  period: { days: number }
  source: "cgm" | "bgm"
  moments: MomentCurve[]
}

export interface JournalMeal {
  mealId: string
  /** Jour calendaire Europe/Paris, `YYYY-MM-DD`. */
  dayIso: string
  /** Heure locale (0–23, Europe/Paris) de l'instant réel du repas — pour bucketer à l'heure
   *  exacte sur les créneaux ICR (`findSlotForHour`), pas au moment (US-2651). */
  localHour: number
  moment: MealMoment
  preMgdl: number | null
  /** Après = PPG 2 h. */
  postMgdl: number | null
  /** Creux (nadir) glycémique post-prandial en mg/dL sur `[t0, min(prochain glucide, t0+300 min)]`
   *  — fourni à la garde hypo de `analyzeIcrSlot` (creux à ~3-4 h invisible à la PPG 2 h, US-2651).
   *  `null` si aucun relevé dans la fenêtre. Déjà borné physiologiquement (≥ 0,20 g/L) par `loadContext`. */
  nadirMgdl: number | null
  carbs: number | null
  bolus: number | null
}

/**
 * Tendance à jeun par jour (US-2651 basal) — une entrée par **nuit/jour** (aligné 1:1) :
 * `fastingMgdl` = dernier relevé pré-petit-déjeuner (pilote la moyenne/direction basale) ;
 * `nocturnalNadirMgdl` = **min CGM** sur l'intervalle de jeûne nocturne inter-prandial
 * `[dernier apport glucidique du soir, petit-déjeuner]` (nourrit la garde hypo — effet Somogyi).
 * Fenêtre **contiguë** avec le relevé à jeun (les deux se terminent au petit-déjeuner). En mg/dL.
 */
export interface FastingDay {
  dayIso: string
  fastingMgdl: number | null
  nocturnalNadirMgdl: number | null
}

/**
 * Correction appariée pour la titration ISF (US-2651) — une **correction propre** (pas de repas, IOB
 * nul, non plafonnée, standard) dont le résultat est mesurable et non confondu : `postGlucoseGl` =
 * glycémie settled à `INSULIN_ACTION_MAX` (5 h) (pilote la direction ISF), `nadirGl` = creux sur la
 * fenêtre d'action (garde hypo tardive), `targetGl` = cible au moment de la correction. `localHour` =
 * heure locale de la correction (attribution au créneau ISF appliqué). Tout en g/L.
 */
export interface CorrectionPoint {
  localHour: number
  postGlucoseGl: number
  targetGl: number
  nadirGl: number | null
}

// ── Helpers fuseau / moment ──────────────────────────────────────────────────

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLINICAL_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
})
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLINICAL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
})

/** Heure locale (Europe/Paris) d'un instant, en heures décimales [0,24). */
function localHour(ms: number): number {
  const p = partsFmt.formatToParts(new Date(ms))
  const h = Number(p.find((x) => x.type === "hour")?.value ?? "0") % 24
  const m = Number(p.find((x) => x.type === "minute")?.value ?? "0")
  return h + m / 60
}
/** Jour calendaire local `YYYY-MM-DD`. */
function localDay(ms: number): string {
  return dayFmt.format(new Date(ms)) // en-CA → ISO
}

/**
 * Instant en **espace heure-murale locale** (Europe/Paris projeté comme si UTC),
 * pour apparier des relevés BGM (`date` + `time` mural, sans instant réel) à un
 * repas (`Timestamptz`). En travaillant meal ET relevés dans ce même espace
 * mural, l'écart pré/post est correct et **DST-safe** sur la courte fenêtre du
 * repas (US-2639 — corrige le décalage de fuseau reporté de la revue #613).
 */
function localWallMs(ms: number): number {
  const [y, mo, d] = localDay(ms).split("-").map(Number)
  const p = partsFmt.formatToParts(new Date(ms))
  const h = Number(p.find((x) => x.type === "hour")?.value ?? "0") % 24
  const min = Number(p.find((x) => x.type === "minute")?.value ?? "0")
  return Date.UTC(y, mo - 1, d, h, min)
}


/** Dernier relevé dans `(min, max]` le plus proche de `max` (ou `null`). */
function lastReadingIn(readings: Reading[], min: number, max: number): number | null {
  let best: Reading | null = null
  for (const r of readings) {
    if (r.t > min && r.t <= max && (best === null || r.t > best.t)) best = r
  }
  return best?.mgdl ?? null
}
/** Relevé le plus proche de `center` dans `[center−tol, center+tol]`, borné à
 *  `maxT` (fin de la fenêtre d'excursion — ne pas capter un relevé post-snack). */
function closestReading(readings: Reading[], center: number, tol: number, maxT: number): number | null {
  let best: Reading | null = null
  for (const r of readings) {
    if (r.t >= center - tol && r.t <= center + tol && r.t <= maxT) {
      if (best === null || Math.abs(r.t - center) < Math.abs(best.t - center)) best = r
    }
  }
  return best?.mgdl ?? null
}

// ── Chargement des données (scopé patient + plage valide) ────────────────────

async function loadContext(patientId: number, days: number, source: "cgm" | "bgm") {
  const to = Date.now()
  const from = to - days * DAY_MS
  const fromDate = new Date(from)
  const toDate = new Date(to)

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, deletedAt: null },
    select: { pathology: true, pregnancyMode: true },
  })
  const pathology = (patient?.pathology ?? undefined) as Pathology | undefined
  // Revue #613 : le durcissement post-prandial grossesse s'applique aussi à une
  // patiente `pregnancyMode` NON typée GD (sinon plafond 180 au lieu de 140 →
  // sous-alerte dans la population la plus critique). On force les cibles GD.
  const isPregnancy = patient?.pregnancyMode === true || pathology === "GD"
  const thresholds = getCgmDefaults(isPregnancy ? "GD" : pathology) // g/L

  const dayMoments = await prisma.userDayMoment.findMany({
    where: { user: { patient: { id: patientId } } },
    select: { type: true, startTime: true, endTime: true },
  })
  const bounds = momentBoundsFrom(dayMoments)

  // Base temporelle d'APPARIEMENT repas↔relevé : instant réel en CGM, heure
  // murale locale en BGM (relevés sans instant réel). moment/jour restent, eux,
  // dérivés de l'instant réel du repas (`localHour`/`localDay`).
  const toMatchMs = (instantMs: number) => (source === "bgm" ? localWallMs(instantMs) : instantMs)

  // Repas insuline (ancres) — numérique uniquement, pas de texte libre.
  const mealRows = await prisma.diabetesEvent.findMany({
    where: {
      patientId,
      eventTypes: { has: DiabetesEventType.insulinMeal },
      eventDate: { gte: fromDate, lte: toDate },
    },
    select: { id: true, eventDate: true, carbohydrates: true, bolusDose: true },
    orderBy: { eventDate: "asc" },
  })
  const meals = mealRows.map((m) => ({ ...m, matchMs: toMatchMs(m.eventDate.getTime()) }))

  // Tout apport glucidique (repas OU snack) pour borner la fenêtre d'excursion.
  const carbEvents = await prisma.diabetesEvent.findMany({
    where: { patientId, carbohydrates: { gt: 0 }, eventDate: { gte: fromDate, lte: toDate } },
    select: { eventDate: true },
    orderBy: { eventDate: "asc" },
  })
  const carbTimes = carbEvents.map((e) => toMatchMs(e.eventDate.getTime()))

  // Relevés (mg/dL canonique), plage agrégat valide.
  let readings: Reading[]
  if (source === "bgm") {
    const rows = await prisma.glycemiaEntry.findMany({
      where: { patientId, date: { gte: fromDate, lte: toDate } },
      select: { date: true, time: true, glycemiaGl: true, glycemiaMgdl: true },
    })
    readings = rows
      .map((r) => {
        const gl = r.glycemiaGl !== null ? decimalToNumber(r.glycemiaGl) : null
        const mgdl = gl !== null ? gl * 100 : r.glycemiaMgdl !== null ? decimalToNumber(r.glycemiaMgdl) : null
        if (mgdl === null) return null
        // Relevé sans heure (`time` NULL) → aucune heure murale exploitable pour
        // l'appariement au repas → exclu (revue #617 B2 : sinon il retomberait à
        // minuit et apparierait spurieusement un repas proche de minuit).
        if (!r.time) return null
        // `time` = heure MURALE locale (Time sans fuseau) ; `date` = jour
        // calendaire. On les combine en **espace heure-murale locale** (même
        // base que `matchMs` des repas en BGM → appariement pré/post correct).
        const d = new Date(r.date)
        const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), t2h(r.time), t2m(r.time))
        return { t, mgdl }
      })
      .filter((x): x is Reading => x !== null && x.mgdl >= VALID_MIN_MGDL && x.mgdl <= VALID_MAX_MGDL)
  } else {
    const rows = await prisma.cgmEntry.findMany({
      where: {
        patientId,
        timestamp: { gte: fromDate, lte: toDate },
        valueGl: { gte: CGM_AGGREGATE_RANGE_GL.MIN, lte: CGM_AGGREGATE_RANGE_GL.MAX },
      },
      select: { valueGl: true, timestamp: true },
      orderBy: { timestamp: "asc" },
    })
    readings = rows.map((r) => ({ t: r.timestamp.getTime(), mgdl: decimalToNumber(r.valueGl) * 100 }))
  }

  const targetHighMgdl = Math.round(thresholds.ok * 100)
  return { meals, carbTimes, readings, bounds, targetHighMgdl, isPregnancy, days }
}

const t2h = (t: Date) => t.getUTCHours()
const t2m = (t: Date) => t.getUTCMinutes()

/** Fin de la fenêtre d'excursion : `min(t0+180, prochain apport glucidique)`. */
function excursionWindowEnd(t0: number, carbTimes: number[]): number {
  const cap = t0 + MEAL_TREND.EXCURSION_MAX_MIN * MIN_MS
  let next = Infinity
  for (const c of carbTimes) if (c > t0 && c < next) next = c
  return Math.min(cap, next)
}

/** US-2651 basal — fenêtre pré-petit-déjeuner (min) pour le relevé à jeun. */
const PRE_BREAKFAST_WINDOW_MIN = 90
/** US-2651 basal — plafond de remontée du jeûne nocturne (min) si aucun apport glucidique du soir
 *  identifié (patient à jeun) : ~12 h, borne l'intervalle inter-prandial. */
const MAX_NOCTURNAL_WINDOW_MIN = 720
/** US-2651 basal — seuil « repas substantiel » (g) pour ancrer le jeûne nocturne. Un **resucrage**
 *  d'hypo (petit glucide nocturne) NE doit PAS tronquer la fenêtre nadir : sinon l'hypo qui a motivé
 *  le resucrage sortirait de la fenêtre → garde Somogyi masquée (validé medical #679). */
const NOCTURNAL_ANCHOR_MIN_CARB_G = 20

type MealContext = Awaited<ReturnType<typeof loadContext>>

/**
 * Tendance à jeun (US-2651 basal). Une entrée par jour ayant un **petit-déjeuner** identifié (premier
 * repas du moment « morning »). `fastingMgdl` = dernier relevé dans `[petit-déj − 90 min, petit-déj]`.
 * `nocturnalNadirMgdl` = min CGM sur `[dernier REPAS substantiel (≥ seuil) avant le petit-déj, capé
 * à −12 h ; petit-déj]` — jeûne nocturne inter-prandial. Contigu avec le relevé à jeun **pour une nuit
 * normale** (un repas < 90 min avant le petit-déj peut raccourcir la fenêtre nadir — nuit « pas vraiment
 * à jeun »). Un élément **par nuit** (1:1 avec les jours). Trié récent d'abord. Un patient **sautant le
 * petit-déjeuner** (pas de repas « morning ») → aucune entrée ce jour-là (fail-closed : pas d'ancre de
 * fin de jeûne ; réduit `supportingEvents`, jamais la direction — limite connue, cf. catalogue).
 */
function computeFastingTrend(c: MealContext): FastingDay[] {
  // Petit-déjeuner par jour = premier repas du moment « morning ». Jour/moment dérivés de l'INSTANT
  // RÉEL (`eventDate`) comme `computeJournal` (cohérence CGM/BGM) ; `matchMs` sert aux fenêtres de relevés.
  const breakfastByDay = new Map<string, number>() // dayIso (instant réel) → matchMs (fenêtres)
  for (const m of c.meals) {
    const realMs = m.eventDate.getTime()
    if (momentForHour(localHour(realMs), c.bounds) !== "morning") continue
    const day = localDay(realMs)
    const prev = breakfastByDay.get(day)
    if (prev === undefined || m.matchMs < prev) breakfastByDay.set(day, m.matchMs)
  }
  // Ancres du jeûne nocturne = repas SUBSTANTIELS (≥ seuil) — un resucrage d'hypo (petit glucide) ne
  // doit PAS tronquer la fenêtre nadir, sinon l'hypo qui l'a motivé sortirait de la fenêtre (Somogyi
  // masquée). On n'utilise donc PAS `c.carbTimes` (tout glucide) mais les repas au-dessus du seuil.
  const substantialMealMs = c.meals
    .filter((m) => m.carbohydrates != null && Number(m.carbohydrates) >= NOCTURNAL_ANCHOR_MIN_CARB_G)
    .map((m) => m.matchMs)
  const out: FastingDay[] = []
  for (const [dayIso, breakfastMs] of breakfastByDay) {
    const fastingMgdl = lastReadingIn(c.readings, breakfastMs - PRE_BREAKFAST_WINDOW_MIN * MIN_MS, breakfastMs)
    // Dernier REPAS substantiel avant le petit-déj (dîner/collation) ; borné à −12 h.
    let lastMeal = -Infinity
    for (const t of substantialMealMs) if (t < breakfastMs && t > lastMeal) lastMeal = t
    const nocturnalStart = Math.max(lastMeal, breakfastMs - MAX_NOCTURNAL_WINDOW_MIN * MIN_MS)
    const nocturnalNadirMgdl = minReadingIn(c.readings, nocturnalStart, breakfastMs)
    out.push({ dayIso, fastingMgdl, nocturnalNadirMgdl })
  }
  return out.sort((a, b) => (a.dayIso < b.dayIso ? 1 : a.dayIso > b.dayIso ? -1 : 0))
}

/** Bolus délivré, numérisé (Decimal → number) pour l'appariement des corrections ISF. */
interface CorrectionBolus {
  t: number // instant (ms)
  correctionDose: number
  mealBolus: number
  inputCarbs: number
  iob: number
  inputGl: number | null
  targetGl: number // g/L (targetGlucoseMgdl / 100)
  wasCapped: boolean
  extendedDurationHours: number | null
  extendedImmediatePct: number | null
}

/**
 * Appariement des CORRECTIONS pour la titration ISF (US-2651 ISF slice 2, validé medical). Ne retient
 * qu'une correction **propre** dont le résultat est mesurable et **non confondu** :
 * - Filtre 1 (propreté) : `correctionDose > 0`, pas de repas (`mealBolus == 0`, `inputCarbs == 0`), IOB
 *   nul, **non plafonnée** (`wasCapped == false` — une dose plafonnée sous-dose → lecture haute → baisse
 *   ISF → hypo), **bolus standard** (pas d'étalé/dual-wave), `inputGl` connu.
 * - Filtre 2 (signal) : élévation `inputGl − targetGl ≥ CORRECTION_MIN_ELEVATION_GL` (0,30 g/L, au-dessus
 *   du bruit CGM) ET `correctionDose ≥ FIXED_DOSE_MIN` (0,5 U).
 * - Filtre 3 (confondeurs) : aucun glucide dans `[t0−COB_LOOKBACK, t0)` (COB), aucun glucide NI bolus
 *   dans `(t0, t0+INSULIN_ACTION_MAX]` (repas/insuline empilée qui fausserait le résultat).
 * Résultat : `postGlucoseGl` = relevé **settled à 5 h** ± tol (fail-closed si absent — pas de fallback,
 * lire à 5 h évite le biais « encore en baisse » vers plus d'insuline) ; `nadirGl` = min CGM sur la
 * fenêtre. `localHour` = heure de la correction (créneau ISF **appliqué**).
 */
function computeCorrectionTrend(c: MealContext, boluses: CorrectionBolus[]): CorrectionPoint[] {
  const B = CLINICAL_BOUNDS
  const MAX_MS = B.INSULIN_ACTION_MAX * 3_600_000
  const TOL_MS = B.CORRECTION_SETTLE_TOL_MIN * MIN_MS
  const COB_MS = B.CORRECTION_COB_LOOKBACK_MIN * MIN_MS
  const bolusTimes = boluses.map((b) => b.t) // toutes les injections délivrées (source d'empilement)
  const out: CorrectionPoint[] = []
  for (const b of boluses) {
    // Filtre 1 — correction propre.
    if (b.correctionDose <= 0 || b.mealBolus !== 0 || b.inputCarbs > 0 || b.iob !== 0 || b.wasCapped) continue
    if (b.extendedDurationHours !== null || (b.extendedImmediatePct !== null && b.extendedImmediatePct !== 100)) continue
    if (b.inputGl === null) continue
    // Filtre 2 — signal au-dessus du bruit.
    if (b.inputGl - b.targetGl < B.CORRECTION_MIN_ELEVATION_GL) continue
    if (b.correctionDose < B.FIXED_DOSE_MIN) continue
    // Filtre 3 — confondeurs (COB avant + glucide/bolus intra-fenêtre).
    const t0 = b.t
    const windowEnd = t0 + MAX_MS
    if (c.carbTimes.some((ct) => ct >= t0 - COB_MS && ct < t0)) continue
    if (c.carbTimes.some((ct) => ct > t0 && ct <= windowEnd)) continue
    if (bolusTimes.some((bt) => bt > t0 && bt <= windowEnd)) continue
    // Résultat settled à 5 h ± tol (fail-closed) + nadir sur la fenêtre.
    const postMgdl = closestReading(c.readings, windowEnd, TOL_MS, windowEnd + TOL_MS)
    if (postMgdl === null) continue
    const nadirMgdl = minReadingIn(c.readings, t0, windowEnd)
    out.push({
      localHour: localHour(t0),
      postGlucoseGl: postMgdl / 100,
      targetGl: b.targetGl,
      nadirGl: nadirMgdl !== null ? nadirMgdl / 100 : null,
    })
  }
  return out
}

// ── Service ──────────────────────────────────────────────────────────────────

export const mealtimePattern = {
  /** Courbes glycémiques moyennes alignées sur l'heure du repas, par moment. */
  async alignedCurve(
    patientId: number, period: string, auditUserId: number | null, ctx?: AuditContext,
    opts?: { source?: "cgm" | "bgm"; skipAudit?: boolean },
  ): Promise<AlignedCurveResult> {
    const source = opts?.source ?? "cgm"
    const days = parsePeriodDays(period)
    const c = await loadContext(patientId, days, source)
    if (!opts?.skipAudit) await auditRead(auditUserId, patientId, period, days, source, "mealtimePatterns", ctx)
    return computeAligned(c, days, source)
  },

  /** Journal repas : 1 entrée par repas (jour × moment), numérique. */
  async dailyJournal(
    patientId: number, period: string, auditUserId: number | null, ctx?: AuditContext,
    opts?: { source?: "cgm" | "bgm"; skipAudit?: boolean },
  ): Promise<JournalMeal[]> {
    const source = opts?.source ?? "cgm"
    const days = parsePeriodDays(period)
    const c = await loadContext(patientId, days, source)
    if (!opts?.skipAudit) await auditRead(auditUserId, patientId, period, days, source, "mealtimeJournal", ctx)
    return computeJournal(c)
  },

  /**
   * Tendance à jeun (US-2651 basal) : par jour, glycémie pré-petit-déjeuner + nadir nocturne
   * inter-prandial (garde hypo Somogyi). Une entrée par nuit, alignée 1:1 avec les jours.
   */
  async fastingTrend(
    patientId: number, period: string, auditUserId: number | null, ctx?: AuditContext,
    opts?: { source?: "cgm" | "bgm"; skipAudit?: boolean },
  ): Promise<FastingDay[]> {
    const source = opts?.source ?? "cgm"
    const days = parsePeriodDays(period)
    const c = await loadContext(patientId, days, source)
    if (!opts?.skipAudit) await auditRead(auditUserId, patientId, period, days, source, "fastingTrend", ctx)
    return computeFastingTrend(c)
  },

  /**
   * Appariement des corrections (US-2651 ISF) : par correction propre, glycémie post-correction settled
   * + nadir tardif, pour la titration ISF. CGM uniquement (le nadir tardif exige une série continue).
   * Voir `computeCorrectionTrend` pour les filtres cliniques (propreté / signal / confondeurs).
   */
  async correctionTrend(
    patientId: number, period: string, auditUserId: number | null, ctx?: AuditContext,
    opts?: { skipAudit?: boolean },
  ): Promise<CorrectionPoint[]> {
    const days = parsePeriodDays(period)
    const c = await loadContext(patientId, days, "cgm")
    const to = Date.now()
    const rows = await prisma.bolusCalculationLog.findMany({
      where: { patientId, wasDelivered: true, calculatedAt: { gte: new Date(to - days * DAY_MS), lte: new Date(to) } },
      select: {
        calculatedAt: true, inputGlucoseGl: true, targetGlucoseMgdl: true, mealBolus: true,
        inputCarbsGrams: true, iobValue: true, correctionDose: true, wasCapped: true,
        extendedDurationHours: true, extendedImmediatePct: true,
      },
      orderBy: { calculatedAt: "asc" },
    })
    const boluses: CorrectionBolus[] = rows.map((b) => ({
      t: b.calculatedAt.getTime(),
      correctionDose: decimalToNumber(b.correctionDose),
      mealBolus: decimalToNumber(b.mealBolus),
      inputCarbs: b.inputCarbsGrams != null ? decimalToNumber(b.inputCarbsGrams) : 0,
      iob: decimalToNumber(b.iobValue),
      inputGl: b.inputGlucoseGl != null ? decimalToNumber(b.inputGlucoseGl) : null,
      targetGl: decimalToNumber(b.targetGlucoseMgdl) / 100,
      wasCapped: b.wasCapped,
      extendedDurationHours: b.extendedDurationHours != null ? decimalToNumber(b.extendedDurationHours) : null,
      extendedImmediatePct: b.extendedImmediatePct != null ? decimalToNumber(b.extendedImmediatePct) : null,
    }))
    if (!opts?.skipAudit) await auditRead(auditUserId, patientId, period, days, "cgm", "correctionTrend", ctx)
    return computeCorrectionTrend(c, boluses)
  },

  /**
   * Courbes + journal en **un seul chargement** (le contenu de l'onglet). Une
   * lecture DIABETES_EVENT auditée, deux projections.
   */
  async mealTrends(
    patientId: number, period: string, auditUserId: number, ctx?: AuditContext,
    opts?: { source?: "cgm" | "bgm" },
  ): Promise<{ curve: AlignedCurveResult; journal: JournalMeal[] }> {
    const source = opts?.source ?? "cgm"
    const days = parsePeriodDays(period)
    const c = await loadContext(patientId, days, source)
    await auditRead(auditUserId, patientId, period, days, source, "mealtimePatterns", ctx)
    return { curve: computeAligned(c, days, source), journal: computeJournal(c) }
  },
}

/** Projection « courbes alignées » à partir du contexte chargé (pure). */
function computeAligned(c: MealContext, days: number, source: "cgm" | "bgm"): AlignedCurveResult {
    // BGM (US-2639) : pas de courbe alignée — relevés capillaires épars, la vue
    // n'affiche que le carnet avant/après. On garantit AC-2 « pas de courbe
    // interpolée » AU NIVEAU SERVICE (revue #617 B3), pas seulement côté UI.
    if (source === "bgm") return { period: { days }, source, moments: [] }

    // Buckets par moment : offset(min) → [valeurs].
    const perMoment = new Map<MealMoment, { buckets: Map<number, number[]>; pre: number[]; post: number[]; peak: number[] }>()
    for (const m of MOMENTS) perMoment.set(m, { buckets: new Map(), pre: [], post: [], peak: [] })

    for (const meal of c.meals) {
      // Appariement relevés dans la base `matchMs` (réel CGM / mural BGM) ;
      // moment dérivé de l'instant réel du repas.
      const t0 = meal.matchMs
      const moment = momentForHour(localHour(meal.eventDate.getTime()), c.bounds)
      const agg = perMoment.get(moment)!

      const pre = lastReadingIn(c.readings, t0 - MEAL_TREND.PRE_WINDOW_MIN * MIN_MS, t0)
      const winEnd = excursionWindowEnd(t0, c.carbTimes)
      const windowMin = (winEnd - t0) / MIN_MS
      // Pic non évaluable si fenêtre tronquée (< 90 min) — jamais un pic bas trompeur.
      // Pic ET post PPG 2 h invalidés si la fenêtre est tronquée par un apport
      // glucidique intercurrent (< 90 min) — sinon on attribuerait au repas
      // indexé une excursion appartenant au snack suivant (revue #613, M-1).
      const evaluable = windowMin >= MEAL_TREND.EXCURSION_MIN_WINDOW_MIN
      const peak = evaluable ? maxReadingIn(c.readings, t0, winEnd) : null
      // `winEnd` borne aussi le post PPG 2 h : un relevé après un snack
      // intercurrent (fenêtre tronquée partielle 90–180 min) n'est pas capté
      // (cohérent avec le bornage du pic — revue #613, R1).
      const post2h = evaluable
        ? closestReading(c.readings, t0 + MEAL_TREND.POST_2H_CENTER_MIN * MIN_MS, MEAL_TREND.POST_2H_TOL_MIN * MIN_MS, winEnd)
        : null

      // Repas apparié pour la courbe = pré ET (post OU pic) réels.
      if (pre !== null && (post2h !== null || peak !== null)) {
        agg.pre.push(pre)
        if (post2h !== null) agg.post.push(post2h)
        if (peak !== null) agg.peak.push(peak)
        // Relevés alignés t−t0 ∈ [−60, +180] → buckets de 15 min. Bornés à
        // `winEnd` : au-delà du prochain apport glucidique, les relevés
        // appartiennent au repas suivant (R1) — pas de contamination de la queue.
        for (const r of c.readings) {
          if (r.t > winEnd) continue
          const off = (r.t - t0) / MIN_MS
          if (off < MEAL_TREND.ALIGN_START_MIN || off > MEAL_TREND.ALIGN_END_MIN) continue
          const b = Math.floor(off / MEAL_TREND.BUCKET_SIZE_MIN) * MEAL_TREND.BUCKET_SIZE_MIN
          const arr = agg.buckets.get(b) ?? []
          arr.push(r.mgdl)
          agg.buckets.set(b, arr)
        }
      }
    }

    const moments: MomentCurve[] = MOMENTS.map((moment) => {
      const agg = perMoment.get(moment)!
      const pairedMeals = agg.pre.length
      const insufficient = pairedMeals < MEAL_TREND.MIN_PAIRED_MEALS
      const buckets: AlignedBucket[] = insufficient
        ? []
        : [...agg.buckets.entries()]
            .filter(([, arr]) => arr.length >= MEAL_TREND.BUCKET_MIN_READINGS)
            .sort((a, b) => a[0] - b[0])
            .map(([offsetMin, arr]) => ({ offsetMin, avgMgdl: Math.round(mean(arr)) }))
      const avgPost = agg.post.length ? Math.round(mean(agg.post)) : null
      return {
        moment,
        pairedMeals,
        insufficient,
        buckets,
        avgPreMgdl: insufficient || !agg.pre.length ? null : Math.round(mean(agg.pre)),
        avgPostMgdl: insufficient ? null : avgPost,
        avgPeakMgdl: insufficient || !agg.peak.length ? null : Math.round(mean(agg.peak)),
        targetHighMgdl: c.targetHighMgdl,
        highExcursion: !insufficient && avgPost !== null && avgPost > c.targetHighMgdl,
      }
    })

    return { period: { days }, source, moments }
}

/** Projection « journal repas » à partir du contexte chargé (pure). */
function computeJournal(c: MealContext): JournalMeal[] {
    const out: JournalMeal[] = c.meals.map((meal) => {
      // Appariement dans la base `matchMs` ; jour/moment via l'instant réel.
      const t0 = meal.matchMs
      const realMs = meal.eventDate.getTime()
      const pre = lastReadingIn(c.readings, t0 - MEAL_TREND.PRE_WINDOW_MIN * MIN_MS, t0)
      // Post PPG 2 h — invalidée si un apport glucidique tombe avant t0+90.
      const winEnd = excursionWindowEnd(t0, c.carbTimes)
      const post = (winEnd - t0) / MIN_MS >= MEAL_TREND.EXCURSION_MIN_WINDOW_MIN
        ? closestReading(c.readings, t0 + MEAL_TREND.POST_2H_CENTER_MIN * MIN_MS, MEAL_TREND.POST_2H_TOL_MIN * MIN_MS, winEnd)
        : null
      const lh = localHour(realMs)
      // Nadir post-prandial : plus bas relevé sur [t0, min(prochain glucide, t0+300 min)]. Fourni à
      // la garde hypo de l'analyseur ICR (creux à ~3-4 h, après la PPG 2 h). Relevés déjà bornés
      // physiologiquement (≥ 0,20 g/L) par loadContext → pas de zéro-artefact (suivi LOW #669 résolu).
      const nadir = minReadingIn(c.readings, t0, nadirWindowEnd(t0, c.carbTimes))
      return {
        mealId: meal.id,
        dayIso: localDay(realMs),
        localHour: lh,
        moment: momentForHour(lh, c.bounds),
        preMgdl: pre,
        postMgdl: post,
        nadirMgdl: nadir,
        carbs: meal.carbohydrates !== null ? decimalToNumber(meal.carbohydrates) : null,
        bolus: meal.bolusDose !== null ? decimalToNumber(meal.bolusDose) : null,
      }
    })
    // Plus récent d'abord.
    return out.sort((a, b) => (a.dayIso < b.dayIso ? 1 : a.dayIso > b.dayIso ? -1 : 0))
}

// ── Utilitaires internes ─────────────────────────────────────────────────────

function maxReadingIn(readings: Reading[], min: number, max: number): number | null {
  let best: number | null = null
  for (const r of readings) if (r.t > min && r.t <= max && (best === null || r.mgdl > best)) best = r.mgdl
  return best
}
/** Plus bas relevé (nadir) dans `(min, max]`, ou `null` si aucun. Miroir de `maxReadingIn`. */
function minReadingIn(readings: Reading[], min: number, max: number): number | null {
  let best: number | null = null
  for (const r of readings) if (r.t > min && r.t <= max && (best === null || r.mgdl < best)) best = r.mgdl
  return best
}
/** Fin de la fenêtre de recherche du nadir post-prandial : `t0 + POSTMEAL_NADIR_WINDOW_MIN`,
 *  bornée en amont par le prochain apport glucidique (le nadir ne doit pas déborder sur le repas
 *  suivant). Miroir de `excursionWindowEnd` mais avec la fenêtre nadir (plus longue, ~5 h). */
function nadirWindowEnd(t0: number, carbTimes: number[]): number {
  const cap = t0 + CLINICAL_BOUNDS.POSTMEAL_NADIR_WINDOW_MIN * MIN_MS
  let next = Infinity
  for (const c of carbTimes) if (c > t0 && c < next) next = c
  return Math.min(cap, next)
}
function mean(a: number[]): number {
  return a.reduce((s, x) => s + x, 0) / a.length
}
function parsePeriodDays(period: string): number {
  const m = period.match(/^(\d+)d$/)
  const n = m ? parseInt(m[1], 10) : NaN
  if (!Number.isFinite(n) || n < 1 || n > 90) throw new Error("Invalid period, use Nd (1..90)")
  return n
}
async function auditRead(
  userId: number | null, patientId: number, period: string, windowDays: number,
  source: string, kind: string, ctx?: AuditContext,
) {
  await auditService.log({
    userId, action: "READ", resource: "DIABETES_EVENT", resourceId: String(patientId),
    ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
    metadata: { patientId, kind, period, windowDays, source },
  })
}
