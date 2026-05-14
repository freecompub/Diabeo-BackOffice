/**
 * US-2408 — Coordination équipe (infirmier).
 * Inbox basé sur DelegationRequest (in/out). Polling 60s.
 *
 * ⚠️ Libre chat équipe deferred — exige `TeamMessage` table (V2).
 */

"use client"

import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
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

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Paris",
  })
}

export function TeamInboxCard() {
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
          Coordination équipe
        </h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </header>
      {isStale && <StaleBanner />}
      <div className="px-4 pb-4">
        {loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">
            Impossible de charger les délégations.
          </p>
        )}
        {!loading && !hasError && items.length === 0 && (
          <DiabeoEmptyState
            variant="noData"
            title="Inbox vide"
            message="Aucune délégation en cours."
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
                  {m.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {m.direction === "incoming" ? "⇩" : "⇧"}
                </span>
                <span className="flex-1 truncate text-sm">
                  {m.action} · {m.patientFirstName || "Patient"}
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
