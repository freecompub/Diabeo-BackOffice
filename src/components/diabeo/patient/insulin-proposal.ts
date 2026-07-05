/**
 * US-2648b — Mapping PUR du résultat d'une proposition d'ajustement (fonction sans
 * dépendance) : (statut HTTP, code d'erreur métier) → issue + clé i18n de message.
 *
 * Codes renvoyés par `POST /api/adjustment-proposals` (US-2648a). Séparé du composant
 * pour être testable sans i18n ni fetch.
 */
import type { EditableParameter } from "@/lib/insulin/edit-capability"

/** Paramètres proposables via l'UI de ce slice (basal différé — nécessite pumpBasalSlotId). */
export type ProposableParameter = Extract<EditableParameter, "insulinSensitivityFactor" | "insulinToCarbRatio">

export type ProposalOutcome = { kind: "success" } | { kind: "error"; messageKey: string }

/** Code d'erreur métier → clé i18n (namespace `patientDetail`). */
const PROPOSAL_ERROR_KEY: Record<string, string> = {
  duplicatePendingProposal: "proposalErrorDuplicate",
  valueOutOfBounds: "proposalErrorOutOfBounds",
  patientDecreaseForbidden: "proposalErrorDecreaseForbidden",
  patientDeltaTooLarge: "proposalErrorDeltaTooLarge",
  validationFailed: "proposalErrorValidation",
  gdprConsentRequired: "proposalErrorConsent",
}

/**
 * Traduit la réponse serveur en issue affichable.
 * @param status Statut HTTP (`201` = créé).
 * @param code Code d'erreur métier du corps (`{ error }`), le cas échéant.
 */
export function mapProposalOutcome(status: number, code: string | undefined): ProposalOutcome {
  if (status === 201) return { kind: "success" }
  return { kind: "error", messageKey: PROPOSAL_ERROR_KEY[code ?? ""] ?? "proposalErrorGeneric" }
}

/** Clé i18n du libellé d'un paramètre proposable. */
export const PARAM_LABEL_KEY: Record<ProposableParameter, string> = {
  insulinSensitivityFactor: "proposalParamIsf",
  insulinToCarbRatio: "proposalParamIcr",
}

/**
 * Construit le corps de la proposition pour un créneau ISF/ICR (le champ de créneau
 * dépend du paramètre). `patientId` est ajouté par le transport de mutation (adaptateur).
 * `reason` fixé à `manualAdjustment` : la vraie provenance (patient/nurse/doctor) est
 * dérivée SERVEUR du rôle de session (`source`), pas de ce champ.
 */
export function buildProposalBody(args: {
  parameterType: ProposableParameter
  proposedValue: number
  startHour: number
  endHour: number
  comment?: string
}): Record<string, unknown> {
  const { parameterType, proposedValue, startHour, endHour, comment } = args
  const slot =
    parameterType === "insulinSensitivityFactor"
      ? { timeSlotStartHour: startHour, timeSlotEndHour: endHour }
      : { carbRatioSlotStart: startHour, carbRatioSlotEnd: endHour }
  return {
    parameterType,
    proposedValue,
    reason: "manualAdjustment",
    ...slot,
    ...(comment ? { proposerComment: comment } : {}),
  }
}
