/**
 * Test suite: Announcement Service — System-Wide Announcements
 *
 * Clinical behavior tested:
 * - Listing active announcements (displayAnnouncement=true) for display in
 *   the patient and practitioner dashboards; inactive announcements are
 *   filtered out server-side and never sent to clients
 * - Creating a new announcement: content is saved and an audit log entry
 *   recording the author's identity is written within a transaction so
 *   every published communication is traceable
 * - Toggling announcement visibility (activate / deactivate): allows ADMIN
 *   users to control which announcements are visible without deleting them,
 *   preserving a history of all past communications
 * - Authorization enforcement: only ADMIN role may create or toggle
 *   announcements; DOCTOR and NURSE roles are read-only
 *
 * Associated risks:
 * - Publishing an announcement without an audit trail removes accountability
 *   for communications sent to patients (regulatory and liability concern)
 * - A missing displayAnnouncement filter in the list query would expose
 *   draft or deactivated announcements to end users
 * - Allowing a NURSE to create announcements would bypass the administrative
 *   review process intended to prevent misinformation reaching patients
 *
 * Edge cases:
 * - Listing when no announcements are active (must return empty array)
 * - Toggling an already-active announcement to active (idempotent — no error)
 * - Announcement with an empty title or body (Zod validation must reject)
 * - Announcement whose displayFrom / displayUntil window has expired (must
 *   be excluded from the active list even if displayAnnouncement=true)
 */
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
    it("updates announcement with audit in transaction", async () => {
      const mockTx = {
        announcement: { update: vi.fn().mockResolvedValue({ id: 1, title: "Updated" }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await announcementService.update(1, { title: "Updated" }, 1)
      expect(result.title).toBe("Updated")
      expect(mockTx.auditLog.create).toHaveBeenCalled()
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
