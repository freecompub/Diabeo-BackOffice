/**
 * Tests — helpers PURS de la voie manuelle GROUPÉE (proposition), US-2663 S4.
 *
 * Verrous cliniques/contrat couverts (sans DOM ni fetch) :
 *  - `mapSlotSetOutcome` accepte `201` (proposition créée) en plus de `200` (application directe),
 *    et mappe les codes de la garde patient (DKA / maturité / cap / mode) sur des clés i18n distinctes.
 *  - `hasStyloDecrease` détecte une BAISSE de dose stylo (déclencheur de l'accusé DKA).
 *  - les constructeurs de requête ciblent la BONNE route selon l'audience (pro `POST /api/slot-set-proposals`
 *    vs patient own-id `PUT /api/patient/insulin-slot-set`), le BON champ de valeur (forme `grouped-proposal` :
 *    `value` ISF/ICR/stylo, `rate` pompe), et ne transmettent `sickDayAcknowledged` qu'en audience patient.
 */
import { describe, it, expect } from "vitest"
import {
  mapSlotSetOutcome,
  hasStyloDecrease,
  buildProposeRequest,
  buildProposeBasalRequest,
  buildProposeStyloRequest,
  type SlotRow,
  type BasalSlotRow,
  type StyloDoseRow,
} from "@/components/diabeo/patient/insulin-slot-set-edit"

describe("mapSlotSetOutcome — voie groupée", () => {
  it("200 et 201 → succès (application directe / proposition créée)", () => {
    expect(mapSlotSetOutcome(200, undefined)).toEqual({ kind: "success" })
    expect(mapSlotSetOutcome(201, undefined)).toEqual({ kind: "success" })
  })

  it("mappe les codes de la garde clinique patient (S4)", () => {
    const cases: Array<[number, string, string]> = [
      [403, "maturityTooLowForDecrease", "slotSetErrorMaturityTooLow"],
      [422, "dkaAcknowledgmentRequired", "slotSetErrorDkaRequired"],
      [422, "patientDeltaTooLarge", "slotSetErrorDeltaTooLarge"],
      [422, "noChangeProposed", "slotSetErrorNoChange"],
      [409, "deliveryModeMismatch", "slotSetErrorModeMismatch"],
      [422, "structuralChangeNotAllowed", "slotSetErrorStructural"],
      [403, "forbidden", "slotSetErrorForbidden"],
      [429, "rateLimitExceeded", "slotSetErrorRateLimited"],
    ]
    for (const [status, code, key] of cases) {
      expect(mapSlotSetOutcome(status, code)).toEqual({ kind: "error", messageKey: key })
    }
  })

  it("code inconnu → message générique", () => {
    expect(mapSlotSetOutcome(500, "boom")).toEqual({ kind: "error", messageKey: "slotSetErrorGeneric" })
  })
})

describe("hasStyloDecrease", () => {
  const row = (kind: StyloDoseRow["kind"], value: string, initialValue: number): StyloDoseRow => ({
    key: kind,
    kind,
    value,
    initialValue,
  })

  it("baisse détectée (valeur saisie < dose active)", () => {
    expect(hasStyloDecrease([row("daily", "18", 20)])).toBe(true)
  })

  it("hausse ou égalité → pas de baisse", () => {
    expect(hasStyloDecrease([row("daily", "22", 20)])).toBe(false)
    expect(hasStyloDecrease([row("daily", "20", 20)])).toBe(false)
  })

  it("valeur non parseable ignorée (pas une baisse)", () => {
    expect(hasStyloDecrease([row("daily", "", 20)])).toBe(false)
  })

  it("jeu split : une seule baisse suffit", () => {
    expect(hasStyloDecrease([row("morning", "12", 12), row("evening", "8", 10)])).toBe(true)
  })
})

describe("buildProposeRequest — ISF/ICR (forme grouped-proposal `value`)", () => {
  const isfRows: SlotRow[] = [{ key: "a", startHour: 0, endHour: 24, value: "0,45" }]

  it("audience pro → POST /api/slot-set-proposals, proposedSlots", () => {
    const req = buildProposeRequest("insulinSensitivityFactor", isfRows, "pro")
    expect(req).toEqual({
      endpoint: "/api/slot-set-proposals",
      method: "POST",
      body: { parameterType: "insulinSensitivityFactor", proposedSlots: [{ startHour: 0, endHour: 24, value: 0.45 }] },
    })
  })

  it("audience patient → PUT /api/patient/insulin-slot-set, slots (mealLabel ICR préservé)", () => {
    const icrRows: SlotRow[] = [{ key: "a", startHour: 7, endHour: 12, value: "10", mealLabel: "petit-déjeuner" }]
    const req = buildProposeRequest("insulinToCarbRatio", icrRows, "patient")
    expect(req).toEqual({
      endpoint: "/api/patient/insulin-slot-set",
      method: "PUT",
      body: {
        parameterType: "insulinToCarbRatio",
        slots: [{ startHour: 7, endHour: 12, value: 10, mealLabel: "petit-déjeuner" }],
      },
    })
  })
})

describe("buildProposeBasalRequest — pompe (forme `rate`)", () => {
  const rows: BasalSlotRow[] = [{ key: "a", startTime: "00:00", endTime: "00:00", value: "0,8" }]

  it("pro → proposedSlots avec rate", () => {
    const req = buildProposeBasalRequest(rows, "pro")
    expect(req.method).toBe("POST")
    expect(req.body).toEqual({ parameterType: "basalRate", proposedSlots: [{ startTime: "00:00", endTime: "00:00", rate: 0.8 }] })
  })

  it("patient → slots avec rate (pas d'accusé DKA pompe)", () => {
    const req = buildProposeBasalRequest(rows, "patient")
    expect(req.method).toBe("PUT")
    expect(req.body).toEqual({ parameterType: "basalRate", slots: [{ startTime: "00:00", endTime: "00:00", rate: 0.8 }] })
    expect(req.body).not.toHaveProperty("sickDayAcknowledged")
  })
})

describe("buildProposeStyloRequest — stylo (forme `{kind, value}`, U totales)", () => {
  const rows: StyloDoseRow[] = [{ key: "d", kind: "daily", value: "18", initialValue: 20 }]

  it("patient + accusé DKA → sickDayAcknowledged true", () => {
    const req = buildProposeStyloRequest(rows, "patient", true)
    expect(req).toEqual({
      endpoint: "/api/patient/insulin-slot-set",
      method: "PUT",
      body: { parameterType: "basalRate", slots: [{ kind: "daily", value: 18 }], sickDayAcknowledged: true },
    })
  })

  it("patient sans accusé → pas de champ sickDayAcknowledged", () => {
    const req = buildProposeStyloRequest(rows, "patient", undefined)
    expect(req.body).not.toHaveProperty("sickDayAcknowledged")
  })

  it("pro → POST, proposedSlots, jamais d'accusé", () => {
    const req = buildProposeStyloRequest(rows, "pro", true)
    expect(req.method).toBe("POST")
    expect(req.endpoint).toBe("/api/slot-set-proposals")
    expect(req.body).toEqual({ parameterType: "basalRate", proposedSlots: [{ kind: "daily", value: 18 }] })
  })
})
