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
import { CGM_AGGREGATE_RANGE_GL, MEAL_TREND } from "@/lib/clinical-bounds"
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
  moment: MealMoment
  preMgdl: number | null
  /** Après = PPG 2 h. */
  postMgdl: number | null
  carbs: number | null
  bolus: number | null
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

  // Repas insuline (ancres) — numérique uniquement, pas de texte libre.
  const meals = await prisma.diabetesEvent.findMany({
    where: {
      patientId,
      eventTypes: { has: DiabetesEventType.insulinMeal },
      eventDate: { gte: fromDate, lte: toDate },
    },
    select: { id: true, eventDate: true, carbohydrates: true, bolusDose: true },
    orderBy: { eventDate: "asc" },
  })

  // Tout apport glucidique (repas OU snack) pour borner la fenêtre d'excursion.
  const carbEvents = await prisma.diabetesEvent.findMany({
    where: { patientId, carbohydrates: { gt: 0 }, eventDate: { gte: fromDate, lte: toDate } },
    select: { eventDate: true },
    orderBy: { eventDate: "asc" },
  })
  const carbTimes = carbEvents.map((e) => e.eventDate.getTime())

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
        // date (jour) + time (heure locale) → instant. `time` est un Time UTC.
        const d = new Date(r.date)
        const t = r.time
          ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), t2h(r.time), t2m(r.time))
          : d.getTime()
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

// ── Service ──────────────────────────────────────────────────────────────────

type MealContext = Awaited<ReturnType<typeof loadContext>>

export const mealtimePattern = {
  /** Courbes glycémiques moyennes alignées sur l'heure du repas, par moment. */
  async alignedCurve(
    patientId: number, period: string, auditUserId: number, ctx?: AuditContext,
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
    patientId: number, period: string, auditUserId: number, ctx?: AuditContext,
    opts?: { source?: "cgm" | "bgm"; skipAudit?: boolean },
  ): Promise<JournalMeal[]> {
    const source = opts?.source ?? "cgm"
    const days = parsePeriodDays(period)
    const c = await loadContext(patientId, days, source)
    if (!opts?.skipAudit) await auditRead(auditUserId, patientId, period, days, source, "mealtimeJournal", ctx)
    return computeJournal(c)
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
    // Buckets par moment : offset(min) → [valeurs].
    const perMoment = new Map<MealMoment, { buckets: Map<number, number[]>; pre: number[]; post: number[]; peak: number[] }>()
    for (const m of MOMENTS) perMoment.set(m, { buckets: new Map(), pre: [], post: [], peak: [] })

    for (const meal of c.meals) {
      const t0 = meal.eventDate.getTime()
      const moment = momentForHour(localHour(t0), c.bounds)
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
      const t0 = meal.eventDate.getTime()
      const pre = lastReadingIn(c.readings, t0 - MEAL_TREND.PRE_WINDOW_MIN * MIN_MS, t0)
      // Post PPG 2 h — invalidée si un apport glucidique tombe avant t0+90.
      const winEnd = excursionWindowEnd(t0, c.carbTimes)
      const post = (winEnd - t0) / MIN_MS >= MEAL_TREND.EXCURSION_MIN_WINDOW_MIN
        ? closestReading(c.readings, t0 + MEAL_TREND.POST_2H_CENTER_MIN * MIN_MS, MEAL_TREND.POST_2H_TOL_MIN * MIN_MS, winEnd)
        : null
      return {
        mealId: meal.id,
        dayIso: localDay(t0),
        moment: momentForHour(localHour(t0), c.bounds),
        preMgdl: pre,
        postMgdl: post,
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
  userId: number, patientId: number, period: string, windowDays: number,
  source: string, kind: string, ctx?: AuditContext,
) {
  await auditService.log({
    userId, action: "READ", resource: "DIABETES_EVENT", resourceId: String(patientId),
    ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
    metadata: { patientId, kind, period, windowDays, source },
  })
}
