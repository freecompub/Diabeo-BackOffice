/**
 * Test suite: Retention Service — audit log anonymization
 *
 * Clinical behavior tested:
 * - Calls SQL retention function with configured year count
 * - Logs audit entry with ANONYMIZE action on AUDIT_LOG resource
 * - Returns anonymized count from SQL function
 * - Handles empty result gracefully
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
    prismaMock.$queryRaw.mockResolvedValue([{ anonymized_count: BigInt(42) }])

    const result = await retentionService.applyRetention(1)

    expect(result.anonymizedCount).toBe(42)
  })

  it("audits with ANONYMIZE action on AUDIT_LOG resource", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ anonymized_count: BigInt(10) }])

    await retentionService.applyRetention(99)

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 99,
        action: "ANONYMIZE",
        resource: "AUDIT_LOG",
        resourceId: expect.stringContaining("retention-"),
        metadata: expect.objectContaining({ anonymizedCount: 10 }),
      }),
    )
  })

  it("returns 0 when no records to anonymize", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ anonymized_count: BigInt(0) }])

    const result = await retentionService.applyRetention(1)
    expect(result.anonymizedCount).toBe(0)
  })

  it("handles empty result array gracefully", async () => {
    prismaMock.$queryRaw.mockResolvedValue([])

    const result = await retentionService.applyRetention(1)
    expect(result.anonymizedCount).toBe(0)
  })

  it("throws on SQL failure", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("SQL error"))

    await expect(retentionService.applyRetention(1)).rejects.toThrow("SQL error")
  })
})
