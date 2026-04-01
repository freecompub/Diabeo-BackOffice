import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { announcementService } from "@/lib/services/announcement.service"

describe("announcementService", () => {
  describe("list", () => {
    it("returns active announcements", async () => {
      prismaMock.announcement.findMany.mockResolvedValue([
        { id: 1, title: "Maintenance", displayAnnouncement: true },
      ] as any)
      const result = await announcementService.list()
      expect(result).toHaveLength(1)
    })
  })

  describe("create", () => {
    it("creates announcement in transaction", async () => {
      const mockTx = {
        announcement: { create: vi.fn().mockResolvedValue({ id: 1, title: "New feature" }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await announcementService.create({ title: "New feature", content: "<p>Hello</p>" }, 1)
      expect(result.title).toBe("New feature")
    })
  })

  describe("update", () => {
    it("updates announcement", async () => {
      prismaMock.announcement.update.mockResolvedValue({ id: 1, title: "Updated" } as any)
      const result = await announcementService.update(1, { title: "Updated" }, 1)
      expect(result.title).toBe("Updated")
    })
  })

  describe("delete", () => {
    it("deletes announcement in transaction", async () => {
      const mockTx = {
        announcement: { delete: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await announcementService.delete(1, 1)
      expect(result.deleted).toBe(true)
    })
  })
})
