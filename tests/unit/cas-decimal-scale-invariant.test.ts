/**
 * Verrou d'invariant — CAS atomique de `adjustmentService.accept()` (US-2660).
 *
 * Comportement clinique verrouillé :
 *   L'écriture d'une dose/réglage à l'acceptation médecin utilise un compare-and-swap ATOMIQUE :
 *   la valeur attendue `AdjustmentProposal.currentValue` (Decimal(8,4)) est verrouillée dans le
 *   `WHERE` de l'`updateMany` de chaque levier. Ce verrou repose sur un INVARIANT de précision :
 *   `currentValue` (scale 4) doit capturer SANS TRONCATURE la valeur de la colonne cible à la
 *   création. Cela n'est vrai que si TOUTE colonne de dose cible a une scale ≤ 4.
 *
 * Risque couvert :
 *   Si une future migration portait une colonne de dose à une scale > 4, `currentValue` tronquerait
 *   la valeur source → l'égalité CAS échouerait sur un apply LÉGITIME (base inchangée) → faux
 *   fail-closed → le médecin ne pourrait plus appliquer la proposition (dégradation de disponibilité ;
 *   jamais une mauvaise dose, le mode restant fail-closed). Ce test casse AVANT le déploiement d'un
 *   tel schéma, forçant à revoir la stratégie de CAS (cf. commentaire dans `adjustment.service.ts`).
 *
 * Source de vérité : `prisma/schema.prisma` (lu au runtime, pas de valeur dupliquée).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const schema = readFileSync(resolve(__dirname, "../../prisma/schema.prisma"), "utf8")

/** Extrait la `scale` d'un champ Prisma `@db.Decimal(precision, scale)` par nom de champ exact. */
function decimalScale(fieldName: string): number {
  // Ancre `^\s*<field>\s` → nom de champ EXACT en début de ligne (évite les collisions type
  // `rate` ⊄ `scheduleRate`/`taxRate`). Capture la scale (2ᵉ argument de @db.Decimal).
  const re = new RegExp(
    String.raw`^\s*${fieldName}\s+Decimal[^\n]*@db\.Decimal\(\s*\d+\s*,\s*(\d+)\s*\)`,
    "m",
  )
  const m = schema.match(re)
  if (!m) throw new Error(`Champ Decimal introuvable dans schema.prisma : ${fieldName}`)
  return Number(m[1])
}

describe("US-2660 — invariant de scale du CAS atomique (accept)", () => {
  const CAS_REFERENCE = "currentValue" // AdjustmentProposal.currentValue

  // Les 5 colonnes de dose écrites par les 5 leviers d'apply de `accept()`.
  const TARGET_DOSE_COLUMNS = [
    "sensitivityFactorGl", // ISF  — Decimal(6,4)
    "gramsPerUnit",        // ICR  — Decimal(5,2)
    "rate",                // pompe — Decimal(5,3)
    "valueU",              // dose fixe — Decimal(5,2)
    "dailyDose",           // stylo daily — Decimal(6,2)
    "morningDose",         // stylo split matin — Decimal(6,2)
    "eveningDose",         // stylo split soir — Decimal(6,2)
  ]

  it("currentValue (référence CAS) a bien une scale de 4", () => {
    expect(decimalScale(CAS_REFERENCE)).toBe(4)
  })

  it.each(TARGET_DOSE_COLUMNS)(
    "la colonne cible %s a une scale ≤ scale(currentValue)=4 (round-trip CAS sans troncature)",
    (column) => {
      const refScale = decimalScale(CAS_REFERENCE)
      expect(decimalScale(column)).toBeLessThanOrEqual(refScale)
    },
  )
})
