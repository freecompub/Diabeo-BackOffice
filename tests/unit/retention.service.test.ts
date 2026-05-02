/**
 * Test suite: Retention Service — audit log anonymization
 *
 * Clinical behavior tested:
 * - Calls SQL retention function with configured year count
 * - Logs audit entry on successful retention
 * - Returns anonymized count from SQL function
 * - Throws on SQL failure (does not swallow errors)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/services/audit.service", () => ({
  auditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logWithTx: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { retentionService } from "@/lib/services/retention.service"
import { auditService } from "@/lib/services/audit.service"

describe("retentionService.applyRetention", () => {
  it("calls SQL function and returns anonymized count", async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ anonymized_count: BigInt(42) }])

    const result = await retentionService.applyRetention(1)

    expect(result.anonymizedCount).toBe(42)
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledWith(
      "SELECT * FROM audit_log_apply_retention($1)",
      6,
    )
  })

  it("audits the retention operation", async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ anonymized_count: BigInt(10) }])

    await retentionService.applyRetention(99)

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 99,
        action: "DELETE",
        resource: "USER",
        resourceId: "audit-retention",
        metadata: expect.objectContaining({ anonymizedCount: 10, retentionYears: 6 }),
      }),
    )
  })

  it("returns 0 when no records to anonymize", async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ anonymized_count: BigInt(0) }])

    const result = await retentionService.applyRetention(1)
    expect(result.anonymizedCount).toBe(0)
  })

  it("throws on SQL failure", async () => {
    prismaMock.$queryRawUnsafe.mockRejectedValue(new Error("SQL error"))

    await expect(retentionService.applyRetention(1)).rejects.toThrow("SQL error")
  })
})
