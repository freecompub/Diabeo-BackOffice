/**
 * Test suite : ps-registration.service (US-2613 — validation manuelle preuves PS).
 *
 * Couvre : liste des preuves en attente (PII déchiffrée, sans PHI), garde d'état
 * (seules `unverified` décidables), validation/refus + audit canonique.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/crypto/fields", () => ({
  safeDecryptField: (v: string | null) => (v ? v.replace(/^enc:/, "dec:") : v),
}))

import { psRegistrationService, PsRegistrationError } from "@/lib/services/ps-registration.service"

const pm = prismaMock as unknown as {
  professionalRegistration: { findMany: any; findUnique: any; update: any }
  auditLog: { create: any }
  $transaction: any
}

const NOW = new Date("2026-06-17T00:00:00Z")

beforeEach(() => {
  vi.clearAllMocks()
  pm.auditLog.create.mockResolvedValue({})
  pm.$transaction.mockImplementation((cb: any) => cb(prismaMock))
})

describe("listPending", () => {
  it("renvoie les preuves unverified + PII déchiffrée", async () => {
    pm.professionalRegistration.findMany.mockResolvedValue([
      {
        id: 1, userId: 5, country: "FR", scheme: "RPPS", number: "10100000001",
        method: "manual", status: "unverified", createdAt: NOW,
        user: { firstname: "enc:Marie", lastname: "enc:Curie", email: "enc:m@x.fr" },
      },
    ])
    const r = await psRegistrationService.listPending(1)
    expect(pm.professionalRegistration.findMany.mock.calls[0][0].where).toEqual({ status: "unverified" })
    expect(r[0]).toMatchObject({ id: 1, firstname: "dec:Marie", lastname: "dec:Curie", email: "dec:m@x.fr" })
  })
})

describe("decide", () => {
  it("preuve inexistante → notFound", async () => {
    pm.professionalRegistration.findUnique.mockResolvedValue(null)
    await expect(psRegistrationService.decide(9, "verified", 1, undefined, NOW))
      .rejects.toBeInstanceOf(PsRegistrationError)
  })

  it("preuve déjà tranchée → invalidState", async () => {
    pm.professionalRegistration.findUnique.mockResolvedValue({ id: 1, userId: 5, status: "verified" })
    await expect(psRegistrationService.decide(1, "rejected", 1, undefined, NOW))
      .rejects.toMatchObject({ code: "invalidState" })
  })

  it("validation → status verified + verifiedBy/At + audit PS_PROOF_VALIDATED", async () => {
    pm.professionalRegistration.findUnique.mockResolvedValue({ id: 1, userId: 5, status: "unverified" })
    await psRegistrationService.decide(1, "verified", 42, undefined, NOW)
    expect(pm.professionalRegistration.update.mock.calls[0][0]).toMatchObject({
      where: { id: 1 },
      data: { status: "verified", verifiedById: 42, verifiedAt: NOW },
    })
    expect(pm.auditLog.create.mock.calls[0][0].data.action).toBe("PS_PROOF_VALIDATED")
  })

  it("refus → status rejected + audit PS_PROOF_REJECTED", async () => {
    pm.professionalRegistration.findUnique.mockResolvedValue({ id: 2, userId: 6, status: "unverified" })
    await psRegistrationService.decide(2, "rejected", 42, undefined, NOW)
    expect(pm.professionalRegistration.update.mock.calls[0][0].data.status).toBe("rejected")
    expect(pm.auditLog.create.mock.calls[0][0].data.action).toBe("PS_PROOF_REJECTED")
  })
})
