/**
 * US-2663 (S4, D3) — Garde clinique PATIENT de la voie manuelle GROUPÉE (`evaluatePatientGroupedGate`).
 *
 * Comportement clinique testé (risques associés) :
 *  - cap de variation patient 10 % (ISF/ICR deux sens ; hausse basale) — borne l'amplitude d'une DEMANDE ;
 *  - BAISSE de basale relâchée mais GATÉE (maturité par mode, accusé DKA stylo BLOQUANT, cap U, snap incrément) —
 *    réduire une basale lente en jour de maladie expose à l'acidocétose (DKA) ;
 *  - **D3** : UN SEUL accusé DKA couvre TOUTES les baisses stylo d'un jeu mixte hausse+baisse ;
 *  - cohérence de mode (forme stylo/pompe vs `configType` LIVE) — anti-usurpation.
 */
import { describe, it, expect } from "vitest"
import { evaluatePatientGroupedGate } from "@/lib/insulin/patient-grouped-gate"

const isf = (startHour: number, value: number) => ({ startHour, endHour: (startHour + 6) % 24, value })
const stylo = (kind: "daily" | "morning" | "evening", value: number) => ({ kind, value })
const pump = (startTime: string, rate: number) => ({ startTime, endTime: "00:00", rate })

describe("evaluatePatientGroupedGate — cap % ISF/ICR", () => {
  it("changement dans le cap 10 % (deux sens) → OK, pas d'audit de baisse", () => {
    const res = evaluatePatientGroupedGate({
      parameterType: "insulinSensitivityFactor",
      slots: [isf(0, 0.55)], baseline: [isf(0, 0.5)], // +10 %
      isPen: false, maturity: "JUNIOR", sickDayAcknowledged: false,
    })
    expect(res.sickDayAckAt).toBeNull()
    expect(res.decreaseAudit).toBeNull()
  })
  it("baisse ISF > 10 % (= plus d'insuline) → patientDeltaTooLarge (les deux sens capés)", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "insulinSensitivityFactor",
      slots: [isf(0, 0.4)], baseline: [isf(0, 0.5)], // −20 %
      isPen: false, maturity: "JUNIOR", sickDayAcknowledged: false,
    })).toThrow("patientDeltaTooLarge")
  })
})

describe("evaluatePatientGroupedGate — hausse basale (cap %)", () => {
  it("hausse pompe dans le cap → OK", () => {
    const res = evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: [pump("00:00", 1.05)], baseline: [pump("00:00", 1.0)], // +5 %
      isPen: false, maturity: "JUNIOR", sickDayAcknowledged: false,
    })
    expect(res.decreaseAudit).toBeNull()
  })
  it("hausse pompe > 10 % → patientDeltaTooLarge", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: [pump("00:00", 1.2)], baseline: [pump("00:00", 1.0)], // +20 %
      isPen: false, maturity: "CONFIRME", sickDayAcknowledged: false,
    })).toThrow("patientDeltaTooLarge")
  })
})

describe("evaluatePatientGroupedGate — BAISSE basale STYLO (gate US-2659)", () => {
  const base = [stylo("evening", 10)]
  const dec = [stylo("evening", 9)] // −1 U (= 10 %, délivrable, ≥ incrément 1 U)

  it("maturité CONFIRME + accusé DKA → OK, sickDayAckAt posé, audit enrichi", () => {
    const res = evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: dec, baseline: base,
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: true,
    })
    expect(res.sickDayAckAt).toBeInstanceOf(Date)
    expect(res.decreaseAudit).toMatchObject({ direction: "decrease", deliveryMode: "pen", dkaAcknowledged: true, maturityAtDecision: "CONFIRME", decreaseCount: 1 })
  })
  it("accusé DKA manquant → dkaAcknowledgmentRequired (bloquant stylo)", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: dec, baseline: base,
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: false,
    })).toThrow("dkaAcknowledgmentRequired")
  })
  it("maturité INTERMEDIATE (stylo exige CONFIRME) → maturityTooLowForDecrease", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: dec, baseline: base,
      isPen: true, maturity: "INTERMEDIATE", sickDayAcknowledged: true,
    })).toThrow("maturityTooLowForDecrease")
  })
  it("amplitude > min(10 %, 2 U) → patientDeltaTooLarge", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: [stylo("evening", 7)], baseline: [stylo("evening", 10)], // −3 U > 2 U
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: true,
    })).toThrow("patientDeltaTooLarge")
  })
  it("baisse infra-incrément (< 1 U) → noChangeProposed", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: [stylo("evening", 9.5)], baseline: [stylo("evening", 10)], // −0,5 U < 1 U
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: true,
    })).toThrow("noChangeProposed")
  })
})

describe("evaluatePatientGroupedGate — BAISSE basale POMPE (gate assoupli)", () => {
  it("maturité INTERMEDIATE suffit (pompe = micro-débit réversible), PAS d'accusé DKA requis", () => {
    const res = evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: [pump("00:00", 0.95)], baseline: [pump("00:00", 1.0)], // −5 %
      isPen: false, maturity: "INTERMEDIATE", sickDayAcknowledged: false,
    })
    expect(res.sickDayAckAt).toBeNull() // pompe → jamais d'accusé DKA persisté
    expect(res.decreaseAudit).toMatchObject({ deliveryMode: "pump", decreaseCount: 1 })
  })
  it("maturité JUNIOR → maturityTooLowForDecrease (refus tous modes)", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: [pump("00:00", 0.95)], baseline: [pump("00:00", 1.0)],
      isPen: false, maturity: "JUNIOR", sickDayAcknowledged: false,
    })).toThrow("maturityTooLowForDecrease")
  })
})

describe("evaluatePatientGroupedGate — D3 : jeu MIXTE hausse+baisse, 1 accusé couvre tout", () => {
  it("split stylo matin↑ + soir↓, un seul accusé DKA → OK (couvre la baisse soir)", () => {
    const res = evaluatePatientGroupedGate({
      parameterType: "basalRate",
      slots: [stylo("morning", 13), stylo("evening", 9)], // matin 12→13 (+1), soir 10→9 (−1)
      baseline: [stylo("morning", 12), stylo("evening", 10)],
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: true,
    })
    expect(res.sickDayAckAt).toBeInstanceOf(Date)
    expect(res.decreaseAudit).toMatchObject({ decreaseCount: 1 }) // seule la baisse soir compte
  })
  it("même jeu mixte SANS accusé → dkaAcknowledgmentRequired (la baisse soir reste gatée)", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate",
      slots: [stylo("morning", 13), stylo("evening", 9)],
      baseline: [stylo("morning", 12), stylo("evening", 10)],
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: false,
    })).toThrow("dkaAcknowledgmentRequired")
  })
})

describe("evaluatePatientGroupedGate — cohérence de mode", () => {
  it("forme STYLO mais config LIVE pompe (isPen=false) → deliveryModeMismatch", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: [stylo("evening", 9)], baseline: [stylo("evening", 10)],
      isPen: false, maturity: "CONFIRME", sickDayAcknowledged: true,
    })).toThrow("deliveryModeMismatch")
  })
  it("forme POMPE mais config LIVE stylo (isPen=true) → deliveryModeMismatch", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: [pump("00:00", 0.95)], baseline: [pump("00:00", 1.0)],
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: true,
    })).toThrow("deliveryModeMismatch")
  })
})
