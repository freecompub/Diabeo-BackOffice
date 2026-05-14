/**
 * US-2409 — Relances en attente (infirmier).
 * Heuristique fallback (silentMonitoring + appointmentUnconfirmed).
 * Polling 120s.
 *
 * Actions : `tel:` + `sms:` URI natif. ⚠️ Twilio SMS server-side
 * deferred — pas de `PatientRecallLog` audit dans ce PR (V2).
 */

"use client"

import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { Badge } from "@/components/ui/badge"
import { Phone, MessageSquare } from "lucide-react"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { RecallItem } from "@/lib/services/nurse-dashboard.service"

type ApiResponse = { items: RecallItem[] }

const REASON_META: Record<RecallItem["reason"], { label: string; variant: "destructive" | "outline" }> = {
  silentMonitoring: { label: "Silence saisie", variant: "outline" },
  appointmentUnconfirmed: { label: "RDV non confirmé", variant: "destructive" },
}

export function RecallListCard() {
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/infirmier/recall-list",
    120_000,
  )
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null
  return (
    <DiabeoCard role="region" aria-labelledby="card-recall-title">
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="card-recall-title" className="text-base font-semibold">
          Relances en attente
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
            Impossible de charger les relances.
          </p>
        )}
        {!loading && !hasError && items.length === 0 && (
          <DiabeoEmptyState
            variant="noData"
            title="Aucune relance"
            message="Portefeuille à jour."
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
                    {r.patientFirstName || "Patient"}
                    {r.pathology ? ` · ${r.pathology}` : ""}
                  </span>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  <span className="text-xs text-muted-foreground">{r.metricLabel}</span>
                  {phoneSafe && (
                    <>
                      <a
                        href={`tel:${phoneSafe}`}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted"
                        aria-label="Appeler le patient"
                      >
                        <Phone size={12} />
                        Appeler
                      </a>
                      <a
                        href={`sms:${phoneSafe}`}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted"
                        aria-label="Envoyer un SMS au patient"
                      >
                        <MessageSquare size={12} />
                        SMS
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
