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
  $queryRaw: any
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
})

// ─── US-2410 KPI ────────────────────────────────────────────────────

describe("adminKpiQuery (US-2410)", () => {
  it("aggregates 4 metrics in parallel + emits summary audit", async () => {
    prismaMock.healthcareService.count.mockResolvedValue(3)
    prismaMock.user.findMany.mockResolvedValue([
      { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }, { id: 7 },
    ] as any)
    prismaMock.healthcareMember.count.mockResolvedValue(7)
    pm.$queryRaw.mockResolvedValue([{ count: BigInt(3) }] as any)
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

  // code-review H3 (re-review) — staff filter aligns with M2 fix.
  //   The 2-step approach : User.findMany(status=active) → IDs → count
  //   HealthcareMember WHERE userId IN ids.
  it("totalStaff filters by user.status=active via 2-step query (M2)", async () => {
    prismaMock.healthcareService.count.mockResolvedValue(0)
    prismaMock.user.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }] as any)
    prismaMock.healthcareMember.count.mockResolvedValue(2)
    pm.$queryRaw.mockResolvedValue([{ count: BigInt(0) }] as any)
    prismaMock.auditLog.count.mockResolvedValue(0)
    await adminKpiQuery.forCaller(1)
    const userCall = prismaMock.user.findMany.mock.calls[0]![0]!
    expect((userCall.where as any).status).toBe("active")
    const memberCall = prismaMock.healthcareMember.count.mock.calls[0]![0]!
    expect((memberCall.where as any).userId).toEqual({ in: [1, 2] })
  })

  // code-review H3 (re-review) — totalActivePatients returns 0 when raw
  //   query returns null/empty (defensive against pg edge cases).
  it("totalActivePatients returns 0 when raw query yields no row", async () => {
    prismaMock.healthcareService.count.mockResolvedValue(0)
    prismaMock.user.findMany.mockResolvedValue([] as any)
    prismaMock.healthcareMember.count.mockResolvedValue(0)
    pm.$queryRaw.mockResolvedValue([] as any)
    prismaMock.auditLog.count.mockResolvedValue(0)
    const out = await adminKpiQuery.forCaller(1)
    expect(out.find((c) => c.code === "totalActivePatients")!.value).toBe(0)
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

  // code-review H1 (re-review) — recentlyBilled count now filters by
  //   completedFilter to stay aligned with totalEligible / unbilled.
  it("recentlyBilled count chains completedFilter (H1)", async () => {
    prismaMock.appointment.count.mockResolvedValue(10)
    prismaMock.teleconsultationActe.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(8)
    pm.teleconsultationActe.aggregate.mockResolvedValue({
      _sum: { amountCents: 60_000 },
    } as any)
    await billingMetricsQuery.forCaller(1)
    // The 2nd teleconsultationActe.count call (recentlyBilled) must include
    // appointment: completedFilter — not bare invoicedAt filter.
    const recentlyBilledCall = prismaMock.teleconsultationActe.count.mock.calls[1]![0]!
    expect((recentlyBilledCall.where as any).appointment).toBeDefined()
    expect((recentlyBilledCall.where as any).appointment.status).toBe("completed")
    expect((recentlyBilledCall.where as any).appointment.location).toBe("video")
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

  // code-review M1 (re-review) — findFirst filter includes completedAt
  //   NOT null (Postgres NULLS FIRST on DESC would otherwise return a
  //   completed row with null completedAt as "latest").
  it("findFirst filter includes completedAt: not null (M1)", async () => {
    prismaMock.backupLog.findFirst.mockResolvedValue(null)
    prismaMock.auditLog.count.mockResolvedValue(0)
    prismaMock.backupLog.count.mockResolvedValue(0)
    await complianceQuery.forCaller(1)
    const call = prismaMock.backupLog.findFirst.mock.calls[0]![0]!
    expect((call.where as any).completedAt).toEqual({ not: null })
  })
})
