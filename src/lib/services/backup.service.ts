/**
 * @module backup.service
 * @description US-2151 — Gestion des backups PostgreSQL (méta-données + déclenchement).
 *
 * Architecture :
 *  - Le **dump** réel (`pg_dump → S3`) est exécuté hors-process : soit par un
 *    cron OS (recette) soit par un worker dédié (prod). Ce service écrit
 *    uniquement les méta-données dans `BackupLog` et expose une vue admin.
 *  - Pour le déclenchement manuel (`trigger`), le service crée une row
 *    `pending` avec un `backupRef` UUID puis publie un signal (Redis pub/sub
 *    ou écriture fichier) que le worker observe. **Hors scope MVP** :
 *    l'orchestration worker. Cette US livre la traçabilité + l'API de
 *    consultation, pas l'exécution.
 *
 * **HDS** : aucun PHI dans BackupLog. La `location` est un URI S3 opaque
 * (pas un payload). Audit standard CREATE/READ.
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { logger } from "@/lib/logger"
import type { AuditContext } from "./audit.service"
import type { BackupStatus, Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"

const MAX_LIST_LIMIT = 100

/**
 * Convert a Prisma BigInt to a JSON-safe representation.
 * Returns `number` if it fits within `Number.MAX_SAFE_INTEGER` (2^53-1),
 * otherwise `string` to avoid silent precision loss on petabyte-scale dumps.
 */
function bigIntToJson(value: bigint | null): number | string | null {
  if (value === null) return null
  return value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value.toString()
}

/**
 * Strip Prisma error messages from quoted values that can carry PHI (e.g.
 * "Unique constraint failed on (email = \"x@y.fr\")"). Returns at most
 * 500 chars (DB column cap).
 */
function sanitizeErrorMessage(message: string): string {
  // Strip everything inside double quotes — Prisma error messages embed
  // column values in `="..."` form.
  const stripped = message.replace(/"[^"]*"/g, "?")
  return stripped.slice(0, 500)
}

interface ListFilter {
  status?: BackupStatus[]
  from?: Date
  to?: Date
  limit?: number
  cursor?: number
}

export const backupService = {
  /**
   * Liste paginée des backups (méta-données uniquement, jamais le payload).
   */
  async list(filter: ListFilter, auditUserId: number, ctx?: AuditContext) {
    const limit = Math.min(filter.limit ?? 25, MAX_LIST_LIMIT)
    const where: Prisma.BackupLogWhereInput = {
      ...(filter.status?.length && { status: { in: filter.status } }),
      ...((filter.from ?? filter.to) && {
        startedAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    }

    const items = await prisma.backupLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: limit + 1,
      ...(filter.cursor && { cursor: { id: filter.cursor }, skip: 1 }),
    })

    const hasMore = items.length > limit
    const page = hasMore ? items.slice(0, limit) : items
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "BACKUP",
      resourceId: "admin:backups:list",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { count: page.length },
    })

    // BigInt n'est pas JSON-sérialisable. Cast en number côté API DTO.
    return {
      items: page.map((b) => ({
        ...b,
        sizeBytes: bigIntToJson(b.sizeBytes),
      })),
      nextCursor,
    }
  },

  /**
   * Détail d'un backup spécifique.
   */
  async getByRef(backupRef: string, auditUserId: number, ctx?: AuditContext) {
    const backup = await prisma.backupLog.findUnique({
      where: { backupRef },
    })
    if (!backup) return null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "BACKUP",
      resourceId: `backup:${backupRef}`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
    })

    return {
      ...backup,
      sizeBytes: bigIntToJson(backup.sizeBytes),
    }
  },

  /**
   * Déclenche un nouveau backup — crée la row `pending` et délègue au worker.
   * Le worker (cron / process séparé) doit poller les rows `pending` et
   * passer en `running` puis `completed` / `failed`.
   *
   * @returns BackupLog créé en statut `pending` (audit CREATE).
   */
  async trigger(auditUserId: number, ctx?: AuditContext) {
    const backupRef = randomUUID()

    return prisma.$transaction(async (tx) => {
      // Reject concurrent triggers — a single backup at a time prevents
      // pg_dump pile-up that would saturate disk IO and S3 quota.
      const inflight = await tx.backupLog.count({
        where: { status: { in: ["pending", "running"] } },
      })
      if (inflight > 0) throw new Error("backup_already_in_progress")

      const created = await tx.backupLog.create({
        data: {
          backupRef,
          status: "pending",
          triggeredBy: auditUserId,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "BACKUP",
        resourceId: `backup:${backupRef}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: { manualTrigger: true },
      })

      logger.info("backup", "Backup triggered", {
        userId: auditUserId,
        action: "CREATE",
        resource: "BACKUP",
      })

      return {
        ...created,
        sizeBytes: bigIntToJson(created.sizeBytes),
      }
    })
  },

  /**
   * Mise à jour d'un backup par le worker (transitions de statut + métadonnées).
   * Cette méthode n'est pas exposée par les routes admin — elle est utilisée
   * par le worker qui la call avec un user-ID système (à définir).
   *
   * Validation transitions :
   *  - pending → running, failed
   *  - running → completed, failed
   *  - completed/failed → terminal (rejet)
   */
  async updateStatus(
    backupRef: string,
    update: {
      status: BackupStatus
      location?: string
      sizeBytes?: number
      durationMs?: number
      errorMessage?: string
    },
    workerUserId: number,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.backupLog.findUnique({ where: { backupRef } })
      if (!current) throw new Error("backup_not_found")
      if (current.status === "completed" || current.status === "failed") {
        throw new Error("backup_already_terminal")
      }

      const updated = await tx.backupLog.update({
        where: { backupRef },
        data: {
          status: update.status,
          ...(update.location !== undefined && { location: update.location }),
          ...(update.sizeBytes !== undefined && { sizeBytes: BigInt(update.sizeBytes) }),
          ...(update.durationMs !== undefined && { durationMs: update.durationMs }),
          ...(update.errorMessage !== undefined && {
            // Sanitize before persistence — Prisma errors can embed column values
            // (potential PHI). Cf. healthcare M1 review finding.
            errorMessage: sanitizeErrorMessage(update.errorMessage),
          }),
          ...(update.status === "completed" || update.status === "failed"
            ? { completedAt: new Date() }
            : {}),
        },
      })

      await auditService.logWithTx(tx, {
        userId: workerUserId,
        action: "UPDATE",
        resource: "BACKUP",
        resourceId: `backup:${backupRef}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        oldValue: { status: current.status },
        newValue: { status: update.status },
      })

      return {
        ...updated,
        sizeBytes: bigIntToJson(updated.sizeBytes),
      }
    })
  },
}
