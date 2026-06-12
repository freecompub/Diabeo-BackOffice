/**
 * Compliance snapshot (admin) : backup + audit + RGPD placeholder.
 * Polling 5min.
 */

"use client"

import { useTranslations, useLocale } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { Badge } from "@/components/ui/badge"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import { formatDate as formatDateIntl } from "@/lib/intl/formatters"
import type { Locale } from "@/i18n/config"
import type { ComplianceSnapshot } from "@/lib/services/admin-dashboard.service"

type ApiResponse = { item: ComplianceSnapshot }

// code-review M3 (re-review) — externalised threshold for ANSSI/HDS
//   traceability ; surfaces a "Stale" badge when last successful backup
//   is older than this many days.
const STALE_BACKUP_DAYS = 2

/**
 * Formate une date selon la locale utilisateur via le helper canonique
 * `lib/intl/formatters`. Le helper mappe la locale courte (`fr|en|ar`) vers
 * le tag BCP-47 attendu (`fr-FR|en-GB|ar-MA`) — un audit HDS lit donc
 * `12/06/2026 14:14` (en-GB) plutôt que `06/12/2026 02:14 PM` (en-US implicite).
 *
 * La timezone reste figée à `Europe/Paris` car les backups/audits sont opérés
 * depuis l'infra OVH GRA : l'horodatage forensique doit refléter l'heure
 * locale du data center, indépendamment de la locale de l'admin.
 */
function formatBackupDate(
  d: Date | string | null,
  locale: Locale,
  fallback: string,
): string {
  if (!d) return fallback
  return formatDateIntl(d, locale, {
    style: "short",
    withTime: true,
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
  const locale = useLocale() as Locale
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
      {isStale && <StaleBanner message={t("stale")} />}
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
                <span>{formatBackupDate(item.lastBackupAt, locale, t("complianceNoBackup"))}</span>
                {backupStale && backupAge !== null && (
                  <Badge variant="destructive">{t("staleBadge", { days: backupAge })}</Badge>
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
                  <Badge variant="destructive">{t("alertBadge")}</Badge>
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
