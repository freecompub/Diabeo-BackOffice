import { prisma } from "@/lib/db/client"
import { Prisma } from "@prisma/client"
import { auditService } from "./audit.service"
import { logger } from "@/lib/logger"

function getRetentionYears(): number {
  const raw = parseInt(process.env.AUDIT_RETENTION_YEARS ?? "6", 10)
  if (!Number.isFinite(raw) || raw < 6 || raw > 100) {
    if (process.env.NODE_ENV !== "test") {
      throw new Error(`AUDIT_RETENTION_YEARS must be 6-100, got "${process.env.AUDIT_RETENTION_YEARS}"`)
    }
    return 6
  }
  return raw
}

export const retentionService = {
  async applyRetention(triggeredBy: number): Promise<{ anonymizedCount: number }> {
    const retentionYears = getRetentionYears()
    logger.info("retention", `Applying ${retentionYears}-year retention on audit_logs`)

    try {
      const result = await prisma.$queryRaw<{ anonymized_count: bigint }[]>(
        Prisma.sql`SELECT * FROM audit_log_apply_retention(${retentionYears}::INT)`,
      )

      const anonymizedCount = Number(result[0]?.anonymized_count ?? 0)

      await auditService.log({
        userId: triggeredBy,
        action: "ANONYMIZE",
        resource: "AUDIT_LOG",
        resourceId: `retention-${retentionYears}y`,
        metadata: { anonymizedCount, retentionYears },
      })

      logger.info("retention", `Retention complete: ${anonymizedCount} records anonymized`)
      return { anonymizedCount }
    } catch (err) {
      logger.error("retention", "Retention failed", {}, err)
      throw err
    }
  },
}
