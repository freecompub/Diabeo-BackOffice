import { prisma } from "@/lib/db/client"
import { Prisma } from "@prisma/client"
import { auditService } from "./audit.service"
import { logger } from "@/lib/logger"

const raw = parseInt(process.env.AUDIT_RETENTION_YEARS ?? "6", 10)
if (!Number.isFinite(raw) || raw < 6 || raw > 100) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(`AUDIT_RETENTION_YEARS must be 6-100, got "${process.env.AUDIT_RETENTION_YEARS}"`)
  }
}
const RETENTION_YEARS = Number.isFinite(raw) && raw >= 6 ? raw : 6

export const retentionService = {
  async applyRetention(triggeredBy: number): Promise<{ anonymizedCount: number }> {
    logger.info("retention", `Applying ${RETENTION_YEARS}-year retention on audit_logs`)

    try {
      const result = await prisma.$queryRaw<{ anonymized_count: bigint }[]>(
        Prisma.sql`SELECT * FROM audit_log_apply_retention(${RETENTION_YEARS}::INT)`,
      )

      const anonymizedCount = Number(result[0]?.anonymized_count ?? 0)

      await auditService.log({
        userId: triggeredBy,
        action: "ANONYMIZE",
        resource: "AUDIT_LOG",
        resourceId: `retention-${RETENTION_YEARS}y`,
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
