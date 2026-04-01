/**
 * @module crypto/hmac
 * @description HMAC-SHA256 for email lookup without exposing encrypted email.
 * Enables unique index on emailHmac while keeping email encrypted in database.
 * HMAC secret must be stable across environment — do not rotate without data migration.
 * @see CLAUDE.md#email-lookup — HMAC pattern for searchable encryption
 */

import { createHmac } from "crypto"

/**
 * Compute HMAC-SHA256 of lowercase, trimmed email.
 * Returns fixed 64-character hex string for database indexing.
 * Used for UNIQUE constraint on User.emailHmac — enables fast email lookup.
 * @export
 * @param {string} email - Email address (normalized: lowercase, trimmed)
 * @returns {string} 64-character hex HMAC-SHA256
 * @throws {Error} If HMAC_SECRET env var not set
 * @example
 * const hmac = hmacEmail("John@Example.COM")
 * // Returns stable hash, same as hmacEmail("john@example.com")
 * // Use in: User.emailHmac for UNIQUE index + fast lookups
 */
export function hmacEmail(email: string): string {
  const key = process.env.HMAC_SECRET
  if (!key) throw new Error("HMAC_SECRET is not set")
  return createHmac("sha256", key).update(email.toLowerCase().trim()).digest("hex")
}
