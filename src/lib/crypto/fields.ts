/**
 * @module crypto/fields
 * @description Field-level encryption helpers for String columns.
 * Wraps health-data encryption with base64 encoding for database storage.
 * @see src/lib/crypto/health-data — Low-level AES-256-GCM functions
 */

import { encrypt, decrypt } from "./health-data"

/**
 * Encrypt a string field to base64 for storage in String columns.
 * Format: base64(IV + TAG + CIPHERTEXT).
 * @export
 * @param {string} value - Plaintext to encrypt
 * @returns {string} Base64-encoded ciphertext (safe for String columns)
 * @example
 * const encrypted = encryptField("John")
 * // Store in database: User.firstname = encrypted
 */
export function encryptField(value: string): string {
  return Buffer.from(encrypt(value)).toString("base64")
}

/**
 * Safe decryption — returns null on error instead of throwing.
 * Used in read operations to handle corrupted or malformed data gracefully.
 * Never leaks ciphertext in error cases.
 * @export
 * @param {string | null} value - Base64-encoded ciphertext or null
 * @returns {string | null} Decrypted plaintext or null if decryption fails
 * @example
 * const plaintext = safeDecryptField(user.firstname)
 * // If decryption fails: plaintext === null
 */
export function safeDecryptField(value: string | null): string | null {
  if (!value) return null
  try {
    return decrypt(new Uint8Array(Buffer.from(value, "base64")))
  } catch {
    return null
  }
}
