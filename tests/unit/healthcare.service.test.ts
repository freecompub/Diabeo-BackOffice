import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { healthcareService } from "@/lib/services/healthcare.service"

describe("healthcareService", () => {
  describe("listServices", () => {
    it("returns all services", async () => {
      prismaMock.healthcareService.findMany.mockResolvedValue([
        { id: 1, name: "CHU Lyon", _count: { members: 5, patientServices: 20 } },
      ] as any)

      const result = await healthcareService.listServices()
      expect(result).toHaveLength(1)
    })
  })

  describe("getService", () => {
    it("returns service with members", async () => {
      prismaMock.healthcareService.findUnique.mockResolvedValue({
        id: 1, name: "CHU Lyon", members: [{ id: 1, name: "Dr Martin" }],
      } as any)

      const result = await healthcareService.getService(1)
      expect(result!.name).toBe("CHU Lyon")
    })

    it("returns null for non-existent service", async () => {
      prismaMock.healthcareService.findUnique.mockResolvedValue(null)
      const result = await healthcareService.getService(999)
      expect(result).toBeNull()
    })
  })

  describe("enrollPatient", () => {
    it("creates patient-service link in transaction", async () => {
      const mockTx = {
        healthcareService: { findUnique: vi.fn().mockResolvedValue({ id: 2, name: "CHU" }) },
        patientService: { create: vi.fn().mockResolvedValue({ id: 1, patientId: 1, serviceId: 2, wait: true }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await healthcareService.enrollPatient(1, 2, 1)
      expect(result.wait).toBe(true)
    })
  })

  describe("setReferent", () => {
    it("upserts referent in transaction", async () => {
      const mockTx = {
        healthcareMember: { findFirst: vi.fn().mockResolvedValue({ id: 5, name: "Dr Martin", serviceId: 2 }) },
        patientReferent: { upsert: vi.fn().mockResolvedValue({ id: 1, patientId: 1, proId: 5, serviceId: 2 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await healthcareService.setReferent(1, 5, 2, 1)
      expect(result.proId).toBe(5)
    })
  })
})
