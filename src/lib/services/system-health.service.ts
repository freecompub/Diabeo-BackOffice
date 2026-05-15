/**
 * @module system-health.service
 * @description Groupe 9 — US-2150 Dashboard santé système.
 *
 * Vue admin enrichie sur les composants internes : DB, Redis, last
 * backup, recent error count (via AuditLog), active sessions count,
 * CGM ingestion freshness (max(eventDate) sur cgm_entries).
 *
 * **Différence vs `/api/health` public** : ce dashboard expose des
 * metrics internes (lag CGM, erreur récente) qui peuvent leaker des
 * info sur la santé du système → ADMIN-only.
 *
 * Audit US-2268 : `metadata.kind = "system_health.read"`.
 */

import { prisma } from "@/lib/db/client"
import { cacheGet } from "@/lib/cache/redis-cache"
import { auditService, type AuditContext } from "./audit.service"

// ─────────────────────────────────────────────────────────────
// Audit kinds typés
// ─────────────────────────────────────────────────────────────

export type SystemHealthAuditKind = "system_health.read"

const AUDIT_KIND = {
  READ: "system_health.read",
} as const satisfies Record<string, SystemHealthAuditKind>

// ─────────────────────────────────────────────────────────────
// Bornes & types
// ─────────────────────────────────────────────────────────────

export const SYSTEM_HEALTH_BOUNDS = {
  /** Période d'agrégation pour le compteur d'erreurs récentes. */
  RECENT_ERRORS_WINDOW_HOURS: 24,
  /** Lag CGM acceptable avant de marquer l'ingestion comme `degraded`. */
  CGM_INGESTION_OK_MAX_MIN: 15,
  CGM_INGESTION_DEGRADED_MAX_MIN: 60,
  /** Age maximum d'un backup pour le marquer `ok`. */
  BACKUP_FRESHNESS_OK_HOURS: 30,
} as const

export type ComponentStatus = "ok" | "degraded" | "down" | "unknown"
export type OverallStatus = "ok" | "degraded" | "down"

export interface SystemHealthDTO {
  status: OverallStatus
  components: {
    db: ComponentStatus
    redis: ComponentStatus
    cgmIngestion: ComponentStatus
    backups: ComponentStatus
  }
  metrics: {
    activeSessions: number
    recentErrors24h: number
    cgmLagMinutes: number | null
    lastBackupAgeHours: number | null
  }
  checkedAt: Date
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function checkDb(): Promise<ComponentStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return "ok"
  } catch {
    return "down"
  }
}

async function checkRedis(): Promise<ComponentStatus> {
  try {
    // `cacheGet` retourne null si Redis n'est pas configuré (mode dégradé OK).
    // Si erreur réseau, on considère down.
    const ok = await Promise.race([
      cacheGet<string>("system-health", "probe").then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_500)),
    ])
    return ok ? "ok" : "degraded"
  } catch {
    return "down"
  }
}

async function checkCgmIngestion(): Promise<{
  status: ComponentStatus
  lagMinutes: number | null
}> {
  try {
    const last = await prisma.cgmEntry.findFirst({
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    })
    if (!last) return { status: "unknown", lagMinutes: null }
    const lagMs = Date.now() - last.timestamp.getTime()
    const lagMinutes = Math.floor(lagMs / 60_000)
    if (lagMinutes <= SYSTEM_HEALTH_BOUNDS.CGM_INGESTION_OK_MAX_MIN) {
      return { status: "ok", lagMinutes }
    }
    if (lagMinutes <= SYSTEM_HEALTH_BOUNDS.CGM_INGESTION_DEGRADED_MAX_MIN) {
      return { status: "degraded", lagMinutes }
    }
    return { status: "down", lagMinutes }
  } catch {
    return { status: "down", lagMinutes: null }
  }
}

async function checkBackups(): Promise<{
  status: ComponentStatus
  ageHours: number | null
}> {
  try {
    const last = await prisma.backupLog.findFirst({
      where: { status: "completed" },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    })
    if (!last || !last.completedAt) return { status: "unknown", ageHours: null }
    const ageHours = Math.floor((Date.now() - last.completedAt.getTime()) / 3_600_000)
    if (ageHours <= SYSTEM_HEALTH_BOUNDS.BACKUP_FRESHNESS_OK_HOURS) {
      return { status: "ok", ageHours }
    }
    return { status: "degraded", ageHours }
  } catch {
    return { status: "unknown", ageHours: null }
  }
}

function rollupStatus(parts: ComponentStatus[]): OverallStatus {
  if (parts.includes("down")) return "down"
  if (parts.includes("degraded")) return "degraded"
  return "ok"
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const systemHealthService = {
  /**
   * Snapshot complet santé système. Audit READ (kind=system_health.read).
   * Tous les checks en Promise.all pour minimiser latence.
   */
  async snapshot(
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<SystemHealthDTO> {
    const recentErrorsCutoff = new Date(
      Date.now() - SYSTEM_HEALTH_BOUNDS.RECENT_ERRORS_WINDOW_HOURS * 3_600_000,
    )

    const [db, redis, cgm, backup, activeSessions, recentErrors24h] = await Promise.all([
      checkDb(),
      checkRedis(),
      checkCgmIngestion(),
      checkBackups(),
      prisma.session.count({ where: { expires: { gt: new Date() } } }),
      prisma.auditLog.count({
        where: {
          action: "UNAUTHORIZED",
          createdAt: { gte: recentErrorsCutoff },
        },
      }),
    ])

    const overall = rollupStatus([db, redis, cgm.status, backup.status])

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "SYSTEM_HEALTH",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        kind: AUDIT_KIND.READ,
        status: overall,
      },
    })

    return {
      status: overall,
      components: {
        db,
        redis,
        cgmIngestion: cgm.status,
        backups: backup.status,
      },
      metrics: {
        activeSessions,
        recentErrors24h,
        cgmLagMinutes: cgm.lagMinutes,
        lastBackupAgeHours: backup.ageHours,
      },
      checkedAt: new Date(),
    }
  },
}
