/**
 * US-2407 — To-do du jour (infirmier, READ-ONLY).
 * Polling 60s. Affiche jusqu'à 20 items triés par score.
 * Pas de checkbox completion dans ce PR (defer V2).
 */

"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner, STALE_MESSAGE_FR } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { Badge } from "@/components/ui/badge"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { TodoItem } from "@/lib/services/nurse-dashboard.service"

type ApiResponse = { items: TodoItem[] }

/** Todo kind → i18n key + badge variant (label translated at render). */
const KIND_BADGE: Record<TodoItem["kind"], { labelKey: string; variant: "destructive" | "outline" | "secondary" }> = {
  prepareAppointment: { labelKey: "kindPrepareAppointment", variant: "destructive" },
  validateEvent: { labelKey: "kindValidateEvent", variant: "outline" },
  observeProposal: { labelKey: "kindObserveProposal", variant: "secondary" },
}

export function TodoListCard() {
  const t = useTranslations("dashboardCards.nurseTodo")
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/infirmier/todo",
    60_000,
  )
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null
  return (
    <DiabeoCard role="region" aria-labelledby="card-todo-title">
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="card-todo-title" className="text-base font-semibold">
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
            {items.map((item) => {
              const meta = KIND_BADGE[item.kind]
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <Badge variant={meta.variant}>{t(meta.labelKey)}</Badge>
                  <Link
                    href={`/patients/${item.patientId}`}
                    className="flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {item.patientFirstName || t("patientFallback")}
                    {item.pathology ? ` · ${item.pathology}` : ""}
                  </Link>
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  {item.dueLabel && (
                    <span className="text-xs text-muted-foreground">{item.dueLabel}</span>
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
