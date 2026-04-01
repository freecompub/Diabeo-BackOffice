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
    it("deactivates a registration", async () => {
      prismaMock.pushDeviceRegistration.findFirst.mockResolvedValue({ id: "r1", userId: 1 } as any)
      prismaMock.pushDeviceRegistration.update.mockResolvedValue({} as any)

      const result = await pushService.unregister("r1", 1)
      expect(result.unregistered).toBe(true)
    })

    it("throws for non-existent registration", async () => {
      prismaMock.pushDeviceRegistration.findFirst.mockResolvedValue(null)
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
    it("pauses a scheduled notification", async () => {
      prismaMock.pushScheduledNotification.findFirst.mockResolvedValue({ id: "s1", userId: 1 } as any)
      prismaMock.pushScheduledNotification.update.mockResolvedValue({ id: "s1", isActive: false } as any)
      const result = await pushService.pauseScheduled("s1", 1)
      expect(result.isActive).toBe(false)
    })

    it("throws for non-existent schedule", async () => {
      prismaMock.pushScheduledNotification.findFirst.mockResolvedValue(null)
      await expect(pushService.pauseScheduled("bad", 1)).rejects.toThrow("scheduleNotFound")
    })
  })
})
