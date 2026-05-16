/**
 * @module gdpr
 * @description GDPR compliance helpers — consent verification and data access controls.
 * All medical data access must verify user consent before processing.
 * @see CLAUDE.md#gdpr — GDPR requirements (Articles 6, 9, 17, 20)
 * @see https://eur-lex.europa.eu/eli/reg/2016/679/oj — GDPR Regulation
 */

import { prisma } from "@/lib/db/client"
import { cacheGet, cacheSet, cacheDelete } from "@/lib/cache/redis-cache"
import { logger } from "@/lib/logger"

const CACHE_BUCKET = "gdpr-consent"
/**
 * Differentiated TTLs — RGPD Art. 7(3) requires revocation to be quasi-immediate.
 * - Positive consent cached for 60s only: if the user revokes and the
 *   invalidation hook fails (crashed Node process between DB commit and
 *   cacheDelete), the stale `true` window is bounded to 1 minute.
 * - Negative / missing consent cached for 5 minutes: no privacy risk in
 *   over-caching a "no" state; keeps DB load low for anonymous-like traffic.
 */
const CACHE_TTL_POSITIVE_SEC = 60
const CACHE_TTL_NEGATIVE_SEC = 300

/**
 * Check if a user has given GDPR consent for medical data processing.
 * Without valid consent, routes should reject health data access.
 * Consent stored in UserPrivacySettings.gdprConsent.
 *
 * **Caching**: reads are cached in Redis for 5 minutes. Cache is invalidated
 * on PUT /api/account/privacy. A cache MISS or Redis outage falls back to
 * a direct Prisma query — caching is an optimization, never a trust boundary.
 *
 * @async
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} True if user has explicitly consented to data processing
 * @example
 * const hasConsent = await requireGdprConsent(userId)
 * if (!hasConsent) return NextResponse.json({ error: "GDPR consent required" }, { status: 403 })
 */
export async function requireGdprConsent(userId: number): Promise<boolean> {
  const cached = await cacheGet<boolean>(CACHE_BUCKET, String(userId))
  if (cached !== undefined) return cached

  const settings = await prisma.userPrivacySettings.findUnique({
    where: { userId },
    select: { gdprConsent: true },
  })

  const hasConsent = settings?.gdprConsent === true
  const ttl = hasConsent ? CACHE_TTL_POSITIVE_SEC : CACHE_TTL_NEGATIVE_SEC
  await cacheSet(CACHE_BUCKET, String(userId), hasConsent, ttl)
  return hasConsent
}

/**
 * Invalidate the cached consent status for a user.
 * Call this from any route that mutates UserPrivacySettings.gdprConsent —
 * otherwise a revocation could take up to 5 minutes to take effect,
 * violating Art. 7(3) "withdrawal must be as easy as giving consent".
 *
 * M3 round 2 review (RGPD Art. 7(3) + Art. 32) — wrapper try/catch + log
 * structuré pour visibilité SOC. Sans ça, une panne Upstash entre commit DB
 * et `cacheDelete` est silencieusement absorbée (fail-open du redis-cache
 * module) ; la fenêtre stale 60s du cache positif s'applique invisiblement.
 * Le log permet aux runbooks (RGPD breach window > 60s) de détecter le cas.
 */
export async function invalidateGdprConsentCache(userId: number): Promise<void> {
  try {
    await cacheDelete(CACHE_BUCKET, String(userId))
  } catch (err) {
    // Fail-soft : on ne bloque pas la mutation DB (le commit a déjà eu lieu).
    // Mais on logue pour SOC + runbook RGPD Art. 7(3) breach window visibility.
    logger.warn(
      "gdpr",
      "consent cache invalidation failed",
      {
        userId,
        kind: "consent.cache.invalidation.failed",
        error: err instanceof Error ? err.message : String(err),
        // Borne de la fenêtre stale (= TTL positive cache).
        staleWindowSec: CACHE_TTL_POSITIVE_SEC,
      },
    )
  }
}
