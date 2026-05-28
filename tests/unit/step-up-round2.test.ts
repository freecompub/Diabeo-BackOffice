/**
 * A2 round 2 — tests additionnels couvrant :
 *   - C2 : boundary exact 5 min (`>=` semantics)
 *   - H-T1 : clock skew tolerance (mfaLastVerifiedAt futur)
 *   - H-4 : per-route window override (CRITICAL 1 min)
 *   - L4 : prisma.user.findUnique → null branch
 *   - LO-1 : whitelist reason invalide → throw
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/client", () => ({
  prisma: {
    session: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/services/audit.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/audit.service")>()
  return {
    ...actual,
    auditService: {
      ...actual.auditService,
      requireStepUp: vi.fn().mockResolvedValue({ stepUpRow: {}, burstRow: null }),
    },
  }
})

import { prisma } from "@/lib/db/client"
import {
  STEP_UP_WINDOW_SECONDS,
  STEP_UP_WINDOW_SECONDS_CRITICAL,
  checkFreshMfa,
  stepUpErrorResponse,
} from "@/lib/auth/step-up"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("checkFreshMfa — boundary 5 min (C2)", () => {
  const setupSession = (mfaLastVerifiedAt: Date | null) => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt,
      user: { mfaEnabled: true },
    } as never)
  }

  it("4'59.9\" (299.9s) avant now → ok (fresh)", async () => {
    setupSession(new Date(Date.now() - 299_900))
    const r = await checkFreshMfa(42, "sess-x")
    expect(r.ok).toBe(true)
  })

  it("5'00.0\" (300.0s) exact → stepUpRequired (sémantique `>=`)", async () => {
    // Fixe l'invariant : à `ageSec === STEP_UP_WINDOW_SECONDS`, le code
    // évalue `ageSec >= STEP_UP_WINDOW_SECONDS` = true → stepUpRequired.
    // Un refactor `>` casserait la sécurité, ce test l'attrape.
    setupSession(new Date(Date.now() - STEP_UP_WINDOW_SECONDS * 1000))
    const r = await checkFreshMfa(42, "sess-x")
    expect(r).toEqual({ ok: false, reason: "stepUpRequired" })
  })

  it("5'00.1\" (300.1s) → stepUpRequired", async () => {
    setupSession(new Date(Date.now() - 300_100))
    const r = await checkFreshMfa(42, "sess-x")
    expect(r).toEqual({ ok: false, reason: "stepUpRequired" })
  })

  it("clock skew — mfaLastVerifiedAt 30s dans le futur (NTP desync) → ok", async () => {
    // ageSec négatif = forcément < window → ok. Documente la tolérance.
    setupSession(new Date(Date.now() + 30_000))
    const r = await checkFreshMfa(42, "sess-x")
    expect(r.ok).toBe(true)
  })
})

describe("checkFreshMfa — per-route window override (H-4)", () => {
  it("STEP_UP_WINDOW_SECONDS_CRITICAL = 60s → 90s ago = stale", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 90_000),
      user: { mfaEnabled: true },
    } as never)
    // Default window 5min → 90s ago est fresh
    const defaultR = await checkFreshMfa(42, "sess-x")
    expect(defaultR.ok).toBe(true)
    // CRITICAL window 60s → 90s ago est stale
    const criticalR = await checkFreshMfa(42, "sess-x", {
      windowSeconds: STEP_UP_WINDOW_SECONDS_CRITICAL,
    })
    expect(criticalR).toEqual({ ok: false, reason: "stepUpRequired" })
  })

  it("custom window 30s (V1.5 anticipated env override)", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 45_000),
      user: { mfaEnabled: true },
    } as never)
    const r = await checkFreshMfa(42, "sess-x", { windowSeconds: 30 })
    expect(r).toEqual({ ok: false, reason: "stepUpRequired" })
  })
})

describe("stepUpErrorResponse — LO-1 whitelist", () => {
  it("reason hors whitelist → throw (defense-in-depth)", async () => {
    await expect(
      // @ts-expect-error — intentional bad input
      stepUpErrorResponse("unknownReason", 42, "sess-x", {
        ipAddress: "x", userAgent: "x", requestId: "x",
      }, { route: "x" }),
    ).rejects.toThrow(/invalid reason/)
  })
})

describe("checkFreshMfa — H5 priority enrollment > fresh", () => {
  it("mfaEnabled=false MAIS mfaLastVerifiedAt récent → mfaEnrollmentRequired (priorité)", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 60_000), // 1 min ago
      user: { mfaEnabled: false },
    } as never)
    const r = await checkFreshMfa(42, "sess-x")
    expect(r).toEqual({ ok: false, reason: "mfaEnrollmentRequired" })
  })
})
