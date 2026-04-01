import { createHmac } from "crypto"

export function hmacEmail(email: string): string {
  const key = process.env.HMAC_SECRET
  if (!key) throw new Error("HMAC_SECRET is not set")
  return createHmac("sha256", key).update(email.toLowerCase().trim()).digest("hex")
}
