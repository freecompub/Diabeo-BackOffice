/**
 * Test suite: GDPR consent cache (5-minute TTL on requireGdprConsent)
 *
 * Clinical behavior tested:
 * - requireGdprConsent caches DB result in Redis for 5 minutes — prevents
 *   52+ routes from issuing a Prisma query per request. Hot path now serves
 *   from cache (O(1) REST call to Upstash) instead of PostgreSQL round-trip.
 * - invalidateGdprConsentCache is called on PUT /api/account/privacy and on
 *   account deletion (RGPD Art. 7(3) — revocation must be immediate).
 * - Cache MISS falls back to Prisma. A Redis outage must NEVER block a
 *   legitimate consent check — cache is an optimization, not a trust boundary.
 *
 * Associated risks:
 * - Failing to invalidate after a consent revocation would leave the user
 *   locked out of analytics/export endpoints until the 5-min TTL expires,
 *   but would ALSO leave the reverse case open: a just-revoked user could
 *   keep reading health data for up to 5 minutes. Hence the explicit
 *   invalidation hook after privacy mutations.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

// Force in-memory cache fallback
vi.stubEnv("UPSTASH_REDIS_REST_URL", "")
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "")

import { prismaMock } from "../helpers/prisma-mock"
import { requireGdprConsent, invalidateGdprConsentCache } from "@/lib/gdpr"

describe("requireGdprConsent — caching", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("hits Prisma once on first call (cache miss)", async () => {
    const uniqueUserId = Math.floor(Math.random() * 1_000_000)
    prismaMock.userPrivacySettings.findUnique.mockResolvedValueOnce({
      gdprConsent: true,
    } as any)

    const result = await requireGdprConsent(uniqueUserId)
    expect(result).toBe(true)
    expect(prismaMock.userPrivacySettings.findUnique).toHaveBeenCalledTimes(1)
  })

  it("serves subsequent calls from cache (no second Prisma query)", async () => {
    const uniqueUserId = Math.floor(Math.random() * 1_000_000)
    prismaMock.userPrivacySettings.findUnique.mockResolvedValueOnce({
      gdprConsent: true,
    } as any)

    await requireGdprConsent(uniqueUserId)   // populates cache
    await requireGdprConsent(uniqueUserId)   // should hit cache
    await requireGdprConsent(uniqueUserId)

    expect(prismaMock.userPrivacySettings.findUnique).toHaveBeenCalledTimes(1)
  })

  it("invalidates the cache on revocation — next call hits Prisma again", async () => {
    const uniqueUserId = Math.floor(Math.random() * 1_000_000)
    prismaMock.userPrivacySettings.findUnique.mockResolvedValue({
      gdprConsent: true,
    } as any)

    await requireGdprConsent(uniqueUserId)   // miss → populate
    await invalidateGdprConsentCache(uniqueUserId)
    await requireGdprConsent(uniqueUserId)   // forced miss

    expect(prismaMock.userPrivacySettings.findUnique).toHaveBeenCalledTimes(2)
  })

  it("caches a negative consent (false) — revoked users are still fast-pathed", async () => {
    const uniqueUserId = Math.floor(Math.random() * 1_000_000)
    prismaMock.userPrivacySettings.findUnique.mockResolvedValueOnce({
      gdprConsent: false,
    } as any)

    const a = await requireGdprConsent(uniqueUserId)
    const b = await requireGdprConsent(uniqueUserId)
    expect(a).toBe(false)
    expect(b).toBe(false)
    expect(prismaMock.userPrivacySettings.findUnique).toHaveBeenCalledTimes(1)
  })

  it("caches MISSING-record (null) as no-consent — does not re-query every call", async () => {
    const uniqueUserId = Math.floor(Math.random() * 1_000_000)
    prismaMock.userPrivacySettings.findUnique.mockResolvedValueOnce(null)

    const a = await requireGdprConsent(uniqueUserId)
    const b = await requireGdprConsent(uniqueUserId)
    expect(a).toBe(false)
    expect(b).toBe(false)
    expect(prismaMock.userPrivacySettings.findUnique).toHaveBeenCalledTimes(1)
  })
})
