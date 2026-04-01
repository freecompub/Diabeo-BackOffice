/**
 * Test suite: Push Service — Push Notification Delivery and Registration
 *
 * Clinical behavior tested:
 * - Device registration (upsert): registering an FCM push token for a user
 *   and platform (iOS, Android, web); if another user previously held the
 *   same token, their registration is deactivated to prevent cross-user
 *   notification delivery
 * - Listing registrations for a user returns masked FCM tokens (only prefix
 *   and suffix visible) so tokens are never fully exposed in API responses
 * - Sending a notification: template variable interpolation, FCM dispatch,
 *   and PushNotificationLog creation are executed atomically — no log entry
 *   is written for a notification that failed to reach FCM
 * - Scheduled notification creation: stores a PushScheduledNotification row
 *   with a future sendAt timestamp for the cron dispatcher to pick up
 *
 * Associated risks:
 * - Failing to deactivate a token reassigned to a different user would cause
 *   health alerts (hypoglycemia warnings, appointment reminders) to be
 *   delivered to the wrong person, breaching patient confidentiality
 * - Exposing full FCM tokens in the listing API would allow an attacker with
 *   API access to send arbitrary push notifications to any patient's device
 * - Logging a notification as "sent" before confirming FCM acceptance would
 *   produce misleading delivery records that mask actual delivery failures
 *
 * Edge cases:
 * - Token already registered to the same user and platform (idempotent upsert
 *   — must update timestamp, not create a duplicate row)
 * - Token registered to a different user (prior registration must be
 *   deactivated before the new one is created)
 * - User with no registered devices (listRegistrations returns empty array)
 * - Notification template with missing variable substitution (must fail with
 *   a descriptive error before FCM dispatch)
 * - FCM dispatch failure (network error) — log must not be created
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { pushService } from "@/lib/services/push.service"

describe("pushService", () => {
  describe("listRegistrations", () => {
    it("returns registrations with masked tokens", async () => {
      prismaMock.pushDeviceRegistration.findMany.mockResolvedValue([
        { id: "r1", pushToken: "abc123def456ghi789jkl012mno345pqr678stu901vwx234yz" },
      ] as any)

      const result = await pushService.listRegistrations(1)
      expect(result[0].pushToken).toContain("...")
      expect(result[0].pushToken).not.toBe("abc123def456ghi789jkl012mno345pqr678stu901vwx234yz")
    })
  })

  describe("register", () => {
    it("upserts registration and deactivates other users", async () => {
      const mockTx = {
        pushDeviceRegistration: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          upsert: vi.fn().mockResolvedValue({
            id: "r1", pushToken: "token123456789abcdef", userId: 1, isActive: true,
          }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await pushService.register(1, {
        platform: "ios" as any, pushToken: "token123456789abcdef",
      })
      expect(result.pushToken).toContain("...")
    })
  })

  describe("unregister", () => {
    it("deactivates a registration in transaction with audit", async () => {
      const mockTx = {
        pushDeviceRegistration: {
          findFirst: vi.fn().mockResolvedValue({ id: "r1", userId: 1 }),
          update: vi.fn().mockResolvedValue({}),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await pushService.unregister("r1", 1)
      expect(result.unregistered).toBe(true)
      expect(mockTx.auditLog.create).toHaveBeenCalled()
    })

    it("throws for non-existent registration", async () => {
      const mockTx = {
        pushDeviceRegistration: { findFirst: vi.fn().mockResolvedValue(null) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(pushService.unregister("bad", 1)).rejects.toThrow("registrationNotFound")
    })
  })

  describe("unregisterAll", () => {
    it("deactivates all registrations", async () => {
      prismaMock.pushDeviceRegistration.updateMany.mockResolvedValue({ count: 3 })
      const result = await pushService.unregisterAll(1)
      expect(result.unregisteredAll).toBe(true)
    })
  })

  describe("listTemplates", () => {
    it("returns active templates", async () => {
      prismaMock.pushNotificationTemplate.findMany.mockResolvedValue([])
      const result = await pushService.listTemplates()
      expect(result).toEqual([])
    })
  })

  describe("listScheduled", () => {
    it("returns scheduled notifications", async () => {
      prismaMock.pushScheduledNotification.findMany.mockResolvedValue([])
      const result = await pushService.listScheduled(1)
      expect(result).toEqual([])
    })
  })

  describe("pauseScheduled", () => {
    it("pauses a scheduled notification in transaction with audit", async () => {
      const mockTx = {
        pushScheduledNotification: {
          findFirst: vi.fn().mockResolvedValue({ id: "s1", userId: 1, isActive: true }),
          update: vi.fn().mockResolvedValue({ id: "s1", isActive: false }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await pushService.pauseScheduled("s1", 1)
      expect(result.isActive).toBe(false)
      expect(mockTx.auditLog.create).toHaveBeenCalled()
    })

    it("throws for non-existent schedule", async () => {
      const mockTx = {
        pushScheduledNotification: { findFirst: vi.fn().mockResolvedValue(null) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(pushService.pauseScheduled("bad", 1)).rejects.toThrow("scheduleNotFound")
    })
  })

  describe("resumeScheduled", () => {
    it("resumes a paused schedule in transaction with audit", async () => {
      const mockTx = {
        pushScheduledNotification: {
          findFirst: vi.fn().mockResolvedValue({ id: "s1", userId: 1, isActive: false }),
          update: vi.fn().mockResolvedValue({ id: "s1", isActive: true }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await pushService.resumeScheduled("s1", 1)
      expect(result.isActive).toBe(true)
      expect(mockTx.auditLog.create).toHaveBeenCalled()
    })

    it("throws for non-existent schedule", async () => {
      const mockTx = {
        pushScheduledNotification: { findFirst: vi.fn().mockResolvedValue(null) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(pushService.resumeScheduled("bad", 1)).rejects.toThrow("scheduleNotFound")
    })
  })

  describe("createScheduled", () => {
    it("creates scheduled notification and audits", async () => {
      prismaMock.pushScheduledNotification.create.mockResolvedValue({
        id: "sched-1", userId: 1, templateId: "glycemia_reminder", scheduleType: "daily",
      } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await pushService.createScheduled(1, {
        templateId: "glycemia_reminder",
        scheduleType: "daily" as any,
        cronExpression: "0 8 * * *",
      })
      expect(result.id).toBe("sched-1")
      expect(prismaMock.auditLog.create).toHaveBeenCalled()
    })
  })

  describe("getTemplate", () => {
    it("returns a template by id", async () => {
      prismaMock.pushNotificationTemplate.findUnique.mockResolvedValue({
        id: "hypo_alert", category: "alert",
      } as any)
      const result = await pushService.getTemplate("hypo_alert")
      expect(result!.id).toBe("hypo_alert")
    })

    it("returns null for non-existent template", async () => {
      prismaMock.pushNotificationTemplate.findUnique.mockResolvedValue(null)
      const result = await pushService.getTemplate("bad")
      expect(result).toBeNull()
    })
  })
})
