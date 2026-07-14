/**
 * US-2663 — Garde clinique PATIENT de la voie manuelle GROUPÉE (`evaluatePatientGroupedGate`).
 *
 * Comportement clinique testé (risques associés) — spec validée `medical-domain-validator` :
 *  - **ENVELOPPE minute-par-minute** ISF/ICR/pompe : pour chaque minute des 24 h, l'écart proposé↔base couvrante
 *    reste ≤ 10 %. Ferme la faille S4 par déplacement de frontière (étendre une valeur agressive) ET la
 *    redistribution pompe à total constant (concentration nocturne = hypo). Le socle 24 h (validé en amont) est
 *    supposé : les fixtures ci-dessous COUVRENT réellement 24 h (via passage minuit `endHour/endTime = 0`).
 *  - **RESTRUCTURATION** (frontières/cardinalité ≠ base) réservée INTERMEDIATE+ ; JUNIOR = valeurs-seules.
 *  - **STYLO : modalité VERROUILLÉE** — bascule single↔split interdite au patient (`structuralChangeNotAllowed`).
 *    À modalité identique : baisse → CONFIRME + accusé DKA BLOQUANT + cap min(10 %, 2 U) + snap incrément.
 *  - **D3** : un seul accusé DKA couvre toutes les baisses stylo d'un jeu mixte.
 *  - cohérence de mode (forme stylo/pompe vs `configType` LIVE) — anti-usurpation.
 */
import { describe, it, expect } from "vitest"
import { evaluatePatientGroupedGate } from "@/lib/insulin/patient-grouped-gate"

// Helpers — jeux COUVRANT 24 h (le socle `assertValidGroupedSet` le garantit en prod).
const s = (startHour: number, endHour: number, value: number) => ({ startHour, endHour, value })
/** ISF/ICR une-valeur toute la journée (2 créneaux, passage minuit). */
const isfFull = (value: number) => [s(0, 12, value), s(12, 0, value)]
const p = (startTime: string, endTime: string, rate: number) => ({ startTime, endTime, rate })
/** Pompe un-débit toute la journée. */
const pumpFull = (rate: number) => [p("00:00", "12:00", rate), p("12:00", "00:00", rate)]
const stylo = (kind: "daily" | "morning" | "evening", value: number) => ({ kind, value })

describe("gate ISF/ICR — enveloppe minute (valeurs, même structure)", () => {
  it("changement ≤ 10 % (hausse) → OK, pas d'audit de baisse", () => {
    const res = evaluatePatientGroupedGate({
      parameterType: "insulinSensitivityFactor",
      slots: isfFull(0.55), baseline: isfFull(0.5), // +10 %
      isPen: false, maturity: "JUNIOR", sickDayAcknowledged: false,
    })
    expect(res.sickDayAckAt).toBeNull()
    expect(res.decreaseAudit).toBeNull()
  })
  it("baisse ISF > 10 % (= plus d'insuline) → patientDeltaTooLarge (bilatéral)", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "insulinSensitivityFactor",
      slots: isfFull(0.4), baseline: isfFull(0.5), // −20 %
      isPen: false, maturity: "JUNIOR", sickDayAcknowledged: false,
    })).toThrow("patientDeltaTooLarge")
  })
  it("un seul créneau hors cap dans un jeu multi-créneaux → patientDeltaTooLarge", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "insulinToCarbRatio",
      slots: [s(0, 8, 10), s(8, 16, 13), s(16, 0, 10)], // 8h–16h : 10→13 = +30 %
      baseline: [s(0, 8, 10), s(8, 16, 10), s(16, 0, 10)],
      isPen: false, maturity: "JUNIOR", sickDayAcknowledged: false,
    })).toThrow("patientDeltaTooLarge")
  })
})

describe("gate ISF/ICR — RESTRUCTURATION (frontières)", () => {
  it("INTERMEDIATE, restructuration dans l'enveloppe (frontière déplacée, valeurs ~constantes) → OK", () => {
    const res = evaluatePatientGroupedGate({
      parameterType: "insulinSensitivityFactor",
      slots: [s(0, 8, 0.52), s(8, 0, 0.52)], baseline: isfFull(0.5), // frontière 12h→8h, +4 %
      isPen: false, maturity: "INTERMEDIATE", sickDayAcknowledged: false,
    })
    expect(res.decreaseAudit).toBeNull() // ISF : pas de gate maturité/DKA sur un ratio
  })
  it("JUNIOR ne peut PAS restructurer → structuralChangeNotAllowed", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "insulinSensitivityFactor",
      slots: [s(0, 8, 0.5), s(8, 0, 0.5)], baseline: isfFull(0.5), // frontière déplacée
      isPen: false, maturity: "JUNIOR", sickDayAcknowledged: false,
    })).toThrow("structuralChangeNotAllowed")
  })
  it("CRITICAL — déplacement de frontière étendant une valeur agressive → patientDeltaTooLarge (faille S4 fermée)", () => {
    // Base : nuit 0,50 · aube AGRESSIVE 0,25 (6h–10h) · jour 0,50. Proposé : étend 0,25 de 6h à MINUIT.
    // « valeur au début » passerait (créneau démarre à 6h où base=0,25) ; l'ENVELOPPE capte 10h→24h (base 0,50).
    expect(() => evaluatePatientGroupedGate({
      parameterType: "insulinSensitivityFactor",
      slots: [s(0, 6, 0.5), s(6, 0, 0.25)],
      baseline: [s(0, 6, 0.5), s(6, 10, 0.25), s(10, 0, 0.5)],
      isPen: false, maturity: "INTERMEDIATE", sickDayAcknowledged: false,
    })).toThrow("patientDeltaTooLarge")
  })
  it("base VIDE (patient non paramétré) → structuralChangeNotAllowed (config initiale = acte clinicien)", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "insulinSensitivityFactor",
      slots: isfFull(0.5), baseline: [],
      isPen: false, maturity: "CONFIRME", sickDayAcknowledged: false,
    })).toThrow("structuralChangeNotAllowed")
  })
})

describe("gate POMPE — enveloppe minute", () => {
  it("hausse dans le cap → OK", () => {
    const res = evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: pumpFull(1.05), baseline: pumpFull(1.0), // +5 %
      isPen: false, maturity: "JUNIOR", sickDayAcknowledged: false,
    })
    expect(res.decreaseAudit).toBeNull()
  })
  it("hausse > 10 % → patientDeltaTooLarge", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: pumpFull(1.2), baseline: pumpFull(1.0), // +20 %
      isPen: false, maturity: "CONFIRME", sickDayAcknowledged: false,
    })).toThrow("patientDeltaTooLarge")
  })
  it("baisse (value-only) INTERMEDIATE → OK, audit pompe ; JUNIOR → maturityTooLowForDecrease", () => {
    const res = evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: pumpFull(0.95), baseline: pumpFull(1.0), // −5 %
      isPen: false, maturity: "INTERMEDIATE", sickDayAcknowledged: false,
    })
    expect(res.decreaseAudit).toMatchObject({ deliveryMode: "pump", direction: "decrease" })
    expect(res.sickDayAckAt).toBeNull() // pompe : pas d'accusé DKA
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: pumpFull(0.95), baseline: pumpFull(1.0),
      isPen: false, maturity: "JUNIOR", sickDayAcknowledged: false,
    })).toThrow("maturityTooLowForDecrease")
  })
  it("CRITICAL — redistribution à TOTAL CONSTANT (concentration nocturne) → patientDeltaTooLarge", () => {
    // Base plate 0,50 U/h (12 U/j). Proposé : 2,0 U/h de 0h à 3h, puis ~0,29 U/h — total ≈ 12 U/j INCHANGÉ,
    // mais 4× le débit la nuit = risque d'hypo nocturne. Le gate dose-totale passerait ; l'enveloppe capte 0h–3h.
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate",
      slots: [p("00:00", "03:00", 2.0), p("03:00", "00:00", 0.29)],
      baseline: pumpFull(0.5),
      isPen: false, maturity: "CONFIRME", sickDayAcknowledged: false,
    })).toThrow("patientDeltaTooLarge")
  })
})

describe("gate STYLO — modalité verrouillée + baisse gatée (US-2659)", () => {
  const base = [stylo("evening", 10)]
  const dec = [stylo("evening", 9)] // −1 U (= 10 %, délivrable)

  it("CONFIRME + accusé DKA → OK, sickDayAckAt posé, audit enrichi", () => {
    const res = evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: dec, baseline: base,
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: true,
    })
    expect(res.sickDayAckAt).toBeInstanceOf(Date)
    expect(res.decreaseAudit).toMatchObject({ direction: "decrease", deliveryMode: "pen", dkaAcknowledged: true, maturityAtDecision: "CONFIRME", decreaseCount: 1 })
  })
  it("accusé DKA manquant → dkaAcknowledgmentRequired", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: dec, baseline: base,
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: false,
    })).toThrow("dkaAcknowledgmentRequired")
  })
  it("INTERMEDIATE (stylo exige CONFIRME) → maturityTooLowForDecrease", () => {
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
      parameterType: "basalRate", slots: [stylo("evening", 9.5)], baseline: [stylo("evening", 10)], // −0,5 U
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: true,
    })).toThrow("noChangeProposed")
  })
  it("CRITICAL — bascule single→split (daily → morning+evening), même CONFIRME → structuralChangeNotAllowed", () => {
    // Exploit : baisse 20 U → 2+2 U (−80 %) déguisée en restructuration. La modalité stylo est verrouillée.
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate",
      slots: [stylo("morning", 2), stylo("evening", 2)], baseline: [stylo("daily", 20)],
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: true,
    })).toThrow("structuralChangeNotAllowed")
  })
})

describe("gate STYLO — D3 : jeu MIXTE hausse+baisse, 1 accusé couvre tout", () => {
  it("split matin↑ + soir↓, un seul accusé DKA → OK", () => {
    const res = evaluatePatientGroupedGate({
      parameterType: "basalRate",
      slots: [stylo("morning", 13), stylo("evening", 9)], // matin 12→13 (+1), soir 10→9 (−1)
      baseline: [stylo("morning", 12), stylo("evening", 10)],
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: true,
    })
    expect(res.sickDayAckAt).toBeInstanceOf(Date)
    expect(res.decreaseAudit).toMatchObject({ decreaseCount: 1 })
  })
  it("même jeu SANS accusé → dkaAcknowledgmentRequired", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate",
      slots: [stylo("morning", 13), stylo("evening", 9)],
      baseline: [stylo("morning", 12), stylo("evening", 10)],
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: false,
    })).toThrow("dkaAcknowledgmentRequired")
  })
})

describe("gate — cohérence de mode (anti-usurpation)", () => {
  it("forme STYLO mais config LIVE pompe (isPen=false) → deliveryModeMismatch", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: [stylo("evening", 9)], baseline: [stylo("evening", 10)],
      isPen: false, maturity: "CONFIRME", sickDayAcknowledged: true,
    })).toThrow("deliveryModeMismatch")
  })
  it("forme POMPE mais config LIVE stylo (isPen=true) → deliveryModeMismatch", () => {
    expect(() => evaluatePatientGroupedGate({
      parameterType: "basalRate", slots: pumpFull(0.95), baseline: pumpFull(1.0),
      isPen: true, maturity: "CONFIRME", sickDayAcknowledged: true,
    })).toThrow("deliveryModeMismatch")
  })
})
