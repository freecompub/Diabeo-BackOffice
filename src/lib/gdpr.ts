/**
 * @module gdpr
 * @description GDPR compliance helpers — consent verification and data access controls.
 * All medical data access must verify user consent before processing.
 * @see CLAUDE.md#gdpr — GDPR requirements (Articles 6, 9, 17, 20)
 * @see https://eur-lex.europa.eu/eli/reg/2016/679/oj — GDPR Regulation
 */

import { prisma } from "@/lib/db/client"

/**
 * Check if a user has given GDPR consent for medical data processing.
 * Without valid consent, routes should reject health data access.
 * Consent stored in UserPrivacySettings.gdprConsent.
 * @async
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} True if user has explicitly consented to data processing
 * @example
 * const hasConsent = await requireGdprConsent(userId)
 * if (!hasConsent) return NextResponse.json({ error: "GDPR consent required" }, { status: 403 })
 */
export async function requireGdprConsent(userId: number): Promise<boolean> {
  const settings = await prisma.userPrivacySettings.findUnique({
    where: { userId },
    select: { gdprConsent: true },
  })

  return settings?.gdprConsent === true
}
