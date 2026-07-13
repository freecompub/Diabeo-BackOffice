/**
 * @module insulin/patient-grouped-gate
 * @description US-2663 (S4, décision produit D3) — Garde clinique PATIENT de la voie manuelle GROUPÉE.
 *
 * Réplique, GÉNÉRALISÉS AU JEU, les invariants de sûreté que `adjustmentService.createProposal` (par-valeur,
 * US-2659) applique à une soumission PATIENT :
 *  - **BAISSE de basale** relâchée mais GATÉE : maturité par mode (stylo → CONFIRME ; pompe → INTERMEDIATE+ ;
 *    JUNIOR = refus), **accusé DKA** BLOQUANT pour le stylo (jour-de-maladie : réduire une basale lente expose
 *    à l'acidocétose), cap d'amplitude par créneau (stylo min(10 %, 2 U) ; pompe 10 %), snap d'incrément stylo ;
 *  - **HAUSSE** basale + **tout changement ISF/ICR/dose-fixe** : cap de variation `PATIENT_MAX_CHANGE_PERCENT`
 *    (10 %), les deux sens pour ISF/ICR (une baisse d'ISF = plus d'insuline) ;
 *  - **cohérence de mode** : la FORME du jeu (stylo `kind` vs pompe `startTime`) doit matcher le `configType`
 *    LIVE (anti-usurpation `deliveryModeMismatch`).
 *
 * **Décision produit D3** : une soumission pouvant mélanger hausses ET baisses, **UN SEUL accusé DKA couvre
 * TOUTES les baisses stylo du jeu** — l'accusé est porté au niveau de la PROPOSITION, pas par créneau.
 *
 * PURE (aucune IO) : les lectures serveur (maturité, `configType` LIVE) sont faites par l'appelant
 * (`createSetProposal`) et INJECTÉES — anti-tamper (jamais du body). Lève un code d'erreur fail-closed ;
 * l'appelant audite le refus (`INSULIN_SLOT_SUBMISSION`, sans PHI) et mappe le code en HTTP.
 *
 * ⚠️ Ne re-valide PAS les bornes cliniques dures (`assertValidGroupedSet` en amont) ni le CAS d'ensemble
 * (acceptation) — uniquement les garde-fous PATIENT (écart de confiance vs base, une DEMANDE, pas une titration).
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

export type PatientGroupedGateInput = {
  parameterType: "insulinSensitivityFactor" | "insulinToCarbRatio" | "basalRate" | "fixedDose"
  /** Disposition proposée (parsée, forme validée en amont). */
  slots: AnySlot[]
  /** Snapshot de la base ACTIVE (même forme) — capturé serveur, socle de la comparaison de direction/amplitude. */
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
  /** Métadonnées d'audit SANS PHI (direction/mode/accusé/maturité/nb) si ≥ 1 baisse ; `null` sinon. */
  decreaseAudit: Record<string, unknown> | null
}

/**
 * Évalue la garde patient d'un jeu groupé. Appelée UNIQUEMENT pour `proposer.source === "patient"` (les
 * soignants nurse/doctor ne sont pas gatés — cliniciens qualifiés, cohérent avec la décision D5 moteur→médecin).
 *
 * @throws deliveryModeMismatch — forme du jeu (stylo/pompe) incohérente avec le `configType` LIVE.
 * @throws maturityTooLowForDecrease — baisse basale sous le seuil de maturité (par mode).
 * @throws dkaAcknowledgmentRequired — baisse STYLO sans accusé DKA (bloquant).
 * @throws patientDeltaTooLarge — amplitude d'un créneau au-delà du cap patient (10 % ; stylo baisse min(10 %, 2 U)).
 * @throws noChangeProposed — baisse STYLO infra-incrément (< 1 U) ou non délivrable (½ U) → non actionnable.
 */
export function evaluatePatientGroupedGate(input: PatientGroupedGateInput): PatientGroupedGateResult {
  const { parameterType, slots, baseline, isPen, maturity, sickDayAcknowledged } = input
  const isBasal = parameterType === "basalRate"

  // 0. Cohérence de mode (basale) : la forme du jeu doit matcher le `configType` LIVE. Un jeu mixte est déjà
  //    rejeté en amont (`assertValidGroupedSet`) → tester la 1ʳᵉ ligne suffit.
  if (isBasal && slots.length > 0) {
    const formIsPen = isStyloForm(slots[0]!)
    const formIsPump = isPumpForm(slots[0]!)
    if ((formIsPen && !isPen) || (formIsPump && isPen)) throw new Error("deliveryModeMismatch")
  }

  const baseByKey = new Map(baseline.map((s) => [keyOf(s), valueOf(s)]))

  // 0-bis. US-2663 (S4, revue medical/code MAJOR) — RESTRUCTURATION INTERDITE côté patient : un patient ÉDITE
  //    des valeurs, il ne RESTRUCTURE pas (re-partition de créneaux = nouveau `startHour`/`startTime` ; bascule
  //    de modalité stylo single↔split = clés `daily` ⇄ `morning`/`evening` ; ajout/retrait de créneau). Le jeu
  //    proposé DOIT porter EXACTEMENT les mêmes clés que la base. Sinon un créneau « nouveau » (clé absente de la
  //    base) échapperait À LA FOIS au cap % ET au gate de baisse (DKA/maturité) — évasion réelle (ex. single 20 U
  //    → split 2+2 U traité comme « aucun changement », sans accusé DKA). La voie par-valeur y est immune (elle
  //    édite un créneau EXISTANT). Fail-closed. Clés uniques (validé en amont) ⇒ même cardinalité + inclusion = même jeu.
  if (slots.length !== baseline.length || slots.some((s) => !baseByKey.has(keyOf(s)))) {
    throw new Error("structuralChangeNotAllowed")
  }

  const CAP_PCT = CLINICAL_BOUNDS.PATIENT_MAX_CHANGE_PERCENT // 10 %

  // Créneaux réellement CHANGÉS vs base (un créneau nouveau/non apparié n'a pas de base de comparaison → laissé
  // aux bornes cliniques dures en amont ; le cap patient ne s'applique qu'à un ÉCART mesurable).
  type Changed = { old: number; next: number; delta: number }
  const changed: Changed[] = []
  for (const s of slots) {
    const old = baseByKey.get(keyOf(s))
    if (old === undefined) continue
    const next = valueOf(s)
    const delta = next - old
    if (delta !== 0) changed.push({ old, next, delta })
  }

  const decreases = isBasal ? changed.filter((c) => c.delta < 0) : []
  const hasDecrease = decreases.length > 0

  // 1. BAISSE de basale (relâchée mais gatée). Gate SET-LEVEL : maturité + accusé DKA (D3 : 1 accusé couvre TOUT).
  if (hasDecrease) {
    const gateOk = isPen ? maturity === "CONFIRME" : maturity === "INTERMEDIATE" || maturity === "CONFIRME"
    if (!gateOk) throw new Error("maturityTooLowForDecrease")
    if (isPen && sickDayAcknowledged !== true) throw new Error("dkaAcknowledgmentRequired")
    // Cap d'amplitude + snap d'incrément PAR créneau baissé (sur le VRAI delta).
    for (const c of decreases) {
      const pctCapU = (CAP_PCT / 100) * c.old
      const capU = isPen ? Math.min(pctCapU, CLINICAL_BOUNDS.MDI_BASAL_PATIENT_MAX_DELTA_U) : pctCapU
      if (Math.abs(c.delta) > capU + 1e-9) throw new Error("patientDeltaTooLarge")
      if (isPen && (Math.abs(c.delta) < CLINICAL_BOUNDS.MDI_BASAL_DELIVERY_INCREMENT_U - 1e-9 || !isDeliverableFixedDose(c.next))) {
        throw new Error("noChangeProposed")
      }
    }
  }

  // 2. HAUSSES basale + TOUT changement ISF/ICR/dose-fixe : cap de variation % (10 %). Pour ISF/ICR la baisse
  //    (= plus d'insuline) est aussi capée. Les baisses basales sont déjà gatées ci-dessus (amplitude U).
  for (const c of changed) {
    if (isBasal && c.delta < 0) continue
    const pct = c.old !== 0 ? Math.abs((c.delta / c.old) * 100) : 0
    if (pct > CAP_PCT + 1e-9) throw new Error("patientDeltaTooLarge")
  }

  // Consentement DKA persisté (immuable) : posé pour TOUTE baisse basale accusée (parité Q7 voie par-valeur —
  // bloquant stylo, optionnel mais TRACÉ pompe). `hasPenDecrease` seul droperait la traçabilité d'un accusé pompe.
  const sickDayAckAt = sickDayAcknowledged === true && hasDecrease ? new Date() : null
  const decreaseAudit = hasDecrease
    ? { direction: "decrease", deliveryMode: isPen ? "pen" : "pump", dkaAcknowledged: sickDayAcknowledged === true, maturityAtDecision: maturity, decreaseCount: decreases.length }
    : null
  return { sickDayAckAt, decreaseAudit }
}
