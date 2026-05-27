/**
 * Types + labels partagés pour US-2137 Data Breaches UI.
 *
 * Fix M1 round 1 review PR #457 — extraction DRY entre `DataBreachesListClient`
 * et `DataBreachDetailClient` (les enums + labels + variants étaient
 * dupliqués mot-à-mot, risque divergence).
 *
 * Backend DTO : `src/lib/services/data-breach.service.ts:DataBreachDTO`.
 * Côté client, on re-déclare car les Date deviennent string ISO via JSON.
 */

export type DataBreachSeverity = "low" | "medium" | "high" | "critical"

export type DataBreachStatus =
  | "draft"
  | "under_assessment"
  | "notified_cnil"
  | "notified_users"
  | "closed"

/**
 * Côté client — `Date` Prisma deviennent `string` ISO 8601 via JSON serialize.
 * `allowedTransitions` exposé par backend (Fix H3 round 1 — single source).
 */
export interface DataBreachDTOClient {
  id: number
  severity: DataBreachSeverity
  status: DataBreachStatus
  title: string
  description: string | null
  remediation: string | null
  cnilCaseNumber: string | null
  usersNotifiedCount: number
  detectedAt: string
  declaredBy: number | null
  cnilNotifiedAt: string | null
  usersNotifiedAt: string | null
  closedAt: string | null
  cnilDeadlineHoursRemaining: number | null
  cnilDeadlineExceeded: boolean
  /** Fix H3 round 1 PR #457 — single source of truth FSM backend. */
  allowedTransitions: readonly DataBreachStatus[]
  createdAt: string
  updatedAt: string
}

/**
 * Labels i18n stables — les traductions complètes vivent dans
 * `messages/{fr,en,ar}.json` sous `admin.dataBreaches.*`. Fallback FR ici
 * pour usage hors React (toast, audit metadata).
 */
export const SEVERITY_LABELS_FR: Record<DataBreachSeverity, string> = {
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  critical: "Critique",
}

export const STATUS_LABELS_FR: Record<DataBreachStatus, string> = {
  draft: "Brouillon",
  under_assessment: "En évaluation",
  notified_cnil: "Notifié CNIL",
  notified_users: "Utilisateurs notifiés",
  closed: "Clos",
}

/**
 * Map sévérité → variant Badge shadcn. Typage strict évite divergence si
 * shadcn rename un variant (TS bloque le build).
 */
export type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

export const SEVERITY_VARIANT: Record<DataBreachSeverity, BadgeVariant> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  critical: "destructive",
}
