/**
 * Test suite: Field Encryption Helpers — AES-256-GCM Base64 Field Codec
 *
 * Clinical behavior tested:
 * - encryptField wraps raw AES-256-GCM output (IV + TAG + CIPHERTEXT Uint8Array)
 *   into a base64 string safe for storage in PostgreSQL String columns
 * - safeDecryptField reverses the process: it decodes base64, reconstructs the
 *   Uint8Array, and passes it to the core decrypt primitive, returning plaintext
 * - The helpers are the single canonical codec used by patient.service,
 *   user.service, appointment.service, and events.service to protect PII and
 *   health data fields before any Prisma write
 *
 * Associated risks:
 * - A bug in encryptField producing utf-8 encoding instead of base64 would
 *   silently corrupt stored data (ADR #2 — "NEVER Buffer.toString('utf8')")
 * - A safeDecryptField that swallows errors instead of propagating them would
 *   cause services to return empty strings to the UI, masking a key-rotation or
 *   data-corruption problem
 * - IV reuse due to a non-random IV source would break AES-GCM confidentiality
 *   across all patient records sharing the same plaintext value
 *
 * Edge cases:
 * - Same plaintext encrypted twice must yield different base64 strings (random IV)
 * - Empty string as plaintext input (must encrypt and round-trip correctly)
 * - Unicode / accented characters in plaintext (e.g. "Hélène Müller")
 * - Corrupted base64 string passed to safeDecryptField (must throw, not return
 *   garbage)
 * - Truncated ciphertext missing the GCM authentication tag (must throw
 *   HealthDataDecryptionError on tag mismatch)
 */
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
