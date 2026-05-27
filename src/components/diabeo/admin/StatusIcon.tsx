/**
 * StatusIcon — composant partagé entre admin clients (SystemHealth, Backups).
 *
 * Fix M2 round 1 review PR #458 — DRY (vs 2 implémentations dupliquées avec
 * mappings différents). Map sur 2 unions disjointes : `ComponentStatus`
 * (system health) + `BackupStatus`.
 *
 * Fix H3 round 1 review PR #458 — `motion-safe:animate-spin` pour Loader2
 * (status backup `running`) respecte `prefers-reduced-motion` user
 * (WCAG 2.3.3 Animation from Interactions).
 */

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import type { ComponentStatus, BackupStatus } from "@/lib/types/admin-ops"

interface StatusIconBaseProps {
  className?: string
}

interface ComponentStatusIconProps extends StatusIconBaseProps {
  kind: "component"
  status: ComponentStatus
}

interface BackupStatusIconProps extends StatusIconBaseProps {
  kind: "backup"
  status: BackupStatus
}

type StatusIconProps = ComponentStatusIconProps | BackupStatusIconProps

const COMPONENT_ICONS: Record<ComponentStatus, LucideIcon> = {
  ok: CheckCircle2,
  degraded: AlertCircle,
  down: XCircle,
  unknown: HelpCircle,
}

const BACKUP_ICONS: Record<BackupStatus, LucideIcon> = {
  completed: CheckCircle2,
  running: Loader2,
  failed: XCircle,
  pending: Clock,
}

export function StatusIcon(props: StatusIconProps) {
  const Icon = props.kind === "component"
    ? COMPONENT_ICONS[props.status]
    : BACKUP_ICONS[props.status]
  const isSpinning = props.kind === "backup" && props.status === "running"
  return (
    <Icon
      className={`${props.className ?? ""} ${isSpinning ? "motion-safe:animate-spin" : ""}`.trim()}
      aria-hidden="true"
    />
  )
}
