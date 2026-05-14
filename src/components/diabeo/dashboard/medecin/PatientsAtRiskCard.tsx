/**
 * US-2403 — Patients à suivre (médecin). Top 3 par score on-demand.
 * Polling 5min. DOCTOR-only (jugement clinique).
 */

"use client"

import Link from "next/link"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { Badge } from "@/components/ui/badge"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { PatientAtRiskItem } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: PatientAtRiskItem[] }

const REASON_LABELS: Record<string, { label: string; variant: "destructive" | "outline" | "secondary" }> = {
  recentHypos: { label: "Hypos récentes", variant: "destructive" },
  silentMonitoring: { label: "Silence saisie", variant: "outline" },
  tirDrop: { label: "TIR en baisse", variant: "secondary" },
}

export function PatientsAtRiskCard() {
  const { data, error, loading } = usePollingFetch<ApiResponse>(
    "/api/dashboard/medecin/patients-at-risk",
    5 * 60_000,
  )
  const items = data?.items ?? []
  const hasError = error !== null && data === null

  return (
    <DiabeoCard role="region" aria-labelledby="card-risk-title">
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="card-risk-title" className="text-base font-semibold">
          Patients à suivre
        </h2>
        <span className="text-xs text-muted-foreground">Top {items.length || 0}</span>
      </header>

      <div className="px-4 pb-4">
        {loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">
            Impossible de charger les patients à risque.
          </p>
        )}
        {!loading && !hasError && items.length === 0 && (
          <DiabeoEmptyState
            variant="noData"
            title="Tous stables"
            message="Aucun patient ne déclenche d'indicateur de suivi."
          />
        )}
        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((p) => {
              const meta = REASON_LABELS[p.reason] ?? { label: p.reason, variant: "outline" as const }
              return (
                <li
                  key={p.patientId}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                    {(p.patientFirstName || "?").charAt(0).toUpperCase()}
                  </span>
                  <Link
                    href={`/patients/${p.patientId}`}
                    className="flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {p.patientFirstName || "Patient"}
                    {p.pathology ? ` · ${p.pathology}` : ""}
                  </Link>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  <span className="text-xs text-muted-foreground">{p.metricLabel}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
