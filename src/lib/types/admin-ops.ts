/**
 * Types partagés pour US-2150 (System Health) + US-2151 (Backups) UI.
 *
 * Fix M1 round 1 review PR #458 — extraction DRY (vs DTOs inline dans
 * SystemHealthClient + BackupsListClient). Cohérent pattern PR #457
 * `src/lib/types/data-breach.ts`.
 *
 * Backend DTOs : `system-health.service.ts:SystemHealthDTO` +
 * `backup.service.ts:list()` return type.
 */

// ─────────────────────────────────────────────────────────────
// US-2150 System Health
// ─────────────────────────────────────────────────────────────

export type ComponentStatus = "ok" | "degraded" | "down" | "unknown"
export type OverallStatus = "ok" | "degraded" | "down"

export interface SystemHealthDTOClient {
  status: OverallStatus
  components: {
    db: ComponentStatus
    redis: ComponentStatus
    cgmIngestion: ComponentStatus
    backups: ComponentStatus
  }
  metrics: {
    activeSessions: number
    /** M4 (review re-1 PR #409) — comptage AuditLog UNAUTHORIZED 24h. */
    unauthorizedAttempts24h: number
    cgmLagMinutes: number | null
    lastBackupAgeHours: number | null
  }
  checkedAt: string // ISO 8601 (Date sérialisé via JSON)
}

// ─────────────────────────────────────────────────────────────
// US-2151 Backups
// ─────────────────────────────────────────────────────────────

export type BackupStatus = "pending" | "running" | "completed" | "failed"

/**
 * Fix M5 round 1 review PR #458 (HSA MEDIUM-3) — `location` (URI S3)
 * retiré du DTO API. Remplacé par `hasLocation: boolean` pour UI savoir
 * si backup est restorable sans exposer le path S3 (anti bucket
 * enumeration + path discovery).
 */
export interface BackupLogDTOClient {
  id: number
  backupRef: string
  status: BackupStatus
  hasLocation: boolean
  sizeBytes: number | null // BigInt → number via bigIntToJson (≤ TB OK)
  durationMs: number | null
  triggeredBy: number | null
  startedAt: string // ISO
  completedAt: string | null
  errorMessage: string | null // Sanitized backend via sanitizeErrorMessage
}

// ─────────────────────────────────────────────────────────────
// Labels FR (i18n complet V2 via messages/{fr,en,ar}.json)
// ─────────────────────────────────────────────────────────────

export const COMPONENT_STATUS_LABELS_FR: Record<ComponentStatus, string> = {
  ok: "OK",
  degraded: "Dégradé",
  down: "HS",
  unknown: "Inconnu",
}

export const BACKUP_STATUS_LABELS_FR: Record<BackupStatus, string> = {
  pending: "En attente",
  running: "En cours",
  completed: "Terminé",
  failed: "Échoué",
}

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

export const COMPONENT_STATUS_VARIANT: Record<ComponentStatus, BadgeVariant> = {
  ok: "default",
  degraded: "outline",
  down: "destructive",
  unknown: "secondary",
}

export const BACKUP_STATUS_VARIANT: Record<BackupStatus, BadgeVariant> = {
  pending: "secondary",
  running: "outline",
  completed: "default",
  failed: "destructive",
}

export const OVERALL_STATUS_LABELS_FR: Record<OverallStatus, string> = {
  ok: "Opérationnel",
  degraded: "Dégradé",
  down: "Hors service",
}

export const OVERALL_STATUS_VARIANT: Record<OverallStatus, BadgeVariant> = {
  ok: "default",
  degraded: "outline",
  down: "destructive",
}
