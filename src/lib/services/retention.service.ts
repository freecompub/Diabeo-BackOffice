import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { logger } from "@/lib/logger"

const RETENTION_YEARS = parseInt(process.env.AUDIT_RETENTION_YEARS ?? "6", 10)

export const retentionService = {
  async applyRetention(triggeredBy: number): Promise<{ anonymizedCount: number }> {
    logger.info("retention", `Applying ${RETENTION_YEARS}-year retention on audit_logs`)

    try {
      const result = await prisma.$queryRawUnsafe<{ anonymized_count: bigint }[]>(
        `SELECT * FROM audit_log_apply_retention($1)`,
        RETENTION_YEARS,
      )

      const anonymizedCount = Number(result[0]?.anonymized_count ?? 0)

      await auditService.log({
        userId: triggeredBy,
        action: "DELETE",
        resource: "USER",
        resourceId: "audit-retention",
        metadata: { anonymizedCount, retentionYears: RETENTION_YEARS },
      })

      logger.info("retention", `Retention complete: ${anonymizedCount} records anonymized`)
      return { anonymizedCount }
    } catch (err) {
      logger.error("retention", "Retention failed", {}, err)
      throw err
    }
  },
}
