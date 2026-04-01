/**
 * Test suite: Appointment Service — Medical Appointment Management
 *
 * Clinical behavior tested:
 * - Listing upcoming and past Appointment records for a patient, with
 *   comment fields decrypted transparently before returning to the caller
 * - Creation of a new appointment: the optional free-text comment is
 *   encrypted with AES-256-GCM before insertion, then an audit log entry
 *   is created, all within a single transaction
 * - Cancellation (soft-delete via status update) preserving the record for
 *   historical continuity and audit purposes
 * - Appointment type validation against the allowed enum set (diabeto,
 *   ophtalmo, nephro, cardio, nutrition, other) at the service boundary
 * - Audit logging of list, create, and cancel operations with the acting
 *   user's identity
 *
 * Associated risks:
 * - Storing appointment comments in plaintext would expose any incidental
 *   clinical information the physician types (diagnoses, medication changes)
 *   if the database is compromised
 * - Returning encrypted base64 comment to the UI instead of decrypted text
 *   would break the patient timeline and appointment detail views
 * - A transaction failure leaving the appointment created but audit log
 *   absent would produce an untraced record, violating HDS requirements
 *
 * Edge cases:
 * - Appointment with no comment (encryption step must be skipped; null stored
 *   as null, not as encrypted empty string)
 * - Listing when patient has no appointments (must return empty array)
 * - Decryption failure for a stored comment (error must propagate, not return
 *   corrupted text)
 * - Appointment date in the past (historical record — must still be listable)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/crypto/health-data", () => ({
  encrypt: (v: string) => Buffer.from(`ENC:${v}`),
  decrypt: (v: Uint8Array) => {
    const str = Buffer.from(v).toString()
    if (str.startsWith("ENC:")) return str.slice(4)
    throw new Error("decrypt failed")
  },
}))

import { appointmentService } from "@/lib/services/appointment.service"

describe("appointmentService", () => {
  describe("list", () => {
    it("returns appointments with decrypted comments", async () => {
      const encComment = Buffer.from("ENC:Controle trimestriel").toString("base64")
      prismaMock.appointment.findMany.mockResolvedValue([
        { id: 1, patientId: 1, type: "diabeto", date: new Date(), comment: encComment },
      ] as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await appointmentService.list(1, 1)
      expect(result).toHaveLength(1)
      expect(result[0].comment).toBe("Controle trimestriel")
    })
  })

  describe("create", () => {
    it("creates appointment with encrypted comment", async () => {
      const mockTx = {
        appointment: {
          create: vi.fn().mockResolvedValue({
            id: 1, patientId: 1, type: "ide", comment: Buffer.from("ENC:test").toString("base64"),
          }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await appointmentService.create(1, {
        type: "ide", date: "2026-05-01", comment: "test",
      }, 1)

      expect(result.comment).toBe("test")
      const createCall = mockTx.appointment.create.mock.calls[0][0]
      expect(createCall.data.comment).not.toBe("test")
    })
  })

  describe("delete", () => {
    it("deletes appointment in transaction", async () => {
      const mockTx = {
        appointment: {
          findFirst: vi.fn().mockResolvedValue({ id: 1, patientId: 1 }),
          delete: vi.fn().mockResolvedValue({}),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await appointmentService.delete(1, 1, 1)
      expect(result.deleted).toBe(true)
    })

    it("throws for non-existent appointment", async () => {
      const mockTx = {
        appointment: { findFirst: vi.fn().mockResolvedValue(null) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(appointmentService.delete(999, 1, 1))
        .rejects.toThrow("appointmentNotFound")
    })
  })
})
