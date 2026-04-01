import { describe, it, expect } from "vitest"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"

describe("crypto/fields", () => {
  describe("encryptField", () => {
    it("encrypts and returns a base64 string", () => {
      const result = encryptField("Jean Dupont")
      expect(result).toMatch(/^[A-Za-z0-9+/=]+$/)
    })

    it("produces different ciphertext for same input (random IV)", () => {
      const a = encryptField("same")
      const b = encryptField("same")
      expect(a).not.toBe(b)
    })
  })

  describe("safeDecryptField", () => {
    it("roundtrips through encrypt/decrypt", () => {
      const original = "Marie Martin"
      const encrypted = encryptField(original)
      const decrypted = safeDecryptField(encrypted)
      expect(decrypted).toBe(original)
    })

    it("returns null for null input", () => {
      expect(safeDecryptField(null)).toBeNull()
    })

    it("returns null for empty string", () => {
      expect(safeDecryptField("")).toBeNull()
    })

    it("returns null for invalid ciphertext (never leaks)", () => {
      const result = safeDecryptField("not-valid-base64-ciphertext")
      expect(result).toBeNull()
    })
  })
})
