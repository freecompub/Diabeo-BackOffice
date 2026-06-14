/**
 * US-2602 (Ma journée) — Propositions d'ajustement en attente (médecin).
 *
 * Liste read-only, déterministe : les `AdjustmentProposal` sont produites
 * côté backend (jamais auto-appliquées, jamais générées par le frontend).
 * La revue accepter/rejeter se fait sur l'écran dédié — cette carte ne fait
 * que signaler ce qui est en attente. Polling 60s.
 */

"use client"

import { useLocale, useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { Acronym, type AcronymCode } from "@/components/diabeo/Acronym"
import { Badge } from "@/components/ui/badge"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import { bcp47 } from "@/i18n/config"
import { convertGlucoseFromGl, type GlucoseUnit } from "@/lib/conversions"
import type { PendingProposalItem } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: PendingProposalItem[] }

/** parameterType → clé i18n du libellé (règle acronyme « Libellé (ACRONYME) »). */
const PARAM_LABEL_KEY: Record<PendingProposalItem["parameterType"], string> = {
  basalRate: "paramBasalRate",
  insulinSensitivityFactor: "paramInsulinSensitivityFactor",
  insulinToCarbRatio: "paramInsulinToCarbRatio",
}

/** Unité d'affichage de l'ISF selon l'unité de glycémie de l'appelant. */
const ISF_UNIT_KEY: Record<GlucoseUnit, string> = {
  "g/L": "unitIsfGl",
  "mg/dL": "unitIsfMgdl",
  "mmol/L": "unitIsfMmol",
}

/** Pathologies connues du glossaire (`Acronym`) — garde-fou de typage. */
const PATHOLOGY_CODES = new Set<AcronymCode>(["DT1", "DT2", "GD"])
const asPathologyCode = (p: string | null): AcronymCode | null =>
  p && PATHOLOGY_CODES.has(p as AcronymCode) ? (p as AcronymCode) : null

/**
 * Valeurs d'affichage + clé d'unité par proposition. L'ISF est stocké en g/L
 * et converti vers l'unité de glycémie de l'appelant (g/L/U, mg/dL/U,
 * mmol/L/U) ; basal (U/h) et ICR (g/U) sont indépendants de l'unité glycémie.
 */
function displayFor(p: PendingProposalItem): { from: number; to: number; unitKey: string } {
  if (p.parameterType === "insulinSensitivityFactor") {
    return {
      from: convertGlucoseFromGl(p.currentValue, p.glucoseUnit),
      to: convertGlucoseFromGl(p.proposedValue, p.glucoseUnit),
      unitKey: ISF_UNIT_KEY[p.glucoseUnit],
    }
  }
  return {
    from: p.currentValue,
    to: p.proposedValue,
    unitKey: p.parameterType === "basalRate" ? "unitBasalRate" : "unitInsulinToCarbRatio",
  }
}

/**
 * Variante du badge selon l'ampleur de la variation. `changePercent` est
 * borné à ±20 % en amont (clamp de l'algorithme de génération, cf.
 * proposal-algorithm.ts) : `>= 20` signale donc l'ajustement maximal qu'un
 * pas de titration propose — pas une valeur arbitraire. Indice visuel pur,
 * aucune action clinique déclenchée ici.
 */
function changeVariant(percent: number): "destructive" | "secondary" {
  return Math.abs(percent) >= 20 ? "destructive" : "secondary"
}

export function PendingProposalsCard() {
  const t = useTranslations("dashboardCards.medecinProposals")
  const locale = useLocale()
  // Décimales bornées (max 2) — suffisant cliniquement (incrément basal 0.05,
  // ISF 0.01, ICR 0.1) et évite d'afficher le bruit Decimal(8,4).
  const fmt = (n: number) =>
    n.toLocaleString(bcp47(locale), { maximumFractionDigits: 2 })
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
      {isStale && <StaleBanner message={t("stale")} />}
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
              const pathologyCode = asPathologyCode(p.pathology)
              const { from, to, unitKey } = displayFor(p)
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                    {(p.patientFirstName || "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {p.patientFirstName || t("patientFallback")}
                      {pathologyCode && (
                        <>
                          {" · "}
                          <Acronym code={pathologyCode} />
                        </>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {t(PARAM_LABEL_KEY[p.parameterType])}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-foreground">
                    {t("valueTransition", { from: fmt(from), to: fmt(to) })}
                    {" "}
                    {t(unitKey)}
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
