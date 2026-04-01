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
