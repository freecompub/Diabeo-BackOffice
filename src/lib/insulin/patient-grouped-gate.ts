/**
 * @module insulin/patient-grouped-gate
 * @description US-2663 — Garde clinique PATIENT de la voie manuelle GROUPÉE.
 *
 * Réplique, GÉNÉRALISÉS AU JEU, les invariants de sûreté d'une soumission PATIENT. Deux régimes :
 *
 *  1. **ISF / ICR / basale POMPE** — **enveloppe minute-par-minute** vs la base couvrante (US-2663, réouverture
 *     gatée de la restructuration, validée `medical-domain-validator`). Pour CHAQUE minute des 24 h, on compare la
 *     valeur proposée qui couvre cette minute à la valeur de base qui la couvrait : l'écart doit rester ≤
 *     `PATIENT_MAX_CHANGE_PERCENT` (10 %). Cette enveloppe **subsume** l'ancien cap par-créneau ET ferme la faille
 *     S4 (un créneau « nouveau » ou un déplacement de frontière ne peut plus étendre une valeur agressive sans être
 *     capté) : un créneau à 14:00 est comparé à ce qui couvrait 14:00, minute à minute sur toute son étendue.
 *     - **Restructurer** (frontières/cardinalité ≠ base) exige la maturité **INTERMEDIATE+** ; JUNIOR = valeurs-seules.
 *     - **Baisse basale POMPE** (une minute où proposé < base) exige la maturité **INTERMEDIATE+** (pas d'accusé DKA).
 *     - ISF/ICR : cap bilatéral seul (une baisse d'ISF/ICR = plus d'insuline ; pas de gate maturité/DKA sur un ratio).
 *
 *  2. **basale STYLO** — **modalité VERROUILLÉE** (pas de partition horaire) : la bascule single↔split est un
 *     changement de schéma thérapeutique (profil pharmacocinétique), décision de PRESCRIPTEUR — **interdite au
 *     patient** (`structuralChangeNotAllowed`). À modalité IDENTIQUE, appariement par `kind` et gates existants :
 *     baisse → maturité **CONFIRME** + **accusé DKA** BLOQUANT (jour-de-maladie → risque acidocétose) + cap
 *     `min(10 %, 2 U)` + snap d'incrément ; hausse → cap 10 %.
 *
 * **Socle non négociable** (garanti EN AMONT par `assertValidGroupedSet`, exécuté AVANT cette garde) : bornes
 * cliniques dures + **couverture 24 h stricte** (sans trou ni chevauchement) ISF/ICR & pompe + délivrabilité +
 * invariants de modalité stylo. C'est cette couverture qui rend l'enveloppe minute-par-minute bien définie.
 *
 * **Décision produit D3** : une soumission pouvant mélanger hausses ET baisses, **UN SEUL accusé DKA couvre TOUTES
 * les baisses stylo du jeu** — porté au niveau de la PROPOSITION, pas par créneau.
 *
 * PURE (aucune IO) : maturité + `configType` LIVE (`isPen`) + base sont lues serveur par l'appelant
 * (`createSetProposal`) et INJECTÉES — anti-tamper. Lève un code fail-closed ; l'appelant audite le refus et le mappe en HTTP.
 */
import { CLINICAL_BOUNDS, isDeliverableFixedDose } from "@/lib/clinical-bounds"
import type { IsfIcrSlot, PumpBasalSlot, StyloBasalSlot, FixedDoseSlot } from "@/lib/insulin/grouped-proposal"

type AnySlot = IsfIcrSlot | PumpBasalSlot | StyloBasalSlot | FixedDoseSlot
type Maturity = "JUNIOR" | "INTERMEDIATE" | "CONFIRME"

const isPumpForm = (s: AnySlot): s is PumpBasalSlot => "startTime" in s
const isStyloForm = (s: AnySlot): s is StyloBasalSlot => "kind" in s
const isFixedForm = (s: AnySlot): s is FixedDoseSlot => "usage" in s && "moment" in s

/** Clé d'appariement proposé ⇄ baseline, par forme (identique aux clés du CAS d'ensemble). */
const keyOf = (s: AnySlot): string =>
  isPumpForm(s) ? `pump:${s.startTime}`
  : isStyloForm(s) ? `stylo:${s.kind}`
  : isFixedForm(s) ? `fixed:${s.usage}:${s.moment}`
  : `isf:${(s as IsfIcrSlot).startHour}`

/** Valeur de dose/ratio d'un créneau (pompe = débit `rate` ; les autres = `value`). */
const valueOf = (s: AnySlot): number => (isPumpForm(s) ? s.rate : (s as { value: number }).value)

const MINUTES_PER_DAY = 1440
const EPS = 1e-9

/** `"HH:MM"` (créneau pompe, format validé Zod) → minutes dans [0,1440[ ; `null` si non parsable (fail-closed). */
function hhmmToMinutes(t: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/**
 * Construit la carte minute→valeur d'un jeu de créneaux HORAIRES (ISF/ICR via `startHour`/`endHour` en heures ;
 * pompe via `startTime`/`endTime` `"HH:MM"`). Gère le passage minuit (fin ≤ début) comme `analyzeSlotCoverage`.
 * Minute non couverte → `NaN` (le socle 24 h garantit une couverture complète ; `NaN` = filet fail-closed).
 */
function buildCoveringMinutes(slots: AnySlot[]): Float64Array {
  const arr = new Float64Array(MINUTES_PER_DAY).fill(NaN)
  for (const s of slots) {
    let start: number | null
    let end: number | null
    if (isPumpForm(s)) {
      start = hhmmToMinutes(s.startTime)
      end = hhmmToMinutes(s.endTime)
    } else {
      const iso = s as IsfIcrSlot
      start = iso.startHour * 60
      end = iso.endHour * 60
    }
    if (start === null || end === null) continue
    const val = valueOf(s)
    const seg = (a: number, b: number) => { for (let m = a; m < b; m++) arr[m] = val }
    const sMin = Math.min(Math.max(Math.round(start), 0), MINUTES_PER_DAY)
    const eMin = Math.min(Math.max(Math.round(end), 0), MINUTES_PER_DAY)
    if (sMin === eMin) continue
    if (eMin > sMin) seg(sMin, eMin)
    else { seg(sMin, MINUTES_PER_DAY); seg(0, eMin) } // passage minuit
  }
  return arr
}

/** Durée d'un créneau HORAIRE (ISF/ICR heures ; pompe `"HH:MM"`) en minutes, wrap minuit inclus. `null` = non horaire. */
function slotDurationMinutes(s: AnySlot): number | null {
  let start: number | null
  let end: number | null
  if (isPumpForm(s)) { start = hhmmToMinutes(s.startTime); end = hhmmToMinutes(s.endTime) }
  else if (isStyloForm(s) || isFixedForm(s)) return null
  else { const iso = s as IsfIcrSlot; start = iso.startHour * 60; end = iso.endHour * 60 }
  if (start === null || end === null) return null
  return end > start ? end - start : MINUTES_PER_DAY - start + end // wrap minuit
}

export type PatientGroupedGateInput = {
  parameterType: "insulinSensitivityFactor" | "insulinToCarbRatio" | "basalRate" | "fixedDose"
  /** Disposition proposée (parsée, forme + couverture 24 h validées en amont). */
  slots: AnySlot[]
  /** Snapshot de la base ACTIVE (même forme) — capturé serveur, socle de la comparaison. */
  baseline: AnySlot[]
  /** `basalRate` uniquement : mode de délivrance LIVE dérivé SERVEUR (true = stylo/MDI U totales, false = pompe U/h). */
  isPen: boolean
  /** Maturité patient LIVE (fail-closed JUNIOR si absente côté appelant). */
  maturity: Maturity
  /** Accusé DKA/jour-de-maladie porté par la soumission (couvre TOUTES les baisses stylo — D3). */
  sickDayAcknowledged: boolean
}

export type PatientGroupedGateResult = {
  /** Timestamp de consentement DKA à persister (immuable) — non-null ssi accusé fourni ET ≥ 1 baisse STYLO. */
  sickDayAckAt: Date | null
  /** Métadonnées d'audit SANS PHI (direction/mode/accusé/maturité) si baisse basale ; `null` sinon. */
  decreaseAudit: Record<string, unknown> | null
}

/**
 * Évalue la garde patient d'un jeu groupé. Appelée UNIQUEMENT pour `proposer.source === "patient"` (les soignants
 * ne sont pas gatés — cliniciens qualifiés).
 *
 * @throws unsupportedSlotSetParam — `fixedDose` (non exposé à la voie patient ; défensif fail-closed).
 * @throws deliveryModeMismatch — forme du jeu (stylo/pompe) incohérente avec le `configType` LIVE.
 * @throws structuralChangeNotAllowed — restructuration par un JUNIOR ; bascule de modalité stylo single↔split ;
 *   base incomplète/vide (établir une config initiale est un acte clinicien).
 * @throws restructureSlotTooShort — restructuration produisant un créneau ISF/ICR/pompe de durée < min (anti-fragmentation).
 * @throws maturityTooLowForDecrease — baisse basale sous le seuil de maturité (pompe/stylo INTERMEDIATE+/CONFIRME).
 * @throws dkaAcknowledgmentRequired — baisse STYLO sans accusé DKA (bloquant).
 * @throws patientDeltaTooLarge — écart > cap patient (10 %) à une minute quelconque (ISF/ICR/pompe), ou amplitude
 *   d'une baisse STYLO au-delà de min(10 %, 2 U).
 * @throws noChangeProposed — baisse STYLO infra-incrément (< 1 U) ou non délivrable (½ U) → non actionnable.
 */
export function evaluatePatientGroupedGate(input: PatientGroupedGateInput): PatientGroupedGateResult {
  const { parameterType, slots, baseline, isPen, maturity, sickDayAcknowledged } = input
  const isBasal = parameterType === "basalRate"
  const CAP_PCT = CLINICAL_BOUNDS.PATIENT_MAX_CHANGE_PERCENT // 10 %

  // La voie patient n'expose PAS la dose fixe (route restreinte à ISF/ICR/basalRate). Défensif si un appelant
  // court-circuitait : la dose fixe (clé `(usage,moment)`) n'a pas d'enveloppe horaire → rejet EXPLICITE
  // fail-closed (plutôt qu'un `structuralChangeNotAllowed` trompeur via l'enveloppe all-NaN).
  if (parameterType === "fixedDose") throw new Error("unsupportedSlotSetParam")

  // 0. Cohérence de mode (basale) : la forme du jeu doit matcher le `configType` LIVE. Jeu mixte déjà rejeté en amont.
  if (isBasal && slots.length > 0) {
    const formIsPen = isStyloForm(slots[0]!)
    const formIsPump = isPumpForm(slots[0]!)
    if ((formIsPen && !isPen) || (formIsPump && isPen)) throw new Error("deliveryModeMismatch")
  }

  const baseByKey = new Map(baseline.map((s) => [keyOf(s), valueOf(s)]))
  const sameStructure = slots.length === baseline.length && slots.every((s) => baseByKey.has(keyOf(s)))
  const isStylo = isBasal && isPen

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // RÉGIME STYLO — modalité VERROUILLÉE, appariement par `kind` (pas de partition horaire → pas d'enveloppe).
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  if (isStylo) {
    // Bascule de modalité single↔split (clés `daily` ⇄ `morning`/`evening`) = changement de schéma → interdit patient.
    if (!sameStructure) throw new Error("structuralChangeNotAllowed")

    const changed: { old: number; next: number; delta: number }[] = []
    for (const s of slots) {
      const old = baseByKey.get(keyOf(s))
      if (old === undefined) continue
      const next = valueOf(s)
      if (Math.abs(next - old) > EPS) changed.push({ old, next, delta: next - old })
    }
    const decreases = changed.filter((c) => c.delta < 0)
    const hasDecrease = decreases.length > 0

    if (hasDecrease) {
      if (maturity !== "CONFIRME") throw new Error("maturityTooLowForDecrease")
      if (sickDayAcknowledged !== true) throw new Error("dkaAcknowledgmentRequired")
      for (const c of decreases) {
        const capU = Math.min((CAP_PCT / 100) * c.old, CLINICAL_BOUNDS.MDI_BASAL_PATIENT_MAX_DELTA_U)
        if (Math.abs(c.delta) > capU + EPS) throw new Error("patientDeltaTooLarge")
        if (Math.abs(c.delta) < CLINICAL_BOUNDS.MDI_BASAL_DELIVERY_INCREMENT_U - EPS || !isDeliverableFixedDose(c.next)) {
          throw new Error("noChangeProposed")
        }
      }
    }
    for (const c of changed) {
      if (c.delta < 0) continue
      // Base non positive (dose stylo ≤ 0 U) → % non bornable → fail-closed (état live improbable, validé ≥ 0,5 U).
      if (c.old <= 0) throw new Error("patientDeltaTooLarge")
      if (Math.abs((c.delta / c.old) * 100) > CAP_PCT + EPS) throw new Error("patientDeltaTooLarge")
    }

    const sickDayAckAt = sickDayAcknowledged === true && hasDecrease ? new Date() : null
    const decreaseAudit = hasDecrease
      ? { direction: "decrease", deliveryMode: "pen", dkaAcknowledged: sickDayAcknowledged === true, maturityAtDecision: maturity, decreaseCount: decreases.length }
      : null
    return { sickDayAckAt, decreaseAudit }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // RÉGIME ISF / ICR / basale POMPE — enveloppe minute-par-minute vs base couvrante.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  // Restructuration (frontières/cardinalité ≠ base) : réservée INTERMEDIATE+ (JUNIOR = valeurs-seules).
  if (!sameStructure) {
    if (maturity === "JUNIOR") throw new Error("structuralChangeNotAllowed")
    // Anti-fragmentation (revue medical MEDIUM) : chaque créneau restructuré doit durer ≥
    // `PATIENT_RESTRUCTURE_MIN_SLOT_MINUTES` (la cardinalité est déjà bornée à 24 par la route). Empêche un
    // émiettement en micro-créneaux (illisible en revue, charge du résolveur `findSlotForHour`).
    for (const slot of slots) {
      const dur = slotDurationMinutes(slot)
      if (dur !== null && dur < CLINICAL_BOUNDS.PATIENT_RESTRUCTURE_MIN_SLOT_MINUTES) {
        throw new Error("restructureSlotTooShort")
      }
    }
  }

  const coverBase = buildCoveringMinutes(baseline)
  const coverProp = buildCoveringMinutes(slots)
  let hasDecrease = false
  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    const b = coverBase[m]!
    const p = coverProp[m]!
    // Base incomplète/vide OU nulle (division), ou proposé non couvert (ne devrait pas arriver après
    // `assertValidGroupedSet`) → fail-closed. Établir/compléter une config est un acte clinicien.
    if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(p)) throw new Error("structuralChangeNotAllowed")
    if (p < b - EPS) hasDecrease = true
    if (Math.abs(p - b) / b > CAP_PCT / 100 + EPS) throw new Error("patientDeltaTooLarge")
  }

  // Basale POMPE : une baisse (à une minute quelconque) exige INTERMEDIATE+ (parité comportement existant).
  // ISF/ICR : ratios → cap bilatéral seul, aucun gate maturité/DKA.
  if (isBasal && hasDecrease && maturity === "JUNIOR") throw new Error("maturityTooLowForDecrease")

  // Audit HDS de la baisse POMPE (parité voie par-valeur, revue medical LOW) : l'accusé DKA n'est PAS requis
  // pour la pompe mais reste TRACÉ s'il est fourni (`sickDayAckAt`), et `dkaAcknowledged` reflète l'accusé réel.
  // `decreaseCount` = créneaux baissés appariés par clé (best-effort ; peut être 0 sur une restructuration pure,
  // la baisse étant alors captée au niveau minute par l'enveloppe → `hasDecrease`).
  let decreaseCount = 0
  if (isBasal) {
    for (const slot of slots) {
      const old = baseByKey.get(keyOf(slot))
      if (old !== undefined && valueOf(slot) < old - EPS) decreaseCount++
    }
  }
  const sickDayAckAt = isBasal && hasDecrease && sickDayAcknowledged === true ? new Date() : null
  const decreaseAudit = isBasal && hasDecrease
    ? { direction: "decrease", deliveryMode: "pump", dkaAcknowledged: sickDayAcknowledged === true, maturityAtDecision: maturity, decreaseCount }
    : null
  return { sickDayAckAt, decreaseAudit }
}
