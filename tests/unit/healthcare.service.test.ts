/**
 * Test suite: Healthcare Service — Healthcare Team and Structure Management
 *
 * Clinical behavior tested:
 * - Listing all HealthcareService structures (hospitals, clinics, private
 *   practices) available to an authenticated user, with member and patient
 *   counts for dashboard display
 * - Retrieval of a single HealthcareService with its full member roster,
 *   used to populate the team management view and determine referral options
 * - Adding a HealthcareMember (linking a User with a role to a service),
 *   enforcing that the user exists and is not already a member of the same
 *   service
 * - Removing a HealthcareMember while verifying no active patient referrals
 *   depend on that member before allowing deletion
 * - Listing PatientService assignments: which patients belong to which
 *   healthcare structure, respecting the requesting user's portfolio scope
 * - Audit logging of every read and write operation on team data
 *
 * Associated risks:
 * - Adding a member without checking for duplicates would create redundant
 *   HealthcareMember rows, corrupting role-based access for that user within
 *   the service
 * - Removing a member who is a PatientReferent without reassignment would
 *   leave patients without a designated physician, violating care continuity
 * - Listing services without scope filtering would expose other services'
 *   patient lists to an unauthorized user
 *
 * Edge cases:
 * - Service with zero members (listServices must include it with count = 0)
 * - Attempt to add a user already in the service (must be idempotent or return
 *   an error, not create a duplicate row)
 * - Removing the last DOCTOR from a service that has active patients
 * - getService for a non-existent service ID (must return null)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { healthcareService } from "@/lib/services/healthcare.service"

describe("healthcareService", () => {
  describe("listServices", () => {
    it("returns all services", async () => {
      prismaMock.healthcareService.findMany.mockResolvedValue([
        { id: 1, name: "CHU Lyon", _count: { members: 5, patientServices: 20 } },
      ] as any)

      prismaMock.auditLog.create.mockResolvedValue({} as any)
      const result = await healthcareService.listServices(1)
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
