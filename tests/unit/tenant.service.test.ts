/**
 * Test suite : tenant.service (US-2613 — administration plateforme, tenants).
 *
 * Couvre CRUD + rattachement d'établissement : normalisation (nom/pays),
 * notFound, no-op update, et le lien `HealthcareService.tenantId` sans toucher
 * l'établissement. La garde de rôle (SYSTEM_ADMIN) est portée par les routes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { tenantService, TenantError } from "@/lib/services/tenant.service"

const pm = prismaMock as unknown as {
  tenant: { findMany: any; findUnique: any; create: any; update: any }
  healthcareService: { findUnique: any; update: any }
  auditLog: { create: any }
  $transaction: any
}

beforeEach(() => {
  vi.clearAllMocks()
  pm.auditLog.create.mockResolvedValue({})
  pm.$transaction.mockImplementation((cb: any) => cb(prismaMock))
})

describe("tenantService.create", () => {
  it("crée un tenant (nom trimé, pays normalisé majuscule)", async () => {
    pm.tenant.create.mockResolvedValue({ id: 7 })
    const r = await tenantService.create({ name: "  Cabinet Nord ", country: "fr" }, 1)
    expect(r).toEqual({ id: 7 })
    expect(pm.tenant.create.mock.calls[0][0].data).toEqual({ name: "Cabinet Nord", country: "FR" })
  })

  it("nom < 2 caractères → invalidState", async () => {
    await expect(tenantService.create({ name: "x" }, 1)).rejects.toBeInstanceOf(TenantError)
  })

  it("pays vide → null", async () => {
    pm.tenant.create.mockResolvedValue({ id: 8 })
    await tenantService.create({ name: "Sud", country: "" }, 1)
    expect(pm.tenant.create.mock.calls[0][0].data.country).toBeNull()
  })
})

describe("tenantService.list / getById", () => {
  it("list mappe serviceCount", async () => {
    pm.tenant.findMany.mockResolvedValue([
      { id: 1, name: "A", country: "FR", createdAt: new Date(), _count: { services: 3 } },
    ])
    const r = await tenantService.list(1)
    expect(r[0]).toMatchObject({ id: 1, serviceCount: 3 })
  })

  it("getById inexistant → notFound", async () => {
    pm.tenant.findUnique.mockResolvedValue(null)
    await expect(tenantService.getById(99, 1)).rejects.toMatchObject({ code: "notFound" })
  })
})

describe("tenantService.update", () => {
  it("inexistant → notFound", async () => {
    pm.tenant.findUnique.mockResolvedValue(null)
    await expect(tenantService.update(9, { name: "X" }, 1)).rejects.toMatchObject({ code: "notFound" })
  })

  it("sans champ → no-op (pas d'update)", async () => {
    pm.tenant.findUnique.mockResolvedValue({ id: 9 })
    await tenantService.update(9, {}, 1)
    expect(pm.tenant.update).not.toHaveBeenCalled()
  })

  it("met à jour nom + pays normalisé", async () => {
    pm.tenant.findUnique.mockResolvedValue({ id: 9 })
    await tenantService.update(9, { name: "  New ", country: "dz" }, 1)
    expect(pm.tenant.update.mock.calls[0][0].data).toEqual({ name: "New", country: "DZ" })
  })
})

describe("tenantService.assignService", () => {
  it("établissement inexistant → notFound", async () => {
    pm.healthcareService.findUnique.mockResolvedValue(null)
    await expect(tenantService.assignService(5, 7, 1)).rejects.toMatchObject({ code: "notFound" })
  })

  it("tenant inexistant (rattachement) → notFound", async () => {
    pm.healthcareService.findUnique.mockResolvedValue({ id: 5 })
    pm.tenant.findUnique.mockResolvedValue(null)
    await expect(tenantService.assignService(5, 7, 1)).rejects.toMatchObject({ code: "notFound" })
  })

  it("rattache l'établissement (set tenantId)", async () => {
    pm.healthcareService.findUnique.mockResolvedValue({ id: 5 })
    pm.tenant.findUnique.mockResolvedValue({ id: 7 })
    await tenantService.assignService(5, 7, 1)
    expect(pm.healthcareService.update.mock.calls[0][0]).toMatchObject({
      where: { id: 5 }, data: { tenantId: 7 },
    })
  })

  it("détache (tenantId null) sans vérifier de tenant", async () => {
    pm.healthcareService.findUnique.mockResolvedValue({ id: 5 })
    await tenantService.assignService(5, null, 1)
    expect(pm.tenant.findUnique).not.toHaveBeenCalled()
    expect(pm.healthcareService.update.mock.calls[0][0].data).toEqual({ tenantId: null })
  })
})
