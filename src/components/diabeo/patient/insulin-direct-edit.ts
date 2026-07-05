/**
 * US-2648b — Logique PURE de l'édition DIRECTE (DOCTOR) d'un créneau insuline
 * (`PATCH /api/insulin-therapy/*`). Construit la requête (endpoint + corps par
 * paramètre) et mappe la réponse serveur → message. Testable sans i18n ni fetch.
 */
import type { ProposableParameter } from "@/components/diabeo/patient/insulin-proposal"

const ENDPOINT: Record<ProposableParameter, string> = {
  insulinSensitivityFactor: "/api/insulin-therapy/sensitivity-factors",
  insulinToCarbRatio: "/api/insulin-therapy/carb-ratios",
  basalRate: "/api/insulin-therapy/basal-config/pump-slots",
}

/** Nom du champ de valeur attendu par la route PATCH selon le paramètre. */
const VALUE_FIELD: Record<ProposableParameter, string> = {
  insulinSensitivityFactor: "sensitivityFactorGl",
  insulinToCarbRatio: "gramsPerUnit",
  basalRate: "rate",
}

/**
 * Requête d'édition directe : endpoint PATCH + corps `{ id, <champ valeur> }`.
 * `patientId` est ajouté par le transport de mutation (adaptateur).
 */
export function directEditRequest(
  parameterType: ProposableParameter,
  id: string,
  value: number,
): { endpoint: string; body: Record<string, unknown> } {
  return { endpoint: ENDPOINT[parameterType], body: { id, [VALUE_FIELD[parameterType]]: value } }
}

export type DirectEditOutcome = { kind: "success" } | { kind: "error"; messageKey: string }

const ERROR_KEY: Record<string, string> = {
  validationFailed: "directEditErrorValidation",
  patientNotFound: "directEditErrorNotFound",
  isfSlotNotFound: "directEditErrorNotFound",
  icrSlotNotFound: "directEditErrorNotFound",
  pumpSlotNotFound: "directEditErrorNotFound",
  gdprConsentRequired: "directEditErrorConsent",
}

/** (statut HTTP, code d'erreur) → issue. `200` = enregistré (`{ updated: true }`). */
export function mapDirectEditOutcome(status: number, code: string | undefined): DirectEditOutcome {
  if (status === 200) return { kind: "success" }
  return { kind: "error", messageKey: ERROR_KEY[code ?? ""] ?? "directEditErrorGeneric" }
}
