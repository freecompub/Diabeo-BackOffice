import { encrypt, decrypt } from "./health-data"

/** Encrypt a string field to base64 for storage in String columns */
export function encryptField(value: string): string {
  return Buffer.from(encrypt(value)).toString("base64")
}

/** Decrypt a base64-encoded field — returns null on failure, never leaks ciphertext */
export function safeDecryptField(value: string | null): string | null {
  if (!value) return null
  try {
    return decrypt(new Uint8Array(Buffer.from(value, "base64")))
  } catch {
    return null
  }
}
