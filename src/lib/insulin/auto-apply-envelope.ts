/**
 * US-2657 (slice B) — **Enveloppe de sécurité de l'auto-application experte** (fonction PURE).
 *
 * ⚠️ **Frontière dispositif médical (MDR).** Décide si l'édition d'un patient EXPERT peut s'appliquer
 * SANS validation médecin. Le principe fondateur : hors enveloppe, l'auto-application **n'existe pas** —
 * le changement **retombe en proposition** (fail-safe), sauf valeur hors bornes cliniques = **rejet dur**.
 *
 * **Pure** : aucune lecture DB ni horloge — tout le contexte (fenêtre glycémique, historique anti-cliquet)
 * est fourni en entrée par le harnais (slice C). Toute donnée manquante/ambiguë/`NaN` ⇒ **fail-closed**
 * (C8) ⇒ proposition. **Rien n'appelle encore cet évaluateur** (câblage gouverné = slice C).
 *
 * Conditions (conjonction, court-circuit) — cf. `docs/UserStory/…/US-2657` §4 et catalogue §auto-application :
 *  C4 bornes cliniques (→ REJET DUR) · C1 autorité · C2 non structurel · C3 amplitude · C5 délivrabilité ·
 *  C6 garde hypo (hausse) · C6b garde hyper/cétose (baisse) · C7 anti-cliquet · C8 fail-closed (enveloppe).
 */
import type { AdjustableParameter, MaturityLevel } from "@prisma/client"
import { CLINICAL_BOUNDS, isDeliverableBasalRate, isDeliverableFixedDose } from "@/lib/clinical-bounds"
import { deriveRiskDirection } from "@/lib/insulin/risk-direction"
import { hypoWindowBlocks, hyperDecreaseBlockReason } from "@/lib/insulin/dose-safety-guards"

export type EnvelopeInput = {
  authority: { maturityLevel: MaturityLevel; autoApply: boolean }
  change: {
    parameterType: AdjustableParameter
    /** `VALUE` = valeur d'un créneau existant (seul cas auto-applicable) ; `STRUCTURAL` = ajout/suppression/déplacement. */
    changeKind: "VALUE" | "STRUCTURAL"
    currentValue: number
    proposedValue: number
    /** Unité ISF (bornes/pourcentage). Requis pour ISF ; ignoré sinon. */
    isfUnit?: "gl" | "mgdl"
  }
  glycemia: {
    glucosesGl: number[]
    capturePercent: number
    windowDays: number
    /** Cétonémies (mmol/L) déjà filtrées à `AUTO_APPLY_KETONE_BLOCK_LOOKBACK_HOURS`. */
    recentKetonesMmol: number[]
    ketoneModerateThreshold: number
  }
  ratchet: {
    /** Heures depuis la dernière auto-application sur (patient × param × créneau). `null` = jamais. */
    hoursSinceLastAutoApply: number | null
    /**
     * Cumul des |Δ%| auto-appliqués sur (param × créneau) sur 7 j glissants. `null` = inconnu → fail-closed.
     * **Toujours en pourcentage**, y compris pour `fixedDose` (dont l'amplitude C3 est pourtant en U) : le
     * harnais (slice C) doit convertir le Δ dose fixe en % du courant pour alimenter ce cumul. Suivi possible :
     * cumul dédié en U (`AUTO_APPLY_MAX_CUMULATIVE_U_PER_WEEK`) pour la cohérence d'unité.
     */
    cumulativeAbsPercentThisWeek: number | null
  }
}

export type FailedCheck = "C1" | "C2" | "C3" | "C5" | "C6" | "C6b" | "C7" | "C8"
export type EnvelopeDecision =
  | { decision: "AUTO_APPLY" }
  | { decision: "FALLBACK_PROPOSAL"; failedCheck: FailedCheck }
  | { decision: "HARD_REJECT"; reason: "outOfClinicalBounds" }

const B = CLINICAL_BOUNDS
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

/** Bornes cliniques [min,max] de la valeur résultante selon le paramètre (C4). `null` si indéterminable. */
function clinicalBoundsFor(param: AdjustableParameter, isfUnit?: "gl" | "mgdl"): [number, number] | null {
  switch (param) {
    case "insulinSensitivityFactor":
      if (isfUnit === "gl") return [B.ISF_GL_MIN, B.ISF_GL_MAX]
      if (isfUnit === "mgdl") return [B.ISF_MGDL_MIN, B.ISF_MGDL_MAX]
      return null // unité ISF requise → fail-closed
    case "insulinToCarbRatio":
      return [B.ICR_MIN, B.ICR_MAX]
    case "basalRate":
      return [B.BASAL_MIN, B.BASAL_MAX]
    case "fixedDose":
      return [B.FIXED_DOSE_MIN, Number.POSITIVE_INFINITY] // plancher bloquant ; pas de max dur (seuils = avertissements)
    default:
      return null
  }
}

const FALLBACK = (failedCheck: FailedCheck): EnvelopeDecision => ({ decision: "FALLBACK_PROPOSAL", failedCheck })

/**
 * Évalue l'enveloppe. Ordre : **C4 (rejet dur, valeur invalide d'abord) → C1 → C2 → C3 → C5 → C6 → C6b → C7**.
 * Toute exception/donnée manquante → C8 (fail-closed → proposition).
 */
export function evaluateAutoApplyEnvelope(input: EnvelopeInput): EnvelopeDecision {
  try {
    const { authority, change, glycemia, ratchet } = input
    const { parameterType: param, changeKind, currentValue, proposedValue, isfUnit } = change

    // Entrées de base indispensables (fail-closed).
    if (!finite(currentValue) || !finite(proposedValue) || currentValue === 0) return FALLBACK("C8")

    // C4 — bornes cliniques absolues (valeur INVALIDE = rejet dur, quelle que soit l'autorité/le type).
    const bounds = clinicalBoundsFor(param, isfUnit)
    if (!bounds) return FALLBACK("C8") // unité ISF manquante / paramètre inconnu
    if (proposedValue < bounds[0] || proposedValue > bounds[1]) {
      return { decision: "HARD_REJECT", reason: "outOfClinicalBounds" }
    }

    // C1 — autorité : EXPERT ET flag autoApply ON.
    if (authority.maturityLevel !== "EXPERT" || authority.autoApply !== true) return FALLBACK("C1")

    // C2 — jamais de restructuration auto-appliquée (`AUTO_APPLY_STRUCTURAL_ALLOWED = false`).
    if (changeKind === "STRUCTURAL" && !B.AUTO_APPLY_STRUCTURAL_ALLOWED) return FALLBACK("C2")

    // C3 — amplitude bornée (ratios en %, dose fixe en U).
    const absPercent = Math.abs((proposedValue - currentValue) / currentValue) * 100
    if (param === "fixedDose") {
      if (Math.abs(proposedValue - currentValue) > B.AUTO_APPLY_FIXED_DOSE_MAX_DELTA_U) return FALLBACK("C3")
    } else {
      if (absPercent > B.AUTO_APPLY_MAX_CHANGE_PERCENT) return FALLBACK("C3")
    }

    // C5 — délivrabilité (pas d'arrondi silencieux).
    if (param === "basalRate" && !isDeliverableBasalRate(proposedValue)) return FALLBACK("C5")
    if (param === "fixedDose" && !isDeliverableFixedDose(proposedValue)) return FALLBACK("C5")

    // Direction de risque (garde hypo/hyper).
    const direction = deriveRiskDirection(param, currentValue, proposedValue)

    // C6 — garde HYPO : une HAUSSE d'insuline est bloquée si signal hypo récent.
    if (direction === "hypo") {
      if (!Array.isArray(glycemia?.glucosesGl)) return FALLBACK("C8")
      if (hypoWindowBlocks(glycemia.glucosesGl)) return FALLBACK("C6")
    }

    // C6b — garde HYPER/sous-dosage : une BAISSE d'insuline exige un plancher de données + pas de signal hyper/cétose.
    if (direction === "hyper") {
      if (
        !Array.isArray(glycemia?.glucosesGl) ||
        !Array.isArray(glycemia?.recentKetonesMmol) ||
        !finite(glycemia?.capturePercent) ||
        !finite(glycemia?.windowDays) ||
        !finite(glycemia?.ketoneModerateThreshold)
      ) {
        return FALLBACK("C8")
      }
      const blocked = hyperDecreaseBlockReason(
        glycemia.glucosesGl,
        glycemia.capturePercent,
        glycemia.windowDays,
        glycemia.recentKetonesMmol,
        glycemia.ketoneModerateThreshold,
      )
      if (blocked !== null) return FALLBACK("C6b")
    }

    // C7 — anti-cliquet : cooldown + cumul hebdomadaire.
    if (ratchet.cumulativeAbsPercentThisWeek === null || !finite(ratchet.cumulativeAbsPercentThisWeek)) {
      return FALLBACK("C8") // cumul inconnu → fail-closed
    }
    if (ratchet.hoursSinceLastAutoApply !== null) {
      if (!finite(ratchet.hoursSinceLastAutoApply)) return FALLBACK("C8")
      if (ratchet.hoursSinceLastAutoApply < B.AUTO_APPLY_COOLDOWN_HOURS) return FALLBACK("C7")
    }
    if (ratchet.cumulativeAbsPercentThisWeek + absPercent > B.AUTO_APPLY_MAX_CUMULATIVE_PERCENT_PER_WEEK) {
      return FALLBACK("C7")
    }

    // Toutes les conditions franchies.
    return { decision: "AUTO_APPLY" }
  } catch {
    return FALLBACK("C8")
  }
}
