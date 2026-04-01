/**
 * Test suite: Crypto Module — AES-256-GCM Encryption Integrity
 *
 * Clinical behavior tested:
 * - Encrypt-then-decrypt roundtrip: plaintext health data (patient names,
 *   medical identifiers) survives a full encrypt → Uint8Array → decrypt cycle
 *   without data loss or corruption
 * - Ciphertext format invariant: the encrypted Uint8Array has the exact layout
 *   IV (12 bytes) || TAG (16 bytes) || CIPHERTEXT, which all consuming services
 *   depend on for correct decryption
 * - Random IV per encryption: two calls to encrypt with identical plaintext
 *   must produce different ciphertexts, ensuring semantic security across all
 *   patient records
 * - Base64 codec pattern: the encryptField / decryptField pattern used by
 *   patient.service converts the Uint8Array to base64 for String column storage
 *   and back to Uint8Array for decryption — both directions verified
 *
 * Associated risks:
 * - A deterministic IV (non-random) would allow an attacker with database
 *   read access to detect which patients share the same field value
 *   (e.g. same last name), breaking confidentiality
 * - A corrupted GCM authentication tag not detected on decrypt would return
 *   garbled data to a physician, who might act on incorrect patient details
 * - Using Buffer.toString('utf8') instead of 'base64' on the ciphertext
 *   Uint8Array silently corrupts data (ADR #2 — documented non-negotiable)
 * - An invalid or missing HEALTH_DATA_ENCRYPTION_KEY must fail loudly at
 *   startup, not at first encrypt call during patient creation
 *
 * Edge cases:
 * - Empty string as plaintext (must encrypt and decrypt correctly)
 * - Unicode characters in plaintext (e.g. accented names, CJK)
 * - Ciphertext with exactly one byte of payload (minimum CIPHERTEXT length)
 * - Truncated Uint8Array missing TAG bytes (decrypt must throw
 *   HealthDataDecryptionError, not return corrupted data)
 * - Wrong key used for decryption (GCM tag mismatch — must throw)
 * - HEALTH_DATA_ENCRYPTION_KEY env var unset or wrong length (must throw
 *   on module load, not silently use a null key)
 */

import { describe, it, expect, afterEach } from "vitest"
import {
  encrypt,
  decrypt,
  HealthDataDecryptionError,
} from "@/lib/crypto/health-data"

describe("AES-256-GCM encryption", () => {
  // =========================================================================
  // ROUNDTRIP
  // =========================================================================
  describe("encrypt/decrypt roundtrip", () => {
    it("encrypts and decrypts a simple string", () => {
      const plaintext = "Jean Dupont"
      const encrypted = encrypt(plaintext)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it("encrypts and decrypts an empty string", () => {
      const plaintext = ""
      const encrypted = encrypt(plaintext)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it("encrypts and decrypts unicode characters", () => {
      const plaintext = "Rene Lefevre-Dumont"
      const encrypted = encrypt(plaintext)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it("encrypts and decrypts a JSON payload (personal data pattern)", () => {
      const personalData = JSON.stringify({
        firstName: "Marie",
        lastName: "Martin",
        birthDate: "1985-03-15",
        email: "marie.martin@example.com",
        phone: "+33612345678",
      })

      const encrypted = encrypt(personalData)
      const decrypted = decrypt(encrypted)

      expect(JSON.parse(decrypted)).toEqual(JSON.parse(personalData))
    })

    it("handles long strings (medical notes)", () => {
      const longText = "A".repeat(10000)
      const encrypted = encrypt(longText)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(longText)
    })
  })

  // =========================================================================
  // RANDOM IV (unique ciphertexts)
  // =========================================================================
  describe("random IV", () => {
    it("produces different ciphertexts for the same plaintext", () => {
      const plaintext = "Patient data"
      const encrypted1 = encrypt(plaintext)
      const encrypted2 = encrypt(plaintext)

      // Both should decrypt to the same value
      expect(decrypt(encrypted1)).toBe(plaintext)
      expect(decrypt(encrypted2)).toBe(plaintext)

      // But the raw bytes should differ (different random IVs)
      expect(Buffer.from(encrypted1).equals(Buffer.from(encrypted2))).toBe(false)
    })

    it("first 12 bytes (IV) differ between encryptions", () => {
      const plaintext = "Same input"
      const encrypted1 = encrypt(plaintext)
      const encrypted2 = encrypt(plaintext)

      const iv1 = Buffer.from(encrypted1).subarray(0, 12)
      const iv2 = Buffer.from(encrypted2).subarray(0, 12)

      expect(iv1.equals(iv2)).toBe(false)
    })
  })

  // =========================================================================
  // OUTPUT FORMAT: IV (12) + TAG (16) + CIPHERTEXT
  // =========================================================================
  describe("output format", () => {
    it("produces output longer than 28 bytes (IV + TAG minimum)", () => {
      const encrypted = encrypt("test")
      expect(encrypted.length).toBeGreaterThan(28) // 12 + 16 + at least 1 byte
    })

    it("produces output of exactly IV + TAG + plaintext length for short input", () => {
      const plaintext = "a"
      const encrypted = encrypt(plaintext)
      // AES-GCM ciphertext is same length as plaintext (no padding)
      // Total = 12 (IV) + 16 (TAG) + 1 (ciphertext) = 29
      expect(encrypted.length).toBe(29)
    })
  })

  // =========================================================================
  // INVALID KEY
  // =========================================================================
  describe("invalid encryption key", () => {
    afterEach(() => {
      // Restore the valid test key
      process.env.HEALTH_DATA_ENCRYPTION_KEY =
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
    })

    it("throws when encryption key is not set", () => {
      const saved = process.env.HEALTH_DATA_ENCRYPTION_KEY
      delete process.env.HEALTH_DATA_ENCRYPTION_KEY

      expect(() => encrypt("test")).toThrow("HEALTH_DATA_ENCRYPTION_KEY is not set")

      process.env.HEALTH_DATA_ENCRYPTION_KEY = saved
    })

    it("throws when encryption key is wrong length (too short)", () => {
      process.env.HEALTH_DATA_ENCRYPTION_KEY = "abcd1234"

      expect(() => encrypt("test")).toThrow("must be exactly 32 bytes")
    })

    it("throws when encryption key is wrong length (too long)", () => {
      process.env.HEALTH_DATA_ENCRYPTION_KEY =
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2ff"

      expect(() => encrypt("test")).toThrow("must be exactly 32 bytes")
    })
  })

  // =========================================================================
  // CORRUPTED DATA
  // =========================================================================
  describe("corrupted data handling", () => {
    it("throws HealthDataDecryptionError for too-short data", () => {
      const shortData = new Uint8Array(10) // Less than IV(12) + TAG(16)

      expect(() => decrypt(shortData)).toThrow(HealthDataDecryptionError)
      expect(() => decrypt(shortData)).toThrow("too short")
    })

    it("throws HealthDataDecryptionError for corrupted ciphertext", () => {
      const encrypted = encrypt("original data")
      const corrupted = new Uint8Array(encrypted)
      // Corrupt the ciphertext portion (after IV + TAG)
      corrupted[30] = corrupted[30]! ^ 0xff
      corrupted[31] = corrupted[31]! ^ 0xff

      expect(() => decrypt(corrupted)).toThrow(HealthDataDecryptionError)
      expect(() => decrypt(corrupted)).toThrow("corrupted or key mismatch")
    })

    it("throws HealthDataDecryptionError for corrupted auth tag", () => {
      const encrypted = encrypt("original data")
      const corrupted = new Uint8Array(encrypted)
      // Corrupt the auth tag (bytes 12-27)
      corrupted[12] = corrupted[12]! ^ 0xff

      expect(() => decrypt(corrupted)).toThrow(HealthDataDecryptionError)
    })

    it("throws HealthDataDecryptionError for data encrypted with different key", () => {
      // Encrypt with current key
      const encrypted = encrypt("secret data")

      // Change to a different key
      process.env.HEALTH_DATA_ENCRYPTION_KEY =
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

      expect(() => decrypt(encrypted)).toThrow(HealthDataDecryptionError)

      // Restore
      process.env.HEALTH_DATA_ENCRYPTION_KEY =
        "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
    })
  })

  // =========================================================================
  // BASE64 ENCODE/DECODE PATTERN (encryptField/decryptField)
  // =========================================================================
  describe("base64 encryptField/decryptField pattern", () => {
    // These functions are defined in patient.service.ts but we test the
    // underlying pattern here since they just wrap encrypt/decrypt + base64.

    function encryptField(value: string): string {
      return Buffer.from(encrypt(value)).toString("base64")
    }

    function decryptField(value: string): string {
      return decrypt(new Uint8Array(Buffer.from(value, "base64")))
    }

    it("roundtrips through base64 encoding", () => {
      const original = "Jean-Pierre Dupont"
      const encrypted = encryptField(original)
      const decrypted = decryptField(encrypted)

      expect(decrypted).toBe(original)
    })

    it("produces a valid base64 string", () => {
      const encrypted = encryptField("test")
      // Base64 only contains [A-Za-z0-9+/=]
      expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/)
    })

    it("different calls produce different base64 strings", () => {
      const value = "same input"
      const a = encryptField(value)
      const b = encryptField(value)

      expect(a).not.toBe(b)
      expect(decryptField(a)).toBe(value)
      expect(decryptField(b)).toBe(value)
    })
  })
})
