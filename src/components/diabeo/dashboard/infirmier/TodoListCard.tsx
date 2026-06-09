/**
 * US-2407 — To-do du jour (infirmier, READ-ONLY).
 * Polling 60s. Affiche jusqu'à 20 items triés par score.
 * Pas de checkbox completion dans ce PR (defer V2).
 */

"use client"

import Link from "next/link"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner, STALE_MESSAGE_FR } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { Badge } from "@/components/ui/badge"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { TodoItem } from "@/lib/services/nurse-dashboard.service"

type ApiResponse = { items: TodoItem[] }

const KIND_BADGE: Record<TodoItem["kind"], { label: string; variant: "destructive" | "outline" | "secondary" }> = {
  prepareAppointment: { label: "RDV", variant: "destructive" },
  validateEvent: { label: "Saisie", variant: "outline" },
  observeProposal: { label: "Proposition", variant: "secondary" },
}

export function TodoListCard() {
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
          To-do du jour
        </h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </header>
      {isStale && <StaleBanner message={STALE_MESSAGE_FR} />}
      <div className="px-4 pb-4">
        {loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">
            Impossible de charger la to-do.
          </p>
        )}
        {!loading && !hasError && items.length === 0 && (
          <DiabeoEmptyState
            variant="noData"
            title="Aucune tâche"
            message="Rien à faire sur le portefeuille aujourd'hui."
          />
        )}
        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((t) => {
              const meta = KIND_BADGE[t.kind]
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  <Link
                    href={`/patients/${t.patientId}`}
                    className="flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {t.patientFirstName || "Patient"}
                    {t.pathology ? ` · ${t.pathology}` : ""}
                  </Link>
                  <span className="text-xs text-muted-foreground">{t.label}</span>
                  {t.dueLabel && (
                    <span className="text-xs text-muted-foreground">{t.dueLabel}</span>
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
