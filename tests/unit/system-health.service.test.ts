/**
 * @description Groupe 9 — US-2150 System health unit tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/cache/redis-cache", () => ({
  pingRedis: vi.fn().mockResolvedValue("ok"),
}))

import {
  systemHealthService,
  SYSTEM_HEALTH_BOUNDS,
} from "@/lib/services/system-health.service"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }] as any)
  prismaMock.cgmEntry.findFirst.mockResolvedValue({
    timestamp: new Date(Date.now() - 2 * 60_000),
  } as any)
  prismaMock.backupLog.findFirst.mockResolvedValue({
    completedAt: new Date(Date.now() - 3 * 3_600_000),
  } as any)
  prismaMock.session.count.mockResolvedValue(150 as any)
  prismaMock.auditLog.count.mockResolvedValue(5 as any)
})

describe("snapshot — overall status", () => {
  it("returns ok when all components ok", async () => {
    const out = await systemHealthService.snapshot(9)
    expect(out.status).toBe("ok")
    expect(out.components.db).toBe("ok")
    expect(out.components.cgmIngestion).toBe("ok")
    expect(out.components.backups).toBe("ok")
  })

  it("returns degraded when one component degraded", async () => {
    prismaMock.cgmEntry.findFirst.mockResolvedValue({
      timestamp: new Date(Date.now() - 30 * 60_000), // 30 min lag = degraded
    } as any)
    const out = await systemHealthService.snapshot(9)
    expect(out.components.cgmIngestion).toBe("degraded")
    expect(out.status).toBe("degraded")
  })

  it("returns down when DB unreachable", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("connection refused"))
    const out = await systemHealthService.snapshot(9)
    expect(out.components.db).toBe("down")
    expect(out.status).toBe("down")
  })

  it("cgmIngestion=down when lag > 60min", async () => {
    prismaMock.cgmEntry.findFirst.mockResolvedValue({
      timestamp: new Date(Date.now() - 2 * 3_600_000), // 2h lag
    } as any)
    const out = await systemHealthService.snapshot(9)
    expect(out.components.cgmIngestion).toBe("down")
    expect(out.metrics.cgmLagMinutes).toBeGreaterThan(60)
  })

  it("backups=degraded when last > 36h (M3 boundary)", async () => {
    prismaMock.backupLog.findFirst.mockResolvedValue({
      completedAt: new Date(Date.now() - 48 * 3_600_000),
    } as any)
    const out = await systemHealthService.snapshot(9)
    expect(out.components.backups).toBe("degraded")
    expect(out.metrics.lastBackupAgeHours).toBeGreaterThan(SYSTEM_HEALTH_BOUNDS.BACKUP_FRESHNESS_OK_HOURS)
  })

  it("cgmIngestion=unknown when no entries", async () => {
    prismaMock.cgmEntry.findFirst.mockResolvedValue(null)
    const out = await systemHealthService.snapshot(9)
    expect(out.components.cgmIngestion).toBe("unknown")
    expect(out.metrics.cgmLagMinutes).toBeNull()
  })

  it("metrics include activeSessions + unauthorizedAttempts24h (M4 rename)", async () => {
    const out = await systemHealthService.snapshot(9)
    expect(out.metrics.activeSessions).toBe(150)
    expect(out.metrics.unauthorizedAttempts24h).toBe(5)
  })

  it("audit kind=system_health.read + status in metadata", async () => {
    await systemHealthService.snapshot(9)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("system_health.read")
    expect(meta.metadata.status).toBe("ok")
  })

  it("queries audit count with UNAUTHORIZED action and 24h window", async () => {
    await systemHealthService.snapshot(9)
    const call = prismaMock.auditLog.count.mock.calls[0]![0]!
    expect((call.where as any).action).toBe("UNAUTHORIZED")
    expect((call.where as any).createdAt.gte).toBeInstanceOf(Date)
  })
})
