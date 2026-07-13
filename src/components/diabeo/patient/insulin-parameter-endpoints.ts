/**
 * Métadonnées PURES par paramètre insuline (ISF/ICR/basal) : endpoint d'écriture groupée +
 * nom du champ de valeur attendu par la route `PUT` correspondante + bornes cliniques d'affichage.
 *
 * Module NEUTRE (aucune dépendance fetch/DOM/serveur — `clinical-bounds` et `edit-capability` sont
 * client-safe) : source unique du couple (endpoint, champ) réutilisée par `insulin-slot-set-edit.ts`
 * pour construire les requêtes `PUT` « remplace le jeu complet », et des bornes cliniques par levier
 * partagées entre l'édition directe et la proposition groupée (US-2663 S4).
 *
 * Héberge `PARAM_BOUNDS` depuis le retrait de la voie par-valeur `insulin-proposal.ts` (US-2663 S4) —
 * les bornes ne sont plus spécifiques à la proposition unitaire, elles pilotent la validation UI de
 * TOUTES les voies groupées.
 */
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
import type { EditableParameter } from "@/lib/insulin/edit-capability"

/** Endpoint `PUT` (remplacement groupé DIRECT, DOCTOR) par paramètre. */
export const ENDPOINT: Record<EditableParameter, string> = {
  insulinSensitivityFactor: "/api/insulin-therapy/sensitivity-factors",
  insulinToCarbRatio: "/api/insulin-therapy/carb-ratios",
  basalRate: "/api/insulin-therapy/basal-config/pump-slots",
}

/** Nom du champ de valeur attendu par la route `PUT` DIRECTE selon le paramètre. */
export const VALUE_FIELD: Record<EditableParameter, string> = {
  insulinSensitivityFactor: "sensitivityFactorGl",
  insulinToCarbRatio: "gramsPerUnit",
  basalRate: "rate",
}

/** Bornes cliniques par paramètre (source `CLINICAL_BOUNDS`) — confort UI, le serveur reste l'autorité. */
export const PARAM_BOUNDS: Record<EditableParameter, { min: number; max: number }> = {
  insulinSensitivityFactor: { min: CLINICAL_BOUNDS.ISF_GL_MIN, max: CLINICAL_BOUNDS.ISF_GL_MAX },
  insulinToCarbRatio: { min: CLINICAL_BOUNDS.ICR_MIN, max: CLINICAL_BOUNDS.ICR_MAX },
  basalRate: { min: CLINICAL_BOUNDS.BASAL_MIN, max: CLINICAL_BOUNDS.BASAL_MAX },
}

/**
 * US-2663 (S4) — bornes UI de la basale STYLO (MDI, **U TOTALES**, distinctes de la pompe `basalRate` en U/h).
 * Plancher `MDI_BASAL_MIN_U` (0,5 U) ; plafond = garde anti-overflow SERVEUR (`Decimal(6,2)`) — PAS de plafond
 * clinique dur (U300/dégludec > 80 U légitimes ; le seuil d'alerte `MDI_BASAL_WARN_U` reste non bloquant, surfacé
 * à la revue médecin). Le serveur (`assertValidStyloBasalSet`) reste l'autorité (délivrabilité ½ U comprise).
 */
export const STYLO_BASAL_BOUNDS = { min: CLINICAL_BOUNDS.MDI_BASAL_MIN_U, max: 9999.99 }
