/**
 * US-2602 (Ma journée) — Messages non lus (médecin).
 *
 * Liste read-only des conversations comportant ≥ 1 message non lu (top 5),
 * réutilise `messagingService.listThreads` (trigger `"poll"`) via la route
 * dashboard. Polling 60s. Le preview est déjà déchiffré et tronqué côté
 * service ; aucune logique métier ni déchiffrement côté frontend.
 */

"use client"

import { useLocale, useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { DashboardCardHeader } from "@/components/diabeo/dashboard/DashboardCardHeader"
import { DashboardRow, DashboardRowAction } from "@/components/diabeo/dashboard/DashboardRow"
import { DashboardPill } from "@/components/diabeo/dashboard/DashboardPill"
import { Mail } from "lucide-react"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import { bcp47 } from "@/i18n/config"
import type { UnreadThreadItem } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: UnreadThreadItem[] }

function formatDate(d: Date | string, locale: string): string {
  return new Date(d).toLocaleString(bcp47(locale), {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Paris",
  })
}

export function UnreadMessagesCard() {
  const t = useTranslations("dashboardCards.medecinMessages")
  const locale = useLocale()
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/medecin/unread-threads",
    60_000,
  )
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null
  return (
    <DiabeoCard role="region" aria-labelledby="card-messages-title">
      <DashboardCardHeader
        titleId="card-messages-title"
        title={t("title")}
        dot="success"
        count={items.length}
        more={{ href: "/messages", label: t("seeAll") }}
      />
      {isStale && <StaleBanner message={t("stale")} />}
      <div className="px-4 pb-4 pt-2">
        {loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">{t("loadError")}</p>
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
            {items.map((m) => {
              const preview = m.preview
                ? `${m.preview}${m.previewTruncated ? "…" : ""}`
                : t("previewFallback")
              return (
                <DashboardRow
                  key={m.conversationKey}
                  leading={
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
                      aria-hidden="true"
                    >
                      <Mail size={15} />
                    </span>
                  }
                  title={preview}
                  sub={
                    <time dateTime={new Date(m.lastMessageAt).toISOString()}>
                      {formatDate(m.lastMessageAt, locale)}
                    </time>
                  }
                  trailing={
                    <>
                      <DashboardPill
                        variant="error"
                        aria-label={t("unreadAria", { count: m.unreadCount })}
                      >
                        {m.unreadCount}
                      </DashboardPill>
                      <DashboardRowAction href="/messages">{t("read")}</DashboardRowAction>
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
