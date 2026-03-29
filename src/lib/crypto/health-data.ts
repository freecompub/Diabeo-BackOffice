import { randomBytes, createCipheriv, createDecipheriv } from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  const key = process.env.HEALTH_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error("HEALTH_DATA_ENCRYPTION_KEY is not set")
  }
  return Buffer.from(key, "hex")
}

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

export function decrypt(data: Uint8Array): string {
  const key = getEncryptionKey()
  const buf = Buffer.from(data)

  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  return decipher.update(ciphertext) + decipher.final("utf8")
}
