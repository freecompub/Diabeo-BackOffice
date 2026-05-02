/**
 * Test suite: Adjustment Service — notifyPatient FCM integration
 *
 * Clinical behavior tested:
 * - Push notification sent to patient on proposal accept/reject
 * - Soft-deleted patients are NOT notified (RGPD)
 * - FCM failure returns { notified: false } instead of throwing
 * - Non-existent patient returns { notified: false }
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

const mockSendToUser = vi.fn()
vi.mock("@/lib/services/fcm.service", () => ({
  fcmService: { sendToUser: (...args: unknown[]) => mockSendToUser(...args) },
}))

vi.mock("@/lib/services/audit.service", () => ({
  auditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logWithTx: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { adjustmentService } from "@/lib/services/adjustment.service"

describe("adjustmentService.notifyPatient", () => {
  beforeEach(() => {
    mockSendToUser.mockReset()
  })

  it("sends FCM push on accept and returns notified:true", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 1, userId: 42 } as any)
    mockSendToUser.mockResolvedValue({ sent: 1, failed: 0, results: [] })

    const result = await adjustmentService.notifyPatient(1, 7, "accepted")

    expect(result.notified).toBe(true)
    expect(mockSendToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        senderId: 7,
        title: "Proposition acceptée",
        data: expect.objectContaining({ type: "proposal_update", action: "accepted" }),
      }),
      undefined,
    )
  })

  it("sends FCM push on reject", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 1, userId: 42 } as any)
    mockSendToUser.mockResolvedValue({ sent: 1, failed: 0, results: [] })

    const result = await adjustmentService.notifyPatient(1, 7, "rejected")

    expect(result.notified).toBe(true)
    expect(mockSendToUser).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Proposition refusée" }),
      undefined,
    )
  })

  it("returns notified:false for non-existent patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)

    const result = await adjustmentService.notifyPatient(999, 7, "accepted")

    expect(result.notified).toBe(false)
    expect(mockSendToUser).not.toHaveBeenCalled()
  })

  it("returns notified:false when FCM fails", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 1, userId: 42 } as any)
    mockSendToUser.mockRejectedValue(new Error("FCM unavailable"))

    const result = await adjustmentService.notifyPatient(1, 7, "accepted")

    expect(result.notified).toBe(false)
  })

  it("returns notified:false when all devices fail", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 1, userId: 42 } as any)
    mockSendToUser.mockResolvedValue({ sent: 0, failed: 2, results: [] })

    const result = await adjustmentService.notifyPatient(1, 7, "accepted")

    expect(result.notified).toBe(false)
  })

  it("filters soft-deleted patients (deletedAt: null)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)

    await adjustmentService.notifyPatient(1, 7, "accepted")

    expect(prismaMock.patient.findFirst).toHaveBeenCalledWith({
      where: { id: 1, deletedAt: null },
      select: { userId: true },
    })
  })
})
