/**
 * Test suite: GET /api/patients/:id/glycemia ciphertext decryption
 *
 * Security boundary tested (US-2032 PARTIAL fix):
 * - `mealDescription` is stored encrypted (AES-256-GCM, base64 in a String
 *   column). The route must decrypt before returning JSON, never leak the
 *   ciphertext blob across the trust boundary.
 *
 * We exercise the serialization helper directly here — the route also goes
 * through `requireAuth`/`requireGdprConsent`/`canAccessPatient` which are
 * covered by their own suites.
 */
import { describe, it, expect } from "vitest"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"

describe("Glycemia entry mealDescription round-trip", () => {
  it("encryptField → safeDecryptField recovers the plaintext", () => {
    const plaintext = "Petit-déjeuner copieux — 75g de pain, café au lait"
    const cipher = encryptField(plaintext)
    expect(cipher).not.toBe(plaintext)
    expect(cipher).not.toMatch(/déjeuner/)
    const recovered = safeDecryptField(cipher)
    expect(recovered).toBe(plaintext)
  })

  it("safeDecryptField returns null for a malformed/garbage value", () => {
    expect(safeDecryptField("not-base64-cipher")).toBeNull()
  })
})
