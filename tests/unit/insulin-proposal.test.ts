/**
 * US-2648b — Logique pure du flux de proposition d'ajustement (ISF/ICR).
 * Mapping des réponses serveur → message, et construction du corps de requête.
 */
import { describe, it, expect } from "vitest"
import { mapProposalOutcome, buildProposalBody } from "@/components/diabeo/patient/insulin-proposal"

describe("mapProposalOutcome", () => {
  it("201 → succès", () => {
    expect(mapProposalOutcome(201, undefined)).toEqual({ kind: "success" })
  })

  it.each([
    ["duplicatePendingProposal", "proposalErrorDuplicate"],
    ["valueOutOfBounds", "proposalErrorOutOfBounds"],
    ["patientDecreaseForbidden", "proposalErrorDecreaseForbidden"],
    ["patientDeltaTooLarge", "proposalErrorDeltaTooLarge"],
    ["validationFailed", "proposalErrorValidation"],
    ["gdprConsentRequired", "proposalErrorConsent"],
  ])("code %s → %s", (code, key) => {
    expect(mapProposalOutcome(409, code)).toEqual({ kind: "error", messageKey: key })
  })

  it("code inconnu → message générique", () => {
    expect(mapProposalOutcome(500, "serverError")).toEqual({ kind: "error", messageKey: "proposalErrorGeneric" })
  })

  it("sans code → message générique", () => {
    expect(mapProposalOutcome(500, undefined)).toEqual({ kind: "error", messageKey: "proposalErrorGeneric" })
  })
})

describe("buildProposalBody", () => {
  it("ISF → champs timeSlot + reason manualAdjustment (provenance serveur)", () => {
    expect(
      buildProposalBody({ parameterType: "insulinSensitivityFactor", proposedValue: 0.55, startHour: 8, endHour: 12 }),
    ).toEqual({
      parameterType: "insulinSensitivityFactor",
      proposedValue: 0.55,
      reason: "manualAdjustment",
      timeSlotStartHour: 8,
      timeSlotEndHour: 12,
    })
  })

  it("ICR → champs carbRatio + commentaire chiffré côté serveur", () => {
    expect(
      buildProposalBody({ parameterType: "insulinToCarbRatio", proposedValue: 10, startHour: 8, endHour: 12, comment: "hypos matin" }),
    ).toEqual({
      parameterType: "insulinToCarbRatio",
      proposedValue: 10,
      reason: "manualAdjustment",
      carbRatioSlotStart: 8,
      carbRatioSlotEnd: 12,
      proposerComment: "hypos matin",
    })
  })

  it("sans commentaire → pas de clé proposerComment", () => {
    const body = buildProposalBody({ parameterType: "insulinSensitivityFactor", proposedValue: 0.5, startHour: 0, endHour: 6 })
    expect(body).not.toHaveProperty("proposerComment")
  })
})
