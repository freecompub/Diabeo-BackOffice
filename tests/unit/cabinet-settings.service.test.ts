/**
 * @description Groupe 9 — US-2147 Cabinet settings unit tests.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  cabinetSettingsService,
  CabinetSettingsAccessError,
  CabinetSettingsNotFoundError,
} from "@/lib/services/cabinet-settings.service"

const baseCabinet = {
  id: 7, name: "Cabinet X", establishment: null,
  addressLine1: null, addressLine2: null, postalCode: null, city: null,
  country: "FR", phone: null, email: null, website: null,
  openingHours: null, specialties: [], capacity: null,
  managerId: 9, noVideos: false, noFood: false,
  type: "clinic", licenseNumber: null,
  siret: null, tvaIntra: null, iban: null,
  logo: null,
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

describe("get", () => {
  it("manager can read own cabinet settings", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue(baseCabinet as any)
    const out = await cabinetSettingsService.get(7, 9, "DOCTOR")
    expect(out.id).toBe(7)
    expect(out.managerId).toBe(9)
  })

  it("ADMIN can read any cabinet", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      ...baseCabinet, managerId: 99,
    } as any)
    const out = await cabinetSettingsService.get(7, 9, "ADMIN")
    expect(out.id).toBe(7)
  })

  it("non-manager DOCTOR rejected", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      ...baseCabinet, managerId: 99, // user 9 n'est PAS manager
    } as any)
    await expect(cabinetSettingsService.get(7, 9, "DOCTOR"))
      .rejects.toBeInstanceOf(CabinetSettingsAccessError)
  })

  it("not found returns CabinetSettingsNotFoundError", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue(null)
    await expect(cabinetSettingsService.get(99, 9, "ADMIN"))
      .rejects.toBeInstanceOf(CabinetSettingsNotFoundError)
  })

  it("audit kind=cabinet_settings.read", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue(baseCabinet as any)
    await cabinetSettingsService.get(7, 9, "DOCTOR")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("cabinet_settings.read")
    expect(meta.resourceId).toBe("7")
  })
})

describe("update (manager-level subset)", () => {
  it("manager can update phone/email", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue(baseCabinet as any)
    prismaMock.healthcareService.update.mockResolvedValue({
      ...baseCabinet, phone: "+33123456789", email: "cabinet@example.com",
    } as any)
    const out = await cabinetSettingsService.update(7, {
      phone: "+33123456789", email: "cabinet@example.com",
    }, 9, "DOCTOR")
    expect(out.phone).toBe("+33123456789")
  })

  it("specialties array update", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue(baseCabinet as any)
    prismaMock.healthcareService.update.mockResolvedValue({
      ...baseCabinet, specialties: ["diabetologie", "endocrinologie"],
    } as any)
    await cabinetSettingsService.update(7, {
      specialties: ["diabetologie", "endocrinologie"],
    }, 9, "DOCTOR")
    const updateArg = prismaMock.healthcareService.update.mock.calls[0]![0]!
    expect((updateArg.data as any).specialties).toEqual({
      set: ["diabetologie", "endocrinologie"],
    })
  })

  it("non-manager rejected with audit accessDenied", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      ...baseCabinet, managerId: 99,
    } as any)
    await expect(cabinetSettingsService.update(7, {
      phone: "+33999",
    }, 9, "DOCTOR")).rejects.toBeInstanceOf(CabinetSettingsAccessError)
  })

  it("audit fields includes only modified keys", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue(baseCabinet as any)
    prismaMock.healthcareService.update.mockResolvedValue(baseCabinet as any)
    await cabinetSettingsService.update(7, { noVideos: true, noFood: true }, 9, "DOCTOR")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("cabinet_settings.update")
    expect(meta.metadata.fields).toEqual(["noVideos", "noFood"])
  })
})
