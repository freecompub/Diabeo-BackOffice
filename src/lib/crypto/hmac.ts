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
  return hmacField(email)
}

export function hmacField(value: string): string {
  const key = process.env.HMAC_SECRET
  if (!key) throw new Error("HMAC_SECRET is not set")
  return createHmac("sha256", key).update(value.toLowerCase().trim()).digest("hex")
}

/**
 * US-2026 M6 review — HMAC dedie INS (Identite Nationale Sante).
 *
 * Distinct de `hmacField` car :
 *   - INS = digits-only (0-9), `toLowerCase` est un no-op mais cree un
 *     couplage implicite avec `hmacField` qui pourrait casser le HMAC si
 *     jamais l'INS incluait des lettres (DOM-TOM 9A-9Z theoriques).
 *   - Pas de `trim` defensif a l'interieur — le caller (ins.service) est
 *     responsable de `normalizeIns` AVANT d'invoquer.
 *
 * Reutilise `HMAC_SECRET` (coherent avec les autres HMAC). Si rotation
 * independante INS necessaire en V2, basculer vers `HMAC_INS_SECRET` dedie.
 *
 * @param insNormalized INS deja normalise (15 digits, pas d'espace).
 * @returns 64-char hex HMAC-SHA256.
 */
export function hmacIns(insNormalized: string): string {
  const key = process.env.HMAC_SECRET
  if (!key) throw new Error("HMAC_SECRET is not set")
  return createHmac("sha256", key).update(insNormalized).digest("hex")
}

/**
 * US-2026 H1 review — HMAC dedie anonymisation IDs dans audit metadata.
 *
 * Utilise `AUDIT_PEPPER` (separe de HMAC_SECRET) → rotation independante
 * + correlation interne DPO/RSSI via fonction dediee.
 *
 * Usage typique : `collidingUserId` dans audit collision INS — evite leak
 * cross-cabinet d'identite via audit log lisible PS.
 *
 * @param domain Tag de domaine ("ins-collision", "msg-recipient") pour
 *               separer les espaces de hashage en cas de besoin.
 * @param plaintextId ID a anonymiser (typiquement User.id).
 * @returns 64-char hex HMAC-SHA256.
 */
export function hmacAuditId(domain: string, plaintextId: string | number): string {
  const pepper = process.env.AUDIT_PEPPER
  if (!pepper) throw new Error("AUDIT_PEPPER is not set")
  return createHmac("sha256", pepper)
    .update(`${domain}:${plaintextId}`)
    .digest("hex")
}
