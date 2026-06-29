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
import { DashboardCardHeader } from "@/components/diabeo/dashboard/DashboardCardHeader"
import {
  DashboardRow,
  DashboardAvatar,
  DashboardRowAction,
} from "@/components/diabeo/dashboard/DashboardRow"
import {
  DashboardPill,
  PathologyPill,
  type DashboardPillVariant,
} from "@/components/diabeo/dashboard/DashboardPill"
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

/** Clés du namespace i18n `insulinUnits` (source unique des libellés d'unités). */
type InsulinUnitKey = "isfGl" | "isfMgdl" | "isfMmol" | "icr" | "basal"

/**
 * Unité d'affichage de l'ISF selon l'unité de glycémie de l'appelant.
 * Clés du namespace `insulinUnits` (source unique partagée avec le dossier).
 */
const ISF_UNIT_KEY: Record<GlucoseUnit, InsulinUnitKey> = {
  "g/L": "isfGl",
  "mg/dL": "isfMgdl",
  "mmol/L": "isfMmol",
}

/**
 * Valeurs d'affichage + clé d'unité par proposition. L'ISF est stocké en g/L
 * et converti vers l'unité de glycémie de l'appelant (g/L/U, mg/dL/U,
 * mmol/L/U) ; basal (U/h) et ICR (g/U) sont indépendants de l'unité glycémie.
 */
function displayFor(p: PendingProposalItem): { from: number; to: number; unitKey: InsulinUnitKey } {
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
    unitKey: p.parameterType === "basalRate" ? "basal" : "icr",
  }
}

/**
 * Variante du badge selon l'ampleur de la variation. `changePercent` est
 * borné à ±20 % en amont (clamp de l'algorithme de génération, cf.
 * proposal-algorithm.ts) : `>= 20` signale donc l'ajustement maximal qu'un
 * pas de titration propose — pas une valeur arbitraire. Indice visuel pur,
 * aucune action clinique déclenchée ici.
 */
function changeVariant(percent: number): DashboardPillVariant {
  return Math.abs(percent) >= 20 ? "warning" : "accent"
}

export function PendingProposalsCard() {
  const t = useTranslations("dashboardCards.medecinProposals")
  // Libellés d'unités : source unique partagée avec le dossier patient.
  const tUnits = useTranslations("insulinUnits")
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
      <DashboardCardHeader
        titleId="card-proposals-title"
        title={t("title")}
        dot="info"
        count={items.length}
      />
      {isStale && <StaleBanner message={t("stale")} />}
      <div className="px-4 pb-4 pt-2">
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
            {items.map((p, index) => {
              const pct = Math.round(p.changePercent)
              const { from, to, unitKey } = displayFor(p)
              const name = p.patientFirstName || t("patientFallback")
              return (
                <DashboardRow
                  key={p.id}
                  leading={
                    <DashboardAvatar initials={name.charAt(0).toUpperCase()} tint="accent" />
                  }
                  title={
                    <span className="flex items-center gap-2">
                      {name}
                      <PathologyPill pathology={p.pathology} />
                    </span>
                  }
                  sub={
                    <span className="tabular-nums">
                      {t(PARAM_LABEL_KEY[p.parameterType])}
                      {" · "}
                      {t("valueTransition", { from: fmt(from), to: fmt(to) })} {tUnits(unitKey)}
                    </span>
                  }
                  trailing={
                    <>
                      <DashboardPill variant="accent">{t("deterministic")}</DashboardPill>
                      <DashboardPill
                        variant={changeVariant(pct)}
                        aria-label={t("changeAria", { percent: pct })}
                      >
                        {pct > 0 ? `+${pct}` : pct}&nbsp;%
                      </DashboardPill>
                      <DashboardRowAction
                        href={`/patients/${p.patientId}/review`}
                        variant={index === 0 ? "primary" : "default"}
                        aria-label={t("reviewAria", { name })}
                      >
                        {t("review")}
                      </DashboardRowAction>
                    </>
                  }
                />
              )
            })}
          </ul>
        )}
      </div>
    </DiabeoCard>
  )
}
