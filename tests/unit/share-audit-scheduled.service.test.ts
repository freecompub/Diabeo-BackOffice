/**
 * Test suite : share-audit + scheduled-messages services (Batch D
 * US-2239 + US-2261).
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ScheduleType } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"
import { shareAuditQuery } from "@/lib/services/share-audit.service"
import { scheduledMessagesService } from "@/lib/services/scheduled-messages.service"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
})

// ─── US-2239 share-audit ─────────────────────────────────────────────

describe("shareAuditQuery (US-2239)", () => {
  it("filters audit rows by allowed kinds (share-related only)", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      // Allowed kinds
      { id: "a", userId: 1, action: "CREATE", resource: "CONFIG_VERSION",
        resourceId: "100", createdAt: new Date(),
        metadata: { patientId: 7, kind: "third_party_share.upsert" } },
      { id: "b", userId: 2, action: "READ", resource: "CONFIG_VERSION",
        resourceId: "101", createdAt: new Date(),
        metadata: { patientId: 7, kind: "shared_notifications.read" } },
      // Disallowed — not a share kind
      { id: "c", userId: 3, action: "READ", resource: "PATIENT",
        resourceId: "7", createdAt: new Date(),
        metadata: { patientId: 7, kind: "dashboard.medecin.urgencies" } },
    ] as any)
    const out = await shareAuditQuery.forPatient(7, 9)
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.id)).toEqual(["a", "b"])
  })

  it("emits audit row with kind=share_audit.read", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([] as any)
    await shareAuditQuery.forPatient(7, 9)
    const lastAudit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(lastAudit.metadata.kind).toBe("share_audit.read")
    expect(lastAudit.metadata.patientId).toBe(7)
  })
})

// ─── US-2261 scheduled-messages ──────────────────────────────────────

describe("scheduledMessagesService (US-2261)", () => {
  it("listForPatient returns [] when patient not found / deleted", async () => {
    prismaMock.patient.findUnique.mockResolvedValue(null)
    const out = await scheduledMessagesService.listForPatient(999, 9)
    expect(out).toEqual([])
    expect(prismaMock.pushScheduledNotification.findMany).not.toHaveBeenCalled()
  })

  it("listForPatient queries by Patient.userId + active=true by default", async () => {
    prismaMock.patient.findUnique.mockResolvedValue({ userId: 42 } as any)
    prismaMock.pushScheduledNotification.findMany.mockResolvedValue([
      {
        id: "n1", userId: 42, templateId: "T1",
        scheduleType: ScheduleType.once, scheduledAt: new Date(),
        templateVariables: { foo: "bar" }, isActive: true,
        occurrencesCount: 0, maxOccurrences: null, expiresAt: null,
        createdAt: new Date(),
      },
    ] as any)
    const out = await scheduledMessagesService.listForPatient(7, 9)
    expect(out).toHaveLength(1)
    expect(out[0]!.targetUserId).toBe(42)
    const call = prismaMock.pushScheduledNotification.findMany.mock.calls[0]![0]!
    expect((call.where as any).userId).toBe(42)
    expect((call.where as any).isActive).toBe(true)
  })

  it("schedule creates one-shot notification + audits", async () => {
    prismaMock.patient.findUnique.mockResolvedValue({ userId: 42 } as any)
    const scheduledAt = new Date(Date.now() + 86_400_000)
    prismaMock.pushScheduledNotification.create.mockResolvedValue({
      id: "n2", userId: 42, templateId: "T1",
      scheduleType: ScheduleType.once, scheduledAt,
      templateVariables: null, isActive: true,
      occurrencesCount: 0, maxOccurrences: null, expiresAt: null,
      createdAt: new Date(),
    } as any)
    const out = await scheduledMessagesService.schedule(
      7, { templateId: "T1", scheduledAt }, 9,
    )
    expect(out.id).toBe("n2")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("scheduled_messages.schedule")
    expect(meta.metadata.templateId).toBe("T1")
  })

  it("schedule throws when patient not found", async () => {
    prismaMock.patient.findUnique.mockResolvedValue(null)
    await expect(scheduledMessagesService.schedule(999, {
      templateId: "T1", scheduledAt: new Date(Date.now() + 1000),
    }, 9)).rejects.toThrow("patientNotFound")
  })

  it("cancel returns {cancelled:false} on cross-tenant attempt", async () => {
    // Patient exists but the notif belongs to a different userId.
    prismaMock.patient.findUnique.mockResolvedValue({ userId: 42 } as any)
    prismaMock.pushScheduledNotification.findFirst.mockResolvedValue(null)
    const out = await scheduledMessagesService.cancel("notif-foreign", 7, 9)
    expect(out.cancelled).toBe(false)
    expect(prismaMock.pushScheduledNotification.update).not.toHaveBeenCalled()
  })

  it("cancel happy path sets isActive=false + audits", async () => {
    prismaMock.patient.findUnique.mockResolvedValue({ userId: 42 } as any)
    prismaMock.pushScheduledNotification.findFirst.mockResolvedValue({ id: "n3" } as any)
    prismaMock.pushScheduledNotification.update.mockResolvedValue({} as any)
    const out = await scheduledMessagesService.cancel("n3", 7, 9)
    expect(out.cancelled).toBe(true)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("scheduled_messages.cancel")
  })
})
