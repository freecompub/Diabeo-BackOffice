/**
 * US-2409 — Relances en attente (infirmier).
 * Heuristique fallback (silentMonitoring + appointmentUnconfirmed).
 * Polling 120s.
 *
 * Actions : `tel:` + `sms:` URI natif. ⚠️ Twilio SMS server-side
 * deferred — pas de `PatientRecallLog` audit dans ce PR (V2).
 */

"use client"

import { useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner, STALE_MESSAGE_FR } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { DashboardCardHeader } from "@/components/diabeo/dashboard/DashboardCardHeader"
import {
  DashboardRow,
  DashboardAvatar,
  type DashboardAvatarTint,
} from "@/components/diabeo/dashboard/DashboardRow"
import {
  DashboardPill,
  PathologyPill,
  type DashboardPillVariant,
} from "@/components/diabeo/dashboard/DashboardPill"
import { Phone, MessageSquare } from "lucide-react"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { RecallItem } from "@/lib/services/nurse-dashboard.service"

type ApiResponse = { items: RecallItem[] }

/** Reason → i18n key + pill variant + avatar tint (label translated at render). */
const REASON_META: Record<
  RecallItem["reason"],
  { labelKey: string; variant: DashboardPillVariant; tint: DashboardAvatarTint }
> = {
  silentMonitoring: { labelKey: "reasonSilentMonitoring", variant: "warning", tint: "warning" },
  appointmentUnconfirmed: { labelKey: "reasonAppointmentUnconfirmed", variant: "error", tint: "error" },
  neverSynced: { labelKey: "reasonNeverSynced", variant: "accent", tint: "neutral" },
}

export function RecallListCard() {
  const t = useTranslations("dashboardCards.nurseRecall")
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/infirmier/recall-list",
    120_000,
  )
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null
  return (
    <DiabeoCard role="region" aria-labelledby="card-recall-title">
      <DashboardCardHeader
        titleId="card-recall-title"
        title={t("title")}
        dot="warning"
        count={items.length}
      />
      {isStale && <StaleBanner message={STALE_MESSAGE_FR} />}
      <div className="px-4 pb-4 pt-2">
        {loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">
            {t("loadError")}
          </p>
        )}
        {!loading && !hasError && items.length === 0 && (
          <DiabeoEmptyState
            variant="noData"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        )}
        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((r) => {
              const meta = REASON_META[r.reason]
              const name = r.patientFirstName || t("patientFallback")
              const phoneSafe = r.phone && /^[\d\s+()-]+$/.test(r.phone) ? r.phone.replace(/\s/g, "") : null
              return (
                <DashboardRow
                  key={r.patientId}
                  leading={
                    <DashboardAvatar initials={name.charAt(0).toUpperCase()} tint={meta.tint} />
                  }
                  title={
                    <span className="flex items-center gap-2">
                      {name}
                      <PathologyPill pathology={r.pathology} />
                    </span>
                  }
                  sub={r.metricLabel}
                  trailing={
                    <>
                      <DashboardPill variant={meta.variant}>{t(meta.labelKey)}</DashboardPill>
                      {phoneSafe && (
                        <>
                          <a
                            href={`tel:${phoneSafe}`}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted"
                            aria-label={t("callAria", { name })}
                          >
                            <Phone size={12} aria-hidden="true" />
                            {t("call")}
                          </a>
                          <a
                            href={`sms:${phoneSafe}`}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted"
                            aria-label={t("smsAria", { name })}
                          >
                            <MessageSquare size={12} aria-hidden="true" />
                            {t("sms")}
                          </a>
                        </>
                      )}
                    </>
                  }
                />
              )
            })}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
