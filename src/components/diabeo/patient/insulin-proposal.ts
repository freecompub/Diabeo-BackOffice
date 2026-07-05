/**
 * US-2648b — Mapping PUR du résultat d'une proposition d'ajustement (fonction sans
 * dépendance) : (statut HTTP, code d'erreur métier) → issue + clé i18n de message.
 *
 * Codes renvoyés par `POST /api/adjustment-proposals` (US-2648a). Séparé du composant
 * pour être testable sans i18n ni fetch.
 */
import type { EditableParameter } from "@/lib/insulin/edit-capability"

/** Paramètres proposables via l'UI : ISF/ICR (créneau horaire) + basal (créneau pompe). */
export type ProposableParameter = EditableParameter

/**
 * Cible d'une proposition : créneau HORAIRE (ISF/ICR, adressé par heure) ou créneau
 * POMPE (basal, adressé par `pumpBasalSlotId`). Discriminée pour construire le bon
 * champ de créneau attendu par la route.
 */
export type ProposalTarget =
  | { kind: "timeSlot"; startHour: number; endHour: number }
  | { kind: "pumpSlot"; pumpBasalSlotId: string }

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
  basalRate: "proposalParamBasal",
}

/**
 * Construit le corps de la proposition. Le champ de créneau dépend de la cible :
 * ISF → `timeSlot*`, ICR → `carbRatioSlot*`, basal → `pumpBasalSlotId`. `patientId` est
 * ajouté par le transport de mutation (adaptateur). `reason` fixé à `manualAdjustment` :
 * la vraie provenance (patient/nurse/doctor) est dérivée SERVEUR du rôle de session
 * (`source`), pas de ce champ.
 */
export function buildProposalBody(args: {
  parameterType: ProposableParameter
  proposedValue: number
  target: ProposalTarget
  comment?: string
}): Record<string, unknown> {
  const { parameterType, proposedValue, target, comment } = args
  let slot: Record<string, unknown>
  if (target.kind === "pumpSlot") {
    slot = { pumpBasalSlotId: target.pumpBasalSlotId }
  } else if (parameterType === "insulinSensitivityFactor") {
    slot = { timeSlotStartHour: target.startHour, timeSlotEndHour: target.endHour }
  } else {
    slot = { carbRatioSlotStart: target.startHour, carbRatioSlotEnd: target.endHour }
  }
  return {
    parameterType,
    proposedValue,
    reason: "manualAdjustment",
    ...slot,
    ...(comment ? { proposerComment: comment } : {}),
  }
}
