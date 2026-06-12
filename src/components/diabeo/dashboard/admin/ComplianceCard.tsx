/**
 * Compliance snapshot (admin) : backup + audit + RGPD placeholder.
 * Polling 5min.
 */

"use client"

import { useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { StaleBanner, STALE_MESSAGE_FR } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { Badge } from "@/components/ui/badge"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { ComplianceSnapshot } from "@/lib/services/admin-dashboard.service"

type ApiResponse = { item: ComplianceSnapshot }

// code-review M3 (re-review) — externalised threshold for ANSSI/HDS
//   traceability ; surfaces a "Stale" badge when last successful backup
//   is older than this many days.
const STALE_BACKUP_DAYS = 2

function formatDate(d: Date | string | null, fallback: string): string {
  if (!d) return fallback
  return new Date(d).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Paris",
  })
}

function backupAgeDays(d: Date | string | null): number | null {
  if (!d) return null
  // code-review M3 (re-review) — clamp negative ages from clock skew.
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000))
}

export function ComplianceCard() {
  const t = useTranslations("adminDashboard")
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/admin/compliance",
    5 * 60_000,
  )
  const item = data?.item ?? null
  const hasError = error !== null && data === null
  const backupAge = item ? backupAgeDays(item.lastBackupAt) : null
  const backupStale = backupAge !== null && backupAge > STALE_BACKUP_DAYS
  return (
    <DiabeoCard role="region" aria-labelledby="admin-compliance-title">
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="admin-compliance-title" className="text-base font-semibold">
          {t("complianceTitle")}
        </h2>
      </header>
      {isStale && <StaleBanner message={STALE_MESSAGE_FR} />}
      <div className="px-4 pb-4">
        {loading && item === null && (
          <p className="text-sm text-muted-foreground">{t("complianceLoading")}</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">
            {t("complianceLoadError")}
          </p>
        )}
        {item && (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t("complianceLastBackup")}</dt>
              <dd className="flex items-center gap-2 text-sm">
                <span>{formatDate(item.lastBackupAt, t("complianceNoBackup"))}</span>
                {backupStale && (
                  <Badge variant="destructive">Stale ({backupAge}j)</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("complianceAudit24h")}</dt>
              <dd className="text-lg font-semibold">{item.auditEventsLast24h}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("complianceBackupsFailed")}</dt>
              <dd className="flex items-center gap-2 text-lg font-semibold">
                {item.failedBackupsLast30d}
                {item.failedBackupsLast30d > 0 && (
                  <Badge variant="destructive">Alerte</Badge>
                )}
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t("complianceRgpdPlaceholder")}
        </p>
      </div>
    </DiabeoCard>
  )
}
