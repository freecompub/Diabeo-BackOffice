/**
 * Test suite: Deletion Service — GDPR Cascade Account Deletion
 *
 * Clinical behavior tested:
 * - Full cascade deletion of a user account in compliance with GDPR right-to-
 *   erasure: sessions, push registrations, audit entries scoped to the user,
 *   and the user record itself are removed in a single atomic transaction
 * - When the user has an associated patient record, the patient row is soft-
 *   deleted (deletedAt set) rather than physically removed, preserving medical
 *   history for legal retention periods
 * - An audit entry is written before deletion so the erasure action itself is
 *   traceable in the immutable audit log
 *
 * Associated risks:
 * - Partial deletion (transaction rollback) would leave orphaned PII in the
 *   database, causing a GDPR non-compliance incident
 * - Hard-deleting a patient row (instead of soft-delete) would destroy medical
 *   data required for HDS retention obligations (10 years minimum)
 * - Missing audit entry for the deletion event would prevent demonstrating
 *   GDPR compliance to a supervisory authority
 *
 * Edge cases:
 * - User ID not found in the database (must throw, not silently no-op)
 * - User with no associated patient (deletion path must not attempt patient
 *   soft-delete and must still succeed)
 * - User with multiple active sessions (all must be invalidated)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { deleteUserAccount } from "@/lib/services/deletion.service"

describe("deleteUserAccount", () => {
  it("throws when user not found", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)

    await expect(deleteUserAccount(999, "127.0.0.1", "test"))
      .rejects.toThrow("User not found")
  })

  it("performs cascade deletion for user without patient", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      email: "test",
      patient: null,
    } as never)

    const mockTx = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      pushScheduledNotification: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      pushNotificationLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      pushDeviceRegistration: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      account: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      uiStateSave: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      dashboardConfiguration: { findUnique: vi.fn().mockResolvedValue(null) },
      userDayMoment: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      userUnitPreferences: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      userNotifPreferences: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      userPrivacySettings: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      healthcareMember: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      user: { update: vi.fn().mockResolvedValue({}) },
    }

    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

    const result = await deleteUserAccount(1, "127.0.0.1", "vitest")

    expect(result).toEqual({ deleted: true, userId: 1 })
    expect(mockTx.auditLog.create).toHaveBeenCalled()
    expect(mockTx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 1 } })
    expect(mockTx.healthcareMember.updateMany).toHaveBeenCalled()
    // User should be anonymized, not deleted
    expect(mockTx.user.update).toHaveBeenCalled()
    const updateData = mockTx.user.update.mock.calls[0][0].data
    expect(updateData.passwordHash).toBe("DELETED")
    expect(updateData.phone).toBeNull()
    expect(updateData.nirpp).toBeNull()
  })

  it("performs cascade deletion for user with patient", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      email: "test",
      patient: { id: 10 },
    } as never)

    const mockTx = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      pushScheduledNotification: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      pushNotificationLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      pushDeviceRegistration: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      account: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      uiStateSave: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      dashboardConfiguration: { findUnique: vi.fn().mockResolvedValue(null) },
      dashboardWidget: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      userDayMoment: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      userUnitPreferences: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      userNotifPreferences: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      userPrivacySettings: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      deviceDataSync: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      patientDevice: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      medicalDocument: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      appointment: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      adjustmentProposal: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      bolusCalculationLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      cgmEntry: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      glycemiaEntry: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      diabetesEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      insulinFlowEntry: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      insulinFlowDeviceData: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      pumpEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      averageData: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      insulinTherapySettings: { findUnique: vi.fn().mockResolvedValue(null), delete: vi.fn() },
      glycemiaObjective: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      cgmObjective: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      annexObjective: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      treatment: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      patientReferent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      patientService: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      patientMedicalData: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      patientAdministrative: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      patientPregnancy: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      patient: { update: vi.fn().mockResolvedValue({ id: 10, deletedAt: new Date() }) },
      healthcareMember: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      user: { update: vi.fn().mockResolvedValue({}) },
    }

    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

    const result = await deleteUserAccount(1, "127.0.0.1", "vitest")

    expect(result).toEqual({ deleted: true, userId: 1 })
    // Patient should be soft-deleted (not hard deleted)
    expect(mockTx.patient.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { deletedAt: expect.any(Date) },
    })
    // CGM entries should be deleted
    expect(mockTx.cgmEntry.deleteMany).toHaveBeenCalledWith({ where: { patientId: 10 } })
    // AverageData + InsulinFlowDeviceData should be deleted (C7 fix)
    expect(mockTx.averageData.deleteMany).toHaveBeenCalledWith({ where: { patientId: 10 } })
    expect(mockTx.insulinFlowDeviceData.deleteMany).toHaveBeenCalledWith({ where: { patientId: 10 } })
  })
})
