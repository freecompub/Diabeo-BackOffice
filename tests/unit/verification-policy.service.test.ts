/**
 * Test suite : verification-policy.service (US-2613 / F2 — écriture politique PS).
 *
 * **Fail-secure à l'écriture** (miroir de la résolution) : cible tenant XOR pays,
 * `provisional` borné (`expiresAt` futur), interdit en prod sans flag pilote. On
 * refuse d'écrire une politique qui serait dégradée à la lecture.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { verificationPolicyService } from "@/lib/services/verification-policy.service"

const pm = prismaMock as unknown as {
  verificationPolicy: { findMany: any; create: any }
  tenant: { findUnique: any }
  auditLog: { create: any }
  $transaction: any
}

const NOW = new Date("2026-06-17T00:00:00Z")
const FUTURE = new Date("2027-01-01T00:00:00Z")
const PAST = new Date("2020-01-01T00:00:00Z")

beforeEach(() => {
  vi.clearAllMocks()
  pm.auditLog.create.mockResolvedValue({})
  pm.$transaction.mockImplementation((cb: any) => cb(prismaMock))
  pm.verificationPolicy.create.mockResolvedValue({ id: 1 })
  pm.tenant.findUnique.mockResolvedValue({ id: 1 })
  vi.stubEnv("NODE_ENV", "test")
  vi.stubEnv("VERIFICATION_ALLOW_PILOT", "")
})
afterEach(() => vi.unstubAllEnvs())

describe("setPolicy — invariants de cible", () => {
  it("ni tenant ni pays → targetRequired", async () => {
    await expect(verificationPolicyService.setPolicy({ mode: "required" }, 1, undefined, NOW))
      .rejects.toMatchObject({ code: "targetRequired" })
  })

  it("tenant ET pays → targetAmbiguous", async () => {
    await expect(
      verificationPolicyService.setPolicy({ tenantId: 1, country: "FR", mode: "required" }, 1, undefined, NOW),
    ).rejects.toMatchObject({ code: "targetAmbiguous" })
  })

  it("tenant inexistant → tenantNotFound", async () => {
    pm.tenant.findUnique.mockResolvedValue(null)
    await expect(verificationPolicyService.setPolicy({ tenantId: 9, mode: "required" }, 1, undefined, NOW))
      .rejects.toMatchObject({ code: "tenantNotFound" })
  })
})

describe("setPolicy — invariants provisional (fail-secure)", () => {
  it("provisional sans expiresAt → expiresAtRequired", async () => {
    await expect(verificationPolicyService.setPolicy({ country: "FR", mode: "provisional" }, 1, undefined, NOW))
      .rejects.toMatchObject({ code: "expiresAtRequired" })
  })

  it("provisional expiré → expiresAtRequired", async () => {
    await expect(
      verificationPolicyService.setPolicy({ country: "FR", mode: "provisional", expiresAt: PAST }, 1, undefined, NOW),
    ).rejects.toMatchObject({ code: "expiresAtRequired" })
  })

  it("provisional en prod sans flag → provisionalForbiddenInProd", async () => {
    vi.stubEnv("NODE_ENV", "production")
    await expect(
      verificationPolicyService.setPolicy({ country: "FR", mode: "provisional", expiresAt: FUTURE }, 1, undefined, NOW),
    ).rejects.toMatchObject({ code: "provisionalForbiddenInProd" })
  })

  it("provisional borné hors prod → créé (VERIFICATION_PROVISIONAL_SET)", async () => {
    await verificationPolicyService.setPolicy({ country: "FR", mode: "provisional", expiresAt: FUTURE }, 1, undefined, NOW)
    expect(pm.verificationPolicy.create.mock.calls[0][0].data).toMatchObject({
      tenantId: null, country: "FR", mode: "provisional", expiresAt: FUTURE,
    })
    expect(pm.auditLog.create.mock.calls[0][0].data.action).toBe("VERIFICATION_PROVISIONAL_SET")
  })

  it("provisional en prod AVEC flag pilote → créé", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("VERIFICATION_ALLOW_PILOT", "true")
    await verificationPolicyService.setPolicy({ tenantId: 1, mode: "provisional", expiresAt: FUTURE }, 1, undefined, NOW)
    expect(pm.verificationPolicy.create).toHaveBeenCalled()
  })
})

describe("setPolicy — required", () => {
  it("required → créé avec expiresAt null + action VERIFICATION_POLICY_CHANGED", async () => {
    await verificationPolicyService.setPolicy({ tenantId: 1, mode: "required", expiresAt: FUTURE }, 1, undefined, NOW)
    const data = pm.verificationPolicy.create.mock.calls[0][0].data
    expect(data).toMatchObject({ tenantId: 1, country: null, mode: "required" })
    expect(data.expiresAt).toBeNull() // expiresAt ignoré quand required
    expect(pm.auditLog.create.mock.calls[0][0].data.action).toBe("VERIFICATION_POLICY_CHANGED")
  })

  it("pays normalisé en majuscule", async () => {
    await verificationPolicyService.setPolicy({ country: "fr", mode: "required" }, 1, undefined, NOW)
    expect(pm.verificationPolicy.create.mock.calls[0][0].data.country).toBe("FR")
  })
})

describe("setPolicy — list", () => {
  it("liste filtrée renvoie les politiques", async () => {
    pm.verificationPolicy.findMany.mockResolvedValue([{ id: 1, tenantId: 1, country: null, mode: "required", expiresAt: null, setById: 1, setAt: NOW }])
    const r = await verificationPolicyService.list({ tenantId: 1 }, 1)
    expect(r).toHaveLength(1)
  })
})
