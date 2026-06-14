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
import { StaleBanner, STALE_MESSAGE_FR } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { Badge } from "@/components/ui/badge"
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
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="card-messages-title" className="text-base font-semibold">
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
                <li
                  key={m.conversationKey}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted"
                    aria-hidden="true"
                  >
                    <Mail size={14} />
                  </span>
                  <span className="flex-1 truncate text-sm">{preview}</span>
                  <Badge variant="destructive" aria-label={t("unreadAria", { count: m.unreadCount })}>
                    {m.unreadCount}
                  </Badge>
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={new Date(m.lastMessageAt).toISOString()}
                  >
                    {formatDate(m.lastMessageAt, locale)}
                  </time>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
