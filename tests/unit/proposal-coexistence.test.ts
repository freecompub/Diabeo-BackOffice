/**
 * US-2663 (S3b-0b) — Indice de COEXISTENCE (helper pur) : au plus 1 proposition ALGORITHME et 1 proposition
 * HUMAINE (patient/infirmier/médecin) peuvent être `pending` simultanément sur le même paramètre (décision
 * produit D2, supersession par classe d'origine — cf. `slot-set-proposal.service.ts` `createSetProposal`).
 * `deriveCoexistsWith` détecte cette coexistence pour l'écran de revue médecin.
 */
import { describe, it, expect } from "vitest"
import { deriveCoexistsWith, type CoexistenceCandidate } from "@/lib/insulin/proposal-coexistence"

describe("deriveCoexistsWith", () => {
  it("algorithme + humain sur le même paramètre → chacun pointe vers la provenance de l'autre", () => {
    const candidates: CoexistenceCandidate[] = [
      { id: "algo", parameterType: "insulinSensitivityFactor", source: "algorithm" },
      { id: "human", parameterType: "insulinSensitivityFactor", source: "patient" },
    ]
    const result = deriveCoexistsWith(candidates)
    expect(result.get("algo")).toBe("patient")
    expect(result.get("human")).toBe("algorithm")
  })

  it("deux propositions humaines (même classe d'origine) sur le même paramètre → pas de coexistence détectée", () => {
    // Ne devrait jamais survenir en usage normal (index unique 1 pending/paramètre/classe), mais le helper
    // reste fail-closed sur la classe, pas sur l'identité : deux `patient`/`nurse` ne « coexistent » pas ici.
    const candidates: CoexistenceCandidate[] = [
      { id: "p1", parameterType: "insulinSensitivityFactor", source: "patient" },
      { id: "p2", parameterType: "insulinSensitivityFactor", source: "nurse" },
    ]
    const result = deriveCoexistsWith(candidates)
    expect(result.get("p1")).toBeNull()
    expect(result.get("p2")).toBeNull()
  })

  it("paramètres différents → pas de coexistence même avec des classes d'origine différentes", () => {
    const candidates: CoexistenceCandidate[] = [
      { id: "algo-isf", parameterType: "insulinSensitivityFactor", source: "algorithm" },
      { id: "human-icr", parameterType: "insulinToCarbRatio", source: "patient" },
    ]
    const result = deriveCoexistsWith(candidates)
    expect(result.get("algo-isf")).toBeNull()
    expect(result.get("human-icr")).toBeNull()
  })

  it("liste à un seul élément → pas de coexistence", () => {
    const result = deriveCoexistsWith([{ id: "only", parameterType: "insulinSensitivityFactor", source: "doctor" }])
    expect(result.get("only")).toBeNull()
  })

  it("liste vide → map vide", () => {
    expect(deriveCoexistsWith([]).size).toBe(0)
  })
})
