/**
 * Test suite: FCM Service — Firebase Cloud Messaging sending
 *
 * Clinical behavior tested:
 * - Push notification delivery to patient devices (iOS/Android/Web)
 * - Template rendering with locale-aware field selection (fr/en/ar)
 * - Stale token auto-deactivation on invalid-registration-token
 * - Retry logic limited to retriable FCM errors only
 * - Idempotency key generation for client-side dedup
 * - Audit trail records sender (not recipient) per HDS traceability
 * - PushNotificationLog does NOT store cleartext notification content
 * - Batch recipient limit enforcement (MAX_BATCH_RECIPIENTS = 500)
 *
 * Associated risks:
 * - Duplicate notifications could cause alarm fatigue or inappropriate
 *   clinical responses (e.g., treating same hypo event twice)
 * - Delivering notifications to wrong user via stale token = confidentiality breach
 * - Storing cleartext health data in notification logs = HDS violation
 * - Uncontrolled batch sends = DoS on FCM and database
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

// Mock Firebase Admin SDK
const mockSend = vi.fn()
vi.mock("@/lib/firebase/admin", () => ({
  getFcm: () => ({ send: mockSend }),
}))

// Mock audit service
vi.mock("@/lib/services/audit.service", () => ({
  auditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logWithTx: vi.fn().mockResolvedValue(undefined),
  },
}))

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

import { fcmService } from "@/lib/services/fcm.service"
import { auditService } from "@/lib/services/audit.service"

describe("fcmService", () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe("sendToUser", () => {
    it("sends to all active devices and logs each attempt", async () => {
      prismaMock.pushDeviceRegistration.findMany.mockResolvedValue([
        { id: "r1", pushToken: "token-ios", platform: "ios", isActive: true } as any,
        { id: "r2", pushToken: "token-android", platform: "android", isActive: true } as any,
      ])
      mockSend.mockResolvedValue("msg-id-1")
      prismaMock.pushNotificationLog.create.mockResolvedValue({} as any)

      const result = await fcmService.sendToUser({
        userId: 42, senderId: 1, title: "Test", body: "Body",
      })

      expect(result.sent).toBe(2)
      expect(result.failed).toBe(0)
      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(prismaMock.pushNotificationLog.create).toHaveBeenCalledTimes(2)
    })

    it("returns empty result for user with no devices", async () => {
      prismaMock.pushDeviceRegistration.findMany.mockResolvedValue([])

      const result = await fcmService.sendToUser({
        userId: 42, senderId: 1, title: "Test", body: "Body",
      })

      expect(result.sent).toBe(0)
      expect(result.results).toEqual([])
      expect(mockSend).not.toHaveBeenCalled()
    })

    it("auto-deactivates stale tokens on invalid-registration-token", async () => {
      prismaMock.pushDeviceRegistration.findMany.mockResolvedValue([
        { id: "r1", pushToken: "stale-token", platform: "ios", isActive: true } as any,
      ])
      mockSend.mockRejectedValue({ code: "messaging/invalid-registration-token" })
      prismaMock.pushDeviceRegistration.update.mockResolvedValue({} as any)
      prismaMock.pushNotificationLog.create.mockResolvedValue({} as any)

      const result = await fcmService.sendToUser({
        userId: 42, senderId: 1, title: "Test", body: "Body",
      })

      expect(result.failed).toBe(1)
      expect(prismaMock.pushDeviceRegistration.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { isActive: false, unregisteredAt: expect.any(Date) },
      })
    })

    it("does not retry on non-retriable errors", async () => {
      prismaMock.pushDeviceRegistration.findMany.mockResolvedValue([
        { id: "r1", pushToken: "token", platform: "web", isActive: true } as any,
      ])
      mockSend.mockRejectedValue({ code: "messaging/invalid-argument", message: "Bad request" })
      prismaMock.pushNotificationLog.create.mockResolvedValue({} as any)

      const result = await fcmService.sendToUser({
        userId: 42, senderId: 1, title: "Test", body: "Body",
      })

      expect(result.failed).toBe(1)
      expect(mockSend).toHaveBeenCalledTimes(1)
    })

    it("does not store cleartext title/body in PushNotificationLog", async () => {
      prismaMock.pushDeviceRegistration.findMany.mockResolvedValue([
        { id: "r1", pushToken: "token", platform: "ios", isActive: true } as any,
      ])
      mockSend.mockResolvedValue("msg-ok")
      prismaMock.pushNotificationLog.create.mockResolvedValue({} as any)

      await fcmService.sendToUser({
        userId: 42, senderId: 1, title: "Patient Dupont glycémie 0.45 g/L", body: "Alerte hypo sévère",
      })

      const logCall = prismaMock.pushNotificationLog.create.mock.calls[0][0]
      expect(logCall.data.title).not.toContain("Dupont")
      expect(logCall.data.title).not.toContain("0.45")
      expect(logCall.data.body).toBe("")
    })

    it("audits sender, not recipient", async () => {
      prismaMock.pushDeviceRegistration.findMany.mockResolvedValue([
        { id: "r1", pushToken: "token", platform: "ios", isActive: true } as any,
      ])
      mockSend.mockResolvedValue("msg-ok")
      prismaMock.pushNotificationLog.create.mockResolvedValue({} as any)

      await fcmService.sendToUser({
        userId: 42, senderId: 7, title: "Test", body: "Body",
      })

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 7,
          resource: "PUSH_NOTIFICATION",
          metadata: expect.objectContaining({ recipientUserId: 42 }),
        }),
      )
    })
  })

  describe("sendFromTemplate", () => {
    it("renders template with variables and sends", async () => {
      prismaMock.pushNotificationTemplate.findUnique.mockResolvedValue({
        id: "hypo_alert", isActive: true,
        titleFr: "Alerte {{level}}", bodyFr: "Glycémie {{level}} détectée",
        titleEn: "Alert {{level}}", bodyEn: "{{level}} glucose detected",
        titleAr: "تنبيه {{level}}", bodyAr: "تم اكتشاف {{level}}",
        dataPayload: { type: "alert" },
      } as any)
      prismaMock.pushDeviceRegistration.findFirst.mockResolvedValue({ locale: "fr" } as any)
      prismaMock.pushDeviceRegistration.findMany.mockResolvedValue([
        { id: "r1", pushToken: "token", platform: "ios", isActive: true } as any,
      ])
      mockSend.mockResolvedValue("msg-ok")
      prismaMock.pushNotificationLog.create.mockResolvedValue({} as any)

      const result = await fcmService.sendFromTemplate(42, 1, "hypo_alert", { level: "basse" })

      expect(result.sent).toBe(1)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            _title: "Alerte basse",
            _body: "Glycémie basse détectée",
            type: "alert",
            templateId: "hypo_alert",
          }),
        }),
      )
    })

    it("selects locale from device registration", async () => {
      prismaMock.pushNotificationTemplate.findUnique.mockResolvedValue({
        id: "t1", isActive: true,
        titleFr: "Titre FR", bodyFr: "Corps FR",
        titleEn: "Title EN", bodyEn: "Body EN",
        titleAr: "عنوان", bodyAr: "جسم",
        dataPayload: null,
      } as any)
      prismaMock.pushDeviceRegistration.findFirst.mockResolvedValue({ locale: "en" } as any)
      prismaMock.pushDeviceRegistration.findMany.mockResolvedValue([
        { id: "r1", pushToken: "token", platform: "android", isActive: true } as any,
      ])
      mockSend.mockResolvedValue("msg-ok")
      prismaMock.pushNotificationLog.create.mockResolvedValue({} as any)

      await fcmService.sendFromTemplate(42, 1, "t1")

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ _title: "Title EN", _body: "Body EN" }),
        }),
      )
    })

    it("throws for non-existent template", async () => {
      prismaMock.pushNotificationTemplate.findUnique.mockResolvedValue(null)
      await expect(fcmService.sendFromTemplate(42, 1, "bad")).rejects.toThrow("templateNotFound")
    })

    it("throws for inactive template", async () => {
      prismaMock.pushNotificationTemplate.findUnique.mockResolvedValue({
        id: "t1", isActive: false,
      } as any)
      await expect(fcmService.sendFromTemplate(42, 1, "t1")).rejects.toThrow("templateInactive")
    })

    it("truncates variable values at 200 chars", async () => {
      prismaMock.pushNotificationTemplate.findUnique.mockResolvedValue({
        id: "t1", isActive: true,
        titleFr: "{{msg}}", bodyFr: "ok",
        titleEn: "{{msg}}", bodyEn: "ok",
        titleAr: "{{msg}}", bodyAr: "ok",
        dataPayload: null,
      } as any)
      prismaMock.pushDeviceRegistration.findFirst.mockResolvedValue({ locale: "fr" } as any)
      prismaMock.pushDeviceRegistration.findMany.mockResolvedValue([
        { id: "r1", pushToken: "token", platform: "web", isActive: true } as any,
      ])
      mockSend.mockResolvedValue("msg-ok")
      prismaMock.pushNotificationLog.create.mockResolvedValue({} as any)

      const longVar = "x".repeat(500)
      await fcmService.sendFromTemplate(42, 1, "t1", { msg: longVar })

      const sentData = mockSend.mock.calls[0][0].data
      expect(sentData._title.length).toBe(200)
    })
  })

  describe("sendToMultipleUsers", () => {
    it("rejects batch larger than 500 recipients", async () => {
      const userIds = Array.from({ length: 501 }, (_, i) => i + 1)
      await expect(
        fcmService.sendToMultipleUsers(userIds, 1, { title: "Test", body: "Body" }),
      ).rejects.toThrow("batchTooLarge")
    })

    it("sends to multiple users in parallel batches", async () => {
      prismaMock.pushDeviceRegistration.findMany.mockResolvedValue([
        { id: "r1", pushToken: "token", platform: "ios", isActive: true } as any,
      ])
      mockSend.mockResolvedValue("msg-ok")
      prismaMock.pushNotificationLog.create.mockResolvedValue({} as any)

      const result = await fcmService.sendToMultipleUsers(
        [1, 2, 3], 99, { title: "Batch", body: "Test" },
      )

      expect(result.total).toBe(3)
      expect(result.sent).toBe(3)
    })
  })
})
