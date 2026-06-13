/**
 * US-2408 — Coordination équipe (infirmier).
 * Inbox basé sur DelegationRequest (in/out). Polling 60s.
 *
 * ⚠️ Libre chat équipe deferred — exige `TeamMessage` table (V2).
 */

"use client"

import { useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner, STALE_MESSAGE_FR } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { Badge } from "@/components/ui/badge"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { TeamInboxItem } from "@/lib/services/nurse-dashboard.service"

type ApiResponse = { items: TeamInboxItem[] }

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "destructive",
  approved: "default",
  rejected: "outline",
  expired: "secondary",
}

/** Delegation status → i18n key (label translated at render). */
const STATUS_LABEL_KEY: Record<string, string> = {
  pending: "statusPending",
  approved: "statusApproved",
  rejected: "statusRejected",
  expired: "statusExpired",
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Paris",
  })
}

export function TeamInboxCard() {
  const t = useTranslations("dashboardCards.nurseTeamInbox")
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/infirmier/team-inbox",
    60_000,
  )
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null
  return (
    <DiabeoCard role="region" aria-labelledby="card-team-title">
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="card-team-title" className="text-base font-semibold">
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
            {items.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <Badge variant={STATUS_VARIANT[m.status] ?? "outline"}>
                  {STATUS_LABEL_KEY[m.status] ? t(STATUS_LABEL_KEY[m.status]) : m.status}
                </Badge>
                {/* code-review L4 (re-review) — text fallback for direction
                    glyph ; SR users hear "Entrante"/"Sortante" instead of
                    "down arrowhead" or being skipped. */}
                <span
                  className="text-xs text-muted-foreground"
                  aria-label={m.direction === "incoming" ? t("directionIncoming") : t("directionOutgoing")}
                >
                  <span aria-hidden="true">{m.direction === "incoming" ? "⇩" : "⇧"}</span>
                </span>
                <span className="flex-1 truncate text-sm">
                  {m.action} · {m.patientFirstName || t("patientFallback")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(m.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
