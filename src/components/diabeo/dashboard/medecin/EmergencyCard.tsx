/**
 * US-2401 — Urgences en cours (médecin).
 *
 * Polling 30s (ADR session Samir 2026-05-13). `role="region"` + live region
 * for screen readers when alerts arrive. Empty state = green "all stable".
 */

"use client"

import { Badge } from "@/components/ui/badge"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { UrgencyItem } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: UrgencyItem[] }

const ALERT_LABELS: Record<string, string> = {
  severe_hypo: "Hypoglycémie sévère",
  hypo: "Hypoglycémie",
  hyper: "Hyperglycémie",
  severe_hyper: "Hyperglycémie sévère",
  ketone_dka: "Cétoacidose",
  ketone_moderate: "Cétones modérées",
  manual: "Alerte manuelle",
}

const SEVERITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  info: "secondary",
  warning: "outline",
  critical: "destructive",
}

export function EmergencyCard() {
  const { data, error, loading, lastUpdatedAt } = usePollingFetch<ApiResponse>(
    "/api/dashboard/medecin/urgencies",
    30_000,
  )

  const items = data?.items ?? []
  const hasError = error !== null && data === null

  return (
    <DiabeoCard className="border-s-4 border-s-glycemia-critical" role="region" aria-labelledby="card-urgencies-title">
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="card-urgencies-title" className="text-base font-semibold text-glycemia-critical">
          Urgences en cours
        </h2>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {lastUpdatedAt ? `MAJ ${new Date(lastUpdatedAt).toLocaleTimeString("fr-FR")}` : "—"}
        </span>
      </header>

      <div className="px-4 pb-4" role="status" aria-live="polite" aria-atomic="true">
        {loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">Impossible de charger les urgences.</p>
        )}
        {!loading && !hasError && items.length === 0 && (
          <DiabeoEmptyState
            variant="noData"
            title="Aucune urgence"
            message="Patients stables sur le portefeuille."
          />
        )}
        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <Badge variant={SEVERITY_VARIANT[u.severity] ?? "default"}>
                  {ALERT_LABELS[u.alertType] ?? u.alertType}
                </Badge>
                <span className="flex-1 truncate text-sm font-medium">
                  {u.patientFirstName || "Patient"}
                  {u.pathology ? ` · ${u.pathology}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {u.glucoseValueMgdl !== null
                    ? `${u.glucoseValueMgdl} mg/dL`
                    : u.ketoneValueMmol !== null
                    ? `${u.ketoneValueMmol} mmol/L`
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
