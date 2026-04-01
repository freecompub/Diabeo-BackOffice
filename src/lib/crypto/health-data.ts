/**
 * @module crypto/health-data
 * @description AES-256-GCM encryption for health data (PII and medical records).
 * Format: IV (12 bytes) + TAG (16 bytes) + CIPHERTEXT — all concatenated as Uint8Array.
 * Key must be provided via HEALTH_DATA_ENCRYPTION_KEY env var (32 bytes hex = 64 chars).
 * @see CLAUDE.md#encryption — Encryption patterns and key management
 */

import { randomBytes, createCipheriv, createDecipheriv } from "crypto"

/** AES-256-GCM cipher algorithm */
const ALGORITHM = "aes-256-gcm"
/** IV (initialization vector) size in bytes */
const IV_LENGTH = 12
/** Authentication tag size in bytes */
const TAG_LENGTH = 16
/** Encryption key size in bytes (256 bits = 32 bytes) */
const KEY_LENGTH = 32

/**
 * Get encryption key from environment variable.
 * Must be exactly 32 bytes as hex string (64 hex characters).
 * @private
 * @returns {Buffer} Encryption key (32 bytes)
 * @throws {Error} If HEALTH_DATA_ENCRYPTION_KEY not set or invalid length
 */
function getEncryptionKey(): Buffer {
  const key = process.env.HEALTH_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error("HEALTH_DATA_ENCRYPTION_KEY is not set")
  }
  const buf = Buffer.from(key, "hex")
  if (buf.length !== KEY_LENGTH) {
    throw new Error(
      `HEALTH_DATA_ENCRYPTION_KEY must be exactly ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars), got ${buf.length} bytes`
    )
  }
  return buf
}

/**
 * Custom error for decryption failures.
 * Used to distinguish crypto errors from other exceptions.
 * @class HealthDataDecryptionError
 */
export class HealthDataDecryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HealthDataDecryptionError"
  }
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns Uint8Array with format: IV (12 bytes) + TAG (16 bytes) + CIPHERTEXT.
 * Each field is concatenated in order with no delimiters.
 * @export
 * @param {string} plaintext - Data to encrypt (UTF-8)
 * @returns {Uint8Array<ArrayBuffer>} Encrypted data (IV + TAG + CIPHERTEXT)
 * @throws {Error} If HEALTH_DATA_ENCRYPTION_KEY not set or invalid
 * @example
 * const ciphertext = encrypt("John Doe")
 * const base64 = Buffer.from(ciphertext).toString("base64")
 * // Store base64 in database
 */
export function encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  // Format: IV (12) + TAG (16) + CIPHERTEXT
  return new Uint8Array(Buffer.concat([iv, tag, encrypted]))
}

/**
 * Decrypt AES-256-GCM ciphertext.
 * Expects Uint8Array with format: IV (12 bytes) + TAG (16 bytes) + CIPHERTEXT.
 * Validates auth tag to detect tampering. Throws on corruption or key mismatch.
 * @export
 * @param {Uint8Array} data - Encrypted data (IV + TAG + CIPHERTEXT)
 * @returns {string} Decrypted plaintext (UTF-8)
 * @throws {HealthDataDecryptionError} If decryption fails (corrupt data, wrong key, or auth tag mismatch)
 * @example
 * const base64 = "AgAA..." // from database
 * const data = new Uint8Array(Buffer.from(base64, "base64"))
 * const plaintext = decrypt(data)
 */
export function decrypt(data: Uint8Array): string {
  const key = getEncryptionKey()
  const buf = Buffer.from(data)

  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new HealthDataDecryptionError(
      "Encrypted data is too short to contain IV + auth tag"
    )
  }

  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH)

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8")
  } catch {
    throw new HealthDataDecryptionError(
      "Failed to decrypt health data — data may be corrupted or key mismatch"
    )
  }
}
