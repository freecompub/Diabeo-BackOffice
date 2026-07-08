/**
 * @module proposal-algorithm
 * @description Adjustment proposal algorithm — pure functions for ISF/ICR/basal analysis.
 * Analyzes post-correction/meal glucose to detect systematic over/under-correction.
 * Proposes changes with confidence level based on event count.
 * All changes clamped to ±20% to prevent dangerous adjustments.
 * @see CLAUDE.md#adjustment-proposals — Proposal generation algorithm
 */

import type { AdjustableParameter, AdjustmentReason, ConfidenceLevel, DoseMoment } from "@prisma/client"
import { CLINICAL_BOUNDS, BGM_CARNET } from "@/lib/clinical-bounds"
import { GLYCEMIA_THRESHOLDS_MGDL } from "@/lib/glycemia-thresholds"
import { deriveRiskDirection } from "@/lib/insulin/risk-direction"
import { hypoWindowBlocks } from "@/lib/insulin/dose-safety-guards"

/** Seuils d'hypo en g/L (source unique mg/dL ÷ 100). Sévère = niveau 2 ; bas = niveau 1. */
// SEVERE_HYPO_GL — le test de fenêtre hypo sévère vit désormais dans `hypoWindowBlocks` (mutualisé).
const LEVEL1_HYPO_GL = GLYCEMIA_THRESHOLDS_MGDL.TARGET_LOW / 100

/**
 * Garde HYPO commune (US-2651, validé medical) : une proposition en direction « plus d'insuline
 * effective » (risque hypo) est **supprimée** si la fenêtre contient une hypo qui contre-indique
 * d'augmenter l'insuline. La direction dangereuse par paramètre vient de `deriveRiskDirection`
 * (hausse basale/dose fixe OU baisse ISF/ICR = « hypo »). La direction sûre (moins d'insuline) reste
 * toujours permise.
 *
 * Déclencheurs (la moyenne peut masquer une hypo intermittente) :
 *  - **sévère** (niveau 2, < `SEVERE_HYPO_GL`) : **un seul** relevé suffit (urgence clinique) ;
 *  - **légère** (niveau 1, < `LEVEL1_HYPO_GL`) : seulement si **récurrente** (≥
 *    `HYPO_LEVEL1_RECURRENCE_MIN` relevés) — évite la sur-suppression sur un événement isolé courant.
 */
function hypoBlocksProposal(
  parameterType: AdjustableParameter,
  currentValue: number,
  proposedValue: number,
  glucosesGl: number[],
): boolean {
  if (deriveRiskDirection(parameterType, currentValue, proposedValue) !== "hypo") return false
  // US-2657 — test de fenêtre hypo mutualisé (source unique avec l'enveloppe d'auto-application C6).
  return hypoWindowBlocks(glucosesGl)
}

/**
 * US-2653 — détecte une **hypo post-prandiale RÉCURRENTE** sur un créneau (pour DÉCLENCHER une
 * dé-escalade, pas seulement freiner). Vrai si **≥ `HYPO_LEVEL1_RECURRENCE_MIN` nadirs < niveau-1
 * (0,70 g/L)** parmi ≥ 3 nadirs disponibles. NB : plus strict que `hypoBlocksProposal` (qui fire sur
 * UN sévère isolé) — ici **corroboration exigée** : un seul relevé sévère (artefact capteur possible)
 * ne suffit pas à réduire activement l'insuline (validé medical, garde anti-artefact). Un nadir sévère
 * (< 0,54) compte aussi comme niveau-1.
 *
 * @param nadirsGl Nadirs post-prandiaux (g/L) des repas du créneau, valeurs non nulles uniquement.
 */
export function recurrentPostMealHypo(nadirsGl: number[]): boolean {
  if (nadirsGl.length < 3) return false
  // `Number.isFinite` d'abord : garde défensif — `null < 0.70` coerce à `true` en JS (null→0) et
  // fabriquerait une fausse hypo (direction « moins d'insuline »). Le contrat exige des non-nuls,
  // ce garde en fait une garantie runtime dans une fonction safety-relevant.
  const level1 = nadirsGl.filter((g) => Number.isFinite(g) && g < LEVEL1_HYPO_GL).length
  return level1 >= CLINICAL_BOUNDS.HYPO_LEVEL1_RECURRENCE_MIN
}

/**
 * US-2653 — candidat de **dé-escalade ICR** (moins d'insuline/gramme) sur hypos post-prandiales
 * récurrentes, **indépendant du deadband sur la moyenne**. Pas **fixe** `+HYPO_DEESCALATION_PERCENT`
 * (validé medical : pas de scaling — la persistance titre cumulativement). Direction HAUSSE = sens sûr
 * (« hyper ») → jamais bloquée par la garde hypo ; les bornes de `createEngineProposal` suffisent (un
 * proposedValue > `ICR_MAX` est rejeté à la persistance → skip fail-closed).
 *
 * ⚠️ Le cas **haute-variabilité** (moyenne > plafond ET hypos récurrentes) N'est PAS traité ici : c'est
 * à l'appelant (générateur) de router ce cas vers un **flag de revue**, pas une proposition de dose.
 *
 * @param slot Créneau ICR courant.
 * @param nadirsGl Nadirs post-prandiaux (g/L) du créneau, non nuls.
 * @returns Candidat de hausse ICR, ou `null` si l'hypo n'est pas récurrente.
 */
export function analyzeIcrHypoDeescalation(
  slot: { startHour: number; endHour: number; gramsPerUnit: number },
  nadirsGl: number[],
): ProposalCandidate | null {
  if (!recurrentPostMealHypo(nadirsGl)) return null
  const proposedValue = computeProposedValue(slot.gramsPerUnit, CLINICAL_BOUNDS.HYPO_DEESCALATION_PERCENT)
  return {
    parameterType: "insulinToCarbRatio",
    reason: "icrTooLow", // hausse ICR = moins d'insuline/gramme
    currentValue: slot.gramsPerUnit,
    proposedValue,
    changePercent: CLINICAL_BOUNDS.HYPO_DEESCALATION_PERCENT,
    confidence: getConfidenceLevel(nadirsGl.length),
    supportingEvents: nadirsGl.filter((g) => Number.isFinite(g) && g < LEVEL1_HYPO_GL).length, // nb de nadirs en hypo (> 0)
    totalEventsConsidered: nadirsGl.length,
    timeSlotStartHour: slot.startHour,
    timeSlotEndHour: slot.endHour,
  }
}

/**
 * Adjustment proposal candidate — suggested parameter change with confidence.
 * @typedef {Object} ProposalCandidate
 * @property {AdjustableParameter} parameterType - Parameter to adjust (ISF, ICR, or basal)
 * @property {AdjustmentReason} reason - Why this adjustment (too low/high/etc.)
 * @property {number} currentValue - Current parameter value
 * @property {number} proposedValue - Suggested new value
 * @property {number} changePercent - Change magnitude (%-20 to +20)
 * @property {ConfidenceLevel} confidence - Evidence strength (low/medium/high)
 * @property {number} supportingEvents - Number of events supporting this proposal
 * @property {number} totalEventsConsidered - Total events analyzed
 * @property {number} [timeSlotStartHour] - Hour slot (for ISF/ICR proposals)
 * @property {number} [timeSlotEndHour] - Hour slot end
 * @property {number} [averageObservedValue] - Average post-correction glucose (for analysis)
 */
export interface ProposalCandidate {
  parameterType: AdjustableParameter
  reason: AdjustmentReason
  currentValue: number
  proposedValue: number
  changePercent: number
  confidence: ConfidenceLevel
  supportingEvents: number
  totalEventsConsidered: number
  timeSlotStartHour?: number
  timeSlotEndHour?: number
  averageObservedValue?: number
}

/** Max change magnitude per proposal — safety cap (source unique : `CLINICAL_BOUNDS`, US-2651). */
const MAX_CHANGE_PERCENT = CLINICAL_BOUNDS.MAX_CHANGE_PERCENT // ±20%

/**
 * Determine confidence level from supporting event count.
 * Higher event count = more confidence in the recommendation.
 * @param {number} eventCount - Number of supporting events
 * @returns {("low" | "medium" | "high")} Confidence level
 */
export function getConfidenceLevel(eventCount: number): ConfidenceLevel {
  if (eventCount > 10) return "high"
  if (eventCount >= 6) return "medium"
  return "low"
}

/**
 * Clamp change percentage to ±20% safety limit.
 * Prevents overly aggressive adjustments that could harm patient.
 * @param {number} percent - Proposed change percentage
 * @returns {number} Clamped percentage in range [-20, +20]
 */
export function clampChangePercent(percent: number): number {
  return Math.max(-MAX_CHANGE_PERCENT, Math.min(MAX_CHANGE_PERCENT, percent))
}

/**
 * Compute proposed parameter value — apply clamped percentage to current value.
 * Formula: newValue = currentValue * (1 + changePercent/100), rounded to 4 decimals.
 * @param {number} currentValue - Current parameter value
 * @param {number} changePercent - Proposed change percentage (will be clamped)
 * @returns {number} Proposed value (4 decimal places)
 */
export function computeProposedValue(currentValue: number, changePercent: number): number {
  const clamped = clampChangePercent(changePercent)
  return Math.round(currentValue * (1 + clamped / 100) * 10000) / 10000
}

/**
 * Analyze ISF (insulin sensitivity factor) effectiveness for a time slot.
 * Detects systematic over/under-correction from post-correction glucose patterns.
 * Only proposes if 3+ events AND change is meaningful (> 2%).
 *
 * Contrat garde-hypo (US-2651, validé medical — symétrique de `analyzeIcrSlot`/`analyzeBasalTrend`) :
 * une correction d'analogue rapide fait son creux à ~3-4 h, APRÈS la glycémie post-correction. La
 * MOYENNE/direction reste pilotée par `postGlucoseGl` (résultat de la correction), tandis que la garde
 * hypo regarde le **nadir** `nadirGl` (creux post-correction) quand il est fourni — sinon un creux tardif
 * (sur-correction) resterait invisible. Repli sur `postGlucoseGl` si absent. Ne JAMAIS injecter le nadir
 * dans `postGlucoseGl` (cela biaiserait la moyenne vers le bas → fausse hausse d'ISF).
 *
 * @param slot - ISF slot configuration (startHour, endHour, sensitivityFactorGl)
 * @param corrections - Par correction : `postGlucoseGl` (résultat, pilote la direction), `targetGl`,
 *   et `nadirGl` optionnel (creux post-correction → garde hypo uniquement). g/L.
 * @returns {ProposalCandidate | null} Proposal if detected, null otherwise
 */
export function analyzeIsfSlot(
  slot: { startHour: number; endHour: number; sensitivityFactorGl: number },
  corrections: { postGlucoseGl: number; targetGl: number; nadirGl?: number }[],
): ProposalCandidate | null {
  if (corrections.length < 3) return null

  const avgPost = corrections.reduce((s, c) => s + c.postGlucoseGl, 0) / corrections.length
  const avgTarget = corrections.reduce((s, c) => s + c.targetGl, 0) / corrections.length

  if (avgTarget === 0) return null

  // ISF est un DÉNOMINATEUR (dose = (BG−cible)/ISF), d'où le sign-flip (×−100) :
  // - post-correction AU-DESSUS de la cible → correction trop faible → ISF trop HAUT → BAISSE (isfTooHigh) ;
  // - EN DESSOUS (sur-correction) → ISF trop BAS → HAUSSE (isfTooLow).
  // (Validé medical US-2651 ; l'ancien commentaire était inversé.)
  const errorPercent = ((avgPost - avgTarget) / avgTarget) * -100
  const clampedChange = clampChangePercent(errorPercent)

  // Only propose if change is meaningful (> 2%)
  if (Math.abs(clampedChange) < 2) return null

  const proposedValue = computeProposedValue(slot.sensitivityFactorGl, clampedChange)
  // Garde HYPO : baisser l'ISF = corrections plus fortes (plus d'insuline) → supprimé si un creux
  // post-correction est en hypo (une correction a sur-shooté ~3-4 h plus tard). Nadir séparé si fourni,
  // repli sur `postGlucoseGl` sinon. La moyenne/direction reste sur `postGlucoseGl`.
  const guardValues = corrections.map((c) => c.nadirGl ?? c.postGlucoseGl)
  if (hypoBlocksProposal("insulinSensitivityFactor", slot.sensitivityFactorGl, proposedValue, guardValues)) {
    return null
  }

  const reason: AdjustmentReason = clampedChange > 0 ? "isfTooLow" : "isfTooHigh"

  return {
    parameterType: "insulinSensitivityFactor",
    reason,
    currentValue: slot.sensitivityFactorGl,
    proposedValue,
    changePercent: Math.round(clampedChange * 100) / 100,
    confidence: getConfidenceLevel(corrections.length),
    supportingEvents: corrections.length,
    totalEventsConsidered: corrections.length,
    timeSlotStartHour: slot.startHour,
    timeSlotEndHour: slot.endHour,
    averageObservedValue: Math.round(avgPost * 10000) / 10000,
  }
}

/**
 * Analyze ICR (insulin-to-carb ratio) effectiveness for a time slot.
 * Detects systematic post-meal glucose over/under-coverage from carb ratio.
 * Only proposes if 3+ meals AND change is meaningful (> 2%).
 * Contrat nadir (US-2651, validé medical) : chaque repas porte `postGlucoseGl` (PPG 2 h, g/L) qui
 * pilote la MOYENNE et la direction, et un `nadirGl` OPTIONNEL (creux post-prandial ~3-4 h) fourni
 * UNIQUEMENT à la garde hypo (repli sur `postGlucoseGl` si absent). Ne jamais injecter le nadir dans
 * `postGlucoseGl` : cela corromprait la moyenne. Voir spec section 5ter.
 *
 * @param slot - ICR slot configuration (startHour, endHour, gramsPerUnit)
 * @param meals - Un élément par repas : postGlucoseGl (PPG 2 h), targetGl, et nadirGl optionnel.
 * @returns {ProposalCandidate | null} Proposal if detected, null otherwise
 */
export function analyzeIcrSlot(
  slot: { startHour: number; endHour: number; gramsPerUnit: number },
  meals: { postGlucoseGl: number; targetGl: number; nadirGl?: number }[],
): ProposalCandidate | null {
  if (meals.length < 3) return null

  const avgPost = meals.reduce((s, m) => s + m.postGlucoseGl, 0) / meals.length
  const avgTarget = meals.reduce((s, m) => s + m.targetGl, 0) / meals.length

  if (avgTarget === 0) return null

  // Post-meal glucose above target → ICR too high (give more insulin per gram → lower ICR)
  // Below target → ICR too low (give less insulin → raise ICR)
  const errorPercent = ((avgPost - avgTarget) / avgTarget) * -100
  const clampedChange = clampChangePercent(errorPercent)

  if (Math.abs(clampedChange) < 2) return null

  // ICR est un DÉNOMINATEUR (bolus = glucides/ICR) : baisser l'ICR = plus d'insuline/gramme.
  // Post-repas AU-DESSUS de la cible → bolus trop faible → ICR trop HAUT → BAISSE (icrTooHigh) ;
  // EN DESSOUS → ICR trop BAS → HAUSSE (icrTooLow). (Correction validée medical US-2651 : les
  // libellés étaient inversés — la DIRECTION était correcte, seul le `reason` affiché était faux.)
  const proposedValue = computeProposedValue(slot.gramsPerUnit, clampedChange)
  // Garde HYPO : baisser l'ICR = plus d'insuline/gramme → supprimé si un creux de la fenêtre est en
  // hypo (un bolus repas a sur-shooté). ⚠️ La garde regarde le **nadir** post-prandial (`nadirGl`,
  // creux à ~3-4 h) quand il est fourni — le pic d'action d'un analogue rapide tombe APRÈS la PPG 2 h,
  // et une moyenne à 2 h peut masquer une hypo tardive (US-2651, validé medical). Repli sur la PPG 2 h
  // (`postGlucoseGl`) si le nadir n'est pas disponible. La MOYENNE qui pilote la direction reste, elle,
  // toujours sur `postGlucoseGl` (ci-dessus) — ne JAMAIS injecter le nadir dans `avgPost`.
  if (hypoBlocksProposal("insulinToCarbRatio", slot.gramsPerUnit, proposedValue, meals.map((m) => m.nadirGl ?? m.postGlucoseGl))) {
    return null
  }

  const reason: AdjustmentReason = clampedChange < 0 ? "icrTooHigh" : "icrTooLow"

  return {
    parameterType: "insulinToCarbRatio",
    reason,
    currentValue: slot.gramsPerUnit,
    proposedValue,
    changePercent: Math.round(clampedChange * 100) / 100,
    confidence: getConfidenceLevel(meals.length),
    supportingEvents: meals.length,
    totalEventsConsidered: meals.length,
    timeSlotStartHour: slot.startHour,
    timeSlotEndHour: slot.endHour,
    averageObservedValue: Math.round(avgPost * 10000) / 10000,
  }
}

/**
 * Analyze basal rate effectiveness from fasting glucose trends.
 * Detects systematic overnight drift (rising = too low, falling = too high).
 * Only proposes if 3+ fasting values AND change is meaningful (> 2%).
 *
 * Contrat garde-hypo (US-2651, validé medical — symétrique de `analyzeIcrSlot`) : la MOYENNE/direction
 * est pilotée par `fastingValues` (pré-petit-déj), tandis que la garde hypo regarde les **nadirs
 * NOCTURNES** (`nocturnalNadirs`, creux CGM le plus bas de chaque nuit) quand ils sont fournis — sinon
 * une hypo à 3 h qui **rebondit** en hyperglycémie au réveil (effet Somogyi) resterait invisible et la
 * garde n'empêcherait pas une hausse basale dangereuse. Repli sur `fastingValues` si absents. Ne JAMAIS
 * injecter le nadir dans `fastingValues` (cela biaiserait la moyenne à jeun vers le bas).
 *
 * @param fastingValues - Glycémies pré-petit-déjeuner (g/L) — pilotent la moyenne/direction.
 * @param targetGl - Cible glycémique à jeun (g/L).
 * @param currentRate - Débit basal courant (U/h).
 * @param nocturnalNadirs - Creux nocturnes (g/L), optionnels — fournis UNIQUEMENT à la garde hypo.
 * @returns {ProposalCandidate | null} Proposal if detected, null otherwise
 */
export function analyzeBasalTrend(
  fastingValues: number[],
  targetGl: number,
  currentRate: number,
  nocturnalNadirs?: number[],
): ProposalCandidate | null {
  if (fastingValues.length < 3) return null

  const avgFasting = fastingValues.reduce((s, v) => s + v, 0) / fastingValues.length
  if (targetGl === 0) return null

  const errorPercent = ((avgFasting - targetGl) / targetGl) * 100
  const clampedChange = clampChangePercent(errorPercent)

  if (Math.abs(clampedChange) < 2) return null

  // Snapping DÉLIVRABLE (US-2651 basal, validé medical) : la pompe ne délivre qu'un multiple de
  // PUMP_BASAL_INCREMENT (0,05 U/h) ; `createEngineProposal` REJETTE un débit non délivrable
  // (`isDeliverableBasalRate`) → sans snap, quasi toutes les propositions basales seraient
  // silencieusement droppées (no-op). Mirror `analyzeFixedDose`. Le SENS et la GARDE utilisent la
  // valeur SNAPPÉE (cohérence avec ce qui est persisté), pas le % pré-snap.
  const inc = CLINICAL_BOUNDS.PUMP_BASAL_INCREMENT
  const proposedValue = Math.round(computeProposedValue(currentRate, clampedChange) / inc) * inc
  if (Math.abs(proposedValue - currentRate) < inc) return null // non actionnable après snap

  // Garde HYPO : hausser la basale = plus d'insuline → supprimé si un creux NOCTURNE est en hypo
  // (hypo à 3 h masquée par une moyenne à jeun élevée = effet Somogyi). Repli sur `fastingValues`
  // si les nadirs nocturnes ne sont pas fournis. La moyenne/direction reste sur `fastingValues`.
  const guardValues = nocturnalNadirs && nocturnalNadirs.length > 0 ? nocturnalNadirs : fastingValues
  if (hypoBlocksProposal("basalRate", currentRate, proposedValue, guardValues)) return null

  const reason: AdjustmentReason = proposedValue > currentRate ? "basalTooLow" : "basalTooHigh"

  return {
    parameterType: "basalRate",
    reason,
    currentValue: currentRate,
    proposedValue,
    changePercent: Math.round(((proposedValue - currentRate) / currentRate) * 10000) / 100,
    confidence: getConfidenceLevel(fastingValues.length),
    supportingEvents: fastingValues.length,
    totalEventsConsidered: fastingValues.length,
    averageObservedValue: Math.round(avgFasting * 10000) / 10000,
  }
}

/**
 * Analyse une DOSE FIXE (mode b, US-2651) pour un **moment** (matin/midi/soir/nuit) à partir de
 * la tendance glycémique du carnet (BGM). Une dose fixe est une dose **directe** (comme la basale,
 * PAS un dénominateur) : glycémie systématiquement **au-dessus** de la cible → dose **trop basse**
 * → hausse ; **en dessous** → dose **trop haute** → baisse.
 *
 * **Titration LENTE et bornée** (jamais auto-appliquée — ADR #13) :
 *  - ≥ `BGM_CARNET.MIN_READINGS_PER_MOMENT` relevés requis, sinon `null` (bruit).
 *  - Variation = le **plus petit** de ± `FIXED_DOSE_MAX_CHANGE_PERCENT` (10 %) et
 *    ± `FIXED_DOSE_MAX_DELTA_U` (2 U).
 *  - **Plancher** absolu `FIXED_DOSE_MIN` (0,5 U). Arrondi à l'incrément délivrable
 *    `FIXED_DOSE_DELIVERY_INCREMENT_U` (0,5 U) ; pas nul → aucune proposition (non actionnable).
 *  - **Interdits** (hors périmètre de cette fonction pure) : convertir une dose fixe en
 *    basal-bolus, créer un ISF/ICR ex nihilo — l'appelant ne route ici qu'un patient `fixedDose`.
 *
 * @param slot Dose fixe courante du moment (`{ moment, valueU }`).
 * @param readings Relevés glycémiques du moment (`postGlucoseGl` vs `targetGl`, g/L).
 * @returns Proposition `fixedDose` bornée, ou `null` si insuffisant/non actionnable.
 */
export function analyzeFixedDose(
  slot: { moment: DoseMoment; valueU: number },
  readings: { postGlucoseGl: number; targetGl: number }[],
): ProposalCandidate | null {
  if (readings.length < BGM_CARNET.MIN_READINGS_PER_MOMENT) return null
  // Fail-closed sur l'entrée : dose courante invalide/nulle (sinon `changePercent` = Infinity,
  // et une dose < plancher n'est pas une base de titration valide). Validé medical US-2651.
  if (!Number.isFinite(slot.valueU) || slot.valueU < CLINICAL_BOUNDS.FIXED_DOSE_MIN) return null

  const avgPost = readings.reduce((s, r) => s + r.postGlucoseGl, 0) / readings.length
  const avgTarget = readings.reduce((s, r) => s + r.targetGl, 0) / readings.length
  if (avgTarget === 0) return null

  // Dose directe : au-dessus de la cible → hausser la dose (sign +, comme la basale).
  const errorPercent = ((avgPost - avgTarget) / avgTarget) * 100
  const pctCap = CLINICAL_BOUNDS.FIXED_DOSE_MAX_CHANGE_PERCENT
  const pctClamped = Math.max(-pctCap, Math.min(pctCap, errorPercent))
  const deltaFromPct = (slot.valueU * pctClamped) / 100
  // Le plus petit des deux caps : ± FIXED_DOSE_MAX_DELTA_U (U) ET ± pctCap %.
  const absCap = CLINICAL_BOUNDS.FIXED_DOSE_MAX_DELTA_U
  const delta = Math.max(-absCap, Math.min(absCap, deltaFromPct))

  // Plancher absolu + arrondi à l'incrément délivrable (demi-unité). NB : l'arrondi s'applique
  // APRÈS le clamp ± 2 U/± 10 %, donc `effectiveDelta` peut dépasser le cap de ≤ un demi-incrément
  // (≤ 0,25 U ; ou plus en % sur une très petite dose où l'incrément 0,5 U domine) — inévitable
  // avec un stylo demi-unité, et sans enjeu sur un ajustement unique gaté médecin.
  const inc = CLINICAL_BOUNDS.FIXED_DOSE_DELIVERY_INCREMENT_U
  const proposedRaw = Math.max(CLINICAL_BOUNDS.FIXED_DOSE_MIN, slot.valueU + delta)
  const proposedValue = Math.round(proposedRaw / inc) * inc
  const effectiveDelta = proposedValue - slot.valueU

  // Pas arrondi nul (< incrément délivrable) → non actionnable.
  if (Math.abs(effectiveDelta) < inc) return null

  // Garde HYPO (validé medical US-2651) : hausser la dose fixe = plus d'insuline (sans logique de
  // correction pour rattraper) → supprimé si un relevé du moment est en hypo sévère (la moyenne peut
  // masquer une hypo intermittente). La BAISSE reste permise. Helper commun aux 4 analyseurs.
  if (hypoBlocksProposal("fixedDose", slot.valueU, proposedValue, readings.map((r) => r.postGlucoseGl))) return null

  const reason: AdjustmentReason = effectiveDelta > 0 ? "fixedDoseTooLow" : "fixedDoseTooHigh"

  return {
    parameterType: "fixedDose",
    reason,
    currentValue: slot.valueU,
    proposedValue,
    changePercent: Math.round((effectiveDelta / slot.valueU) * 100 * 100) / 100,
    confidence: getConfidenceLevel(readings.length),
    supportingEvents: readings.length,
    totalEventsConsidered: readings.length,
    averageObservedValue: Math.round(avgPost * 10000) / 10000,
  }
}
