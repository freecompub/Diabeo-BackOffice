/**
 * US-2648b — Logique pure de l'édition directe (DOCTOR) : requête PATCH par paramètre
 * + mapping de la réponse serveur.
 */
import { describe, it, expect } from "vitest"
import { directEditRequest, mapDirectEditOutcome } from "@/components/diabeo/patient/insulin-direct-edit"

describe("directEditRequest", () => {
  it("ISF → sensitivity-factors + sensitivityFactorGl", () => {
    expect(directEditRequest("insulinSensitivityFactor", "id1", 0.5)).toEqual({
      endpoint: "/api/insulin-therapy/sensitivity-factors",
      body: { id: "id1", sensitivityFactorGl: 0.5 },
    })
  })
  it("ICR → carb-ratios + gramsPerUnit", () => {
    expect(directEditRequest("insulinToCarbRatio", "id2", 10)).toEqual({
      endpoint: "/api/insulin-therapy/carb-ratios",
      body: { id: "id2", gramsPerUnit: 10 },
    })
  })
  it("basal → pump-slots + rate", () => {
    expect(directEditRequest("basalRate", "id3", 0.95)).toEqual({
      endpoint: "/api/insulin-therapy/basal-config/pump-slots",
      body: { id: "id3", rate: 0.95 },
    })
  })
})

describe("mapDirectEditOutcome", () => {
  it("200 → succès", () => {
    expect(mapDirectEditOutcome(200, undefined)).toEqual({ kind: "success" })
  })
  it.each(["isfSlotNotFound", "icrSlotNotFound", "pumpSlotNotFound", "patientNotFound"])(
    "%s → message notFound",
    (code) => {
      expect(mapDirectEditOutcome(404, code)).toEqual({ kind: "error", messageKey: "directEditErrorNotFound" })
    },
  )
  it("validationFailed → message validation", () => {
    expect(mapDirectEditOutcome(400, "validationFailed")).toEqual({ kind: "error", messageKey: "directEditErrorValidation" })
  })
  it("code inconnu → message générique", () => {
    expect(mapDirectEditOutcome(500, "serverError")).toEqual({ kind: "error", messageKey: "directEditErrorGeneric" })
  })
})
