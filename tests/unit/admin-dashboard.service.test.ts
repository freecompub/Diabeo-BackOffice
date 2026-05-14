/**
 * Test suite : admin-dashboard.service (Groupe 9b Batch 3 — 3 US, ~19 SP).
 *
 * Couvre :
 *  - US-2410 admin KPI : 4 metrics parallèles (cabinets/staff/patients/audit)
 *  - US-2412 facturation heuristique : unbilled + amount + recently billed
 *  - compliance : last backup + audit volume 24h + failed backups 30d
 */
import { describe, it, expect, beforeEach } from "vitest"
import { AppointmentStatus, BackupStatus } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"
import {
  adminKpiQuery, billingMetricsQuery, complianceQuery,
} from "@/lib/services/admin-dashboard.service"

// cgmEntry.groupBy & teleconsultationActe.aggregate need cast for Prisma 7 generics.
const pm = prismaMock as unknown as {
  cgmEntry: { groupBy: any }
  teleconsultationActe: { aggregate: any }
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
})

// ─── US-2410 KPI ────────────────────────────────────────────────────

describe("adminKpiQuery (US-2410)", () => {
  it("aggregates 4 metrics in parallel + emits summary audit", async () => {
    prismaMock.healthcareService.count.mockResolvedValue(3)
    prismaMock.healthcareMember.count.mockResolvedValue(7)
    pm.cgmEntry.groupBy.mockResolvedValue([
      { patientId: 1 }, { patientId: 2 }, { patientId: 3 },
    ] as any)
    prismaMock.auditLog.count.mockResolvedValue(42)
    const out = await adminKpiQuery.forCaller(1)
    const byCode = Object.fromEntries(out.map((c) => [c.code, c.value]))
    expect(byCode.totalCabinets).toBe(3)
    expect(byCode.totalStaff).toBe(7)
    expect(byCode.totalActivePatients).toBe(3)
    expect(byCode.auditEventsLast7d).toBe(42)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("dashboard.admin.kpi")
  })
})

// ─── US-2412 Billing ────────────────────────────────────────────────

describe("billingMetricsQuery (US-2412)", () => {
  it("computes unbilled + amount from TeleconsultationActe heuristic", async () => {
    prismaMock.appointment.count.mockResolvedValue(50) // total eligible
    prismaMock.teleconsultationActe.count
      .mockResolvedValueOnce(12)  // unbilled
      .mockResolvedValueOnce(38)  // recently billed
    pm.teleconsultationActe.aggregate.mockResolvedValue({
      _sum: { amountCents: 360_000 }, // 3600 €
    } as any)
    const out = await billingMetricsQuery.forCaller(1)
    expect(out.totalEligible).toBe(50)
    expect(out.unbilledCount).toBe(12)
    expect(out.recentlyBilled).toBe(38)
    expect(out.unbilledAmountCents).toBe(360_000)
    expect(prismaMock.appointment.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: AppointmentStatus.completed,
          location: "video",
        }),
      }),
    )
  })

  it("returns 0 cents when no unbilled actes (aggregate _sum null)", async () => {
    prismaMock.appointment.count.mockResolvedValue(0)
    prismaMock.teleconsultationActe.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
    pm.teleconsultationActe.aggregate.mockResolvedValue({
      _sum: { amountCents: null },
    } as any)
    const out = await billingMetricsQuery.forCaller(1)
    expect(out.unbilledAmountCents).toBe(0)
  })
})

// ─── Compliance snapshot ────────────────────────────────────────────

describe("complianceQuery", () => {
  it("returns last backup + audit + failed counts", async () => {
    const lastBackup = new Date("2026-05-14T03:00:00Z")
    prismaMock.backupLog.findFirst.mockResolvedValue({
      completedAt: lastBackup, status: BackupStatus.completed,
    } as any)
    prismaMock.auditLog.count.mockResolvedValue(1234)
    prismaMock.backupLog.count.mockResolvedValue(2)
    const out = await complianceQuery.forCaller(1)
    expect(out.lastBackupAt).toEqual(lastBackup)
    expect(out.lastBackupStatus).toBe(BackupStatus.completed)
    expect(out.auditEventsLast24h).toBe(1234)
    expect(out.failedBackupsLast30d).toBe(2)
  })

  it("handles missing last backup gracefully", async () => {
    prismaMock.backupLog.findFirst.mockResolvedValue(null)
    prismaMock.auditLog.count.mockResolvedValue(0)
    prismaMock.backupLog.count.mockResolvedValue(0)
    const out = await complianceQuery.forCaller(1)
    expect(out.lastBackupAt).toBeNull()
    expect(out.lastBackupStatus).toBeNull()
  })
})
