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
import { Badge } from "@/components/ui/badge"
import { Phone, MessageSquare } from "lucide-react"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { RecallItem } from "@/lib/services/nurse-dashboard.service"

type ApiResponse = { items: RecallItem[] }

/** Reason → i18n key + badge variant (label translated at render). */
const REASON_META: Record<RecallItem["reason"], { labelKey: string; variant: "destructive" | "outline" | "secondary" }> = {
  silentMonitoring: { labelKey: "reasonSilentMonitoring", variant: "outline" },
  appointmentUnconfirmed: { labelKey: "reasonAppointmentUnconfirmed", variant: "destructive" },
  neverSynced: { labelKey: "reasonNeverSynced", variant: "secondary" },
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
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="card-recall-title" className="font-display text-base font-semibold">
          {t("title")}
        </h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </header>
      {isStale && <StaleBanner message={STALE_MESSAGE_FR} />}
      <div className="px-4 pb-4">
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
              const phoneSafe = r.phone && /^[\d\s+()-]+$/.test(r.phone) ? r.phone.replace(/\s/g, "") : null
              return (
                <li
                  key={r.patientId}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                    {(r.patientFirstName || "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">
                    {r.patientFirstName || t("patientFallback")}
                    {r.pathology ? ` · ${r.pathology}` : ""}
                  </span>
                  <Badge variant={meta.variant}>{t(meta.labelKey)}</Badge>
                  <span className="text-xs text-muted-foreground">{r.metricLabel}</span>
                  {phoneSafe && (
                    <>
                      <a
                        href={`tel:${phoneSafe}`}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted"
                        aria-label={t("callAria", { name: r.patientFirstName || t("patientGeneric") })}
                      >
                        <Phone size={12} aria-hidden="true" />
                        {t("call")}
                      </a>
                      <a
                        href={`sms:${phoneSafe}`}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted"
                        aria-label={t("smsAria", { name: r.patientFirstName || t("patientGeneric") })}
                      >
                        <MessageSquare size={12} aria-hidden="true" />
                        {t("sms")}
                      </a>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
