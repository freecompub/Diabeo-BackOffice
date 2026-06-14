/**
 * US-2602 (Ma journée) — Propositions d'ajustement en attente (médecin).
 *
 * Liste read-only, déterministe : les `AdjustmentProposal` sont produites
 * côté backend (jamais auto-appliquées, jamais générées par le frontend).
 * La revue accepter/rejeter se fait sur l'écran dédié — cette carte ne fait
 * que signaler ce qui est en attente. Polling 60s.
 */

"use client"

import { useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner, STALE_MESSAGE_FR } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { Badge } from "@/components/ui/badge"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { PendingProposalItem } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: PendingProposalItem[] }

/** parameterType → clé i18n du libellé (règle acronyme « Libellé (ACRONYME) »). */
const PARAM_LABEL_KEY: Record<PendingProposalItem["parameterType"], string> = {
  basalRate: "paramBasalRate",
  insulinSensitivityFactor: "paramInsulinSensitivityFactor",
  insulinToCarbRatio: "paramInsulinToCarbRatio",
}

/** Variante du badge selon l'ampleur de la variation (déterministe, |%|). */
function changeVariant(percent: number): "destructive" | "secondary" {
  return Math.abs(percent) >= 20 ? "destructive" : "secondary"
}

export function PendingProposalsCard() {
  const t = useTranslations("dashboardCards.medecinProposals")
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/medecin/pending-proposals",
    60_000,
  )
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null
  return (
    <DiabeoCard role="region" aria-labelledby="card-proposals-title">
      <header className="flex items-center justify-between px-4 pt-4">
        <h2 id="card-proposals-title" className="text-base font-semibold">
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
            {items.map((p) => {
              const pct = Math.round(p.changePercent)
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                    {(p.patientFirstName || "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="flex flex-1 flex-col truncate">
                    <span className="truncate text-sm font-medium">
                      {p.patientFirstName || t("patientFallback")}
                      {p.pathology ? ` · ${p.pathology}` : ""}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {t(PARAM_LABEL_KEY[p.parameterType])}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-foreground">
                    {t("valueTransition", { from: p.currentValue, to: p.proposedValue })}
                  </span>
                  <Badge
                    variant={changeVariant(p.changePercent)}
                    aria-label={t("changeAria", { percent: pct })}
                  >
                    {pct > 0 ? `+${pct}` : pct}&nbsp;%
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
