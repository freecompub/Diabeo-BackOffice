/**
 * Métadonnées PURES par paramètre insuline (ISF/ICR/basal) : endpoint d'écriture groupée +
 * nom du champ de valeur attendu par la route `PUT` correspondante.
 *
 * Module NEUTRE (aucune dépendance fetch/DOM) — extrait de l'ex-`insulin-direct-edit.ts`
 * (US-2648b, voie `PATCH` par-créneau) lors du retrait grouped-only (US-2657, ADR #23) :
 * les routes `PATCH`/`POST` par-créneau ont disparu, mais `ENDPOINT`/`VALUE_FIELD` restent la
 * source unique du couple (endpoint, champ) réutilisée par `insulin-slot-set-edit.ts` pour
 * construire les requêtes `PUT` « remplace le jeu complet ».
 */
import type { ProposableParameter } from "@/components/diabeo/patient/insulin-proposal"

/** Endpoint `PUT` (remplacement groupé) par paramètre. */
export const ENDPOINT: Record<ProposableParameter, string> = {
  insulinSensitivityFactor: "/api/insulin-therapy/sensitivity-factors",
  insulinToCarbRatio: "/api/insulin-therapy/carb-ratios",
  basalRate: "/api/insulin-therapy/basal-config/pump-slots",
}

/** Nom du champ de valeur attendu par la route `PUT` selon le paramètre. */
export const VALUE_FIELD: Record<ProposableParameter, string> = {
  insulinSensitivityFactor: "sensitivityFactorGl",
  insulinToCarbRatio: "gramsPerUnit",
  basalRate: "rate",
}
