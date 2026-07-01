"use client"

/**
 * US-2635 — Onglet **AGP** (Ambulatory Glucose Profile) de la fiche patient.
 *
 * Rend le profil percentile 24 h (`AgpPercentileChart`, médiane + bandes
 * P10–P90 / P25–P75) + un bandeau de stats glucométriques (Moyenne · GMI · CV ·
 * Écart type · Données capturées). Piloté par la **période** du contexte
 * (`usePeriodResource`, lazy — aucune donnée dans le payload tant que l'onglet
 * n'est pas ouvert). Aucun calcul clinique ici : projections serveur.
 *
 * Garde-fous (US-2631/2635) :
 *  - Bande cible **pathology-aware** : `targetLow/HighMgdl` viennent des objectifs
 *    patient (GD 63–140 vs 70–180), jamais de constante en dur.
 *  - Suffisance : slots pauvres (< `MIN_SLOT_READINGS`) → bande P10–P90 masquée ;
 *    fenêtre 7 j « indicatif » ; capture < 70 % signalée ; 90 j → note d'inertie.
 *  - GMI libellé « GMI (indicateur de gestion du glucose) » + infobulle
 *    « ≠ HbA1c labo » ; jamais « HbA1c estimée ».
 */

import { useTranslations } from "next-intl"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { AgpPercentileChart } from "@/components/diabeo/AgpPercentileChart"
import { type AgpSlot } from "@/lib/statistics"
import { AGP_SUFFICIENCY } from "@/lib/clinical-bounds"
import {
  usePeriodResource,
  usePatientRecordContext,
  PERIOD_LABEL_KEY,
  SEED_PERIOD,
  type RecordPeriod,
} from "./PatientRecordContext"
import { PeriodSelector } from "./PeriodSelector"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface AgpStats {
  avgMgdl: number
  gmi: number
  cv: number
  sdMgdl: number
  captureRate: number
  insufficientCapture: boolean
  /** 0 = aucune donnée CGM sur la fenêtre → bandeau masqué (pas de « 0 mg/dL »). */
  readingCount: number
}

/** Bandeau stats depuis `/api/analytics/glycemic-profile` (projection serveur). */
function mapAgpStats(raw: unknown): AgpStats {
  const p = raw as {
    captureRate: number
    warning?: string
    readingCount: number
    metrics: {
      averageGlucoseMgdl: number
      gmi: number
      coefficientOfVariation: number
      stdDevMgdl: number
    }
  }
  return {
    avgMgdl: p.metrics.averageGlucoseMgdl,
    gmi: p.metrics.gmi,
    cv: p.metrics.coefficientOfVariation,
    sdMgdl: p.metrics.stdDevMgdl,
    captureRate: p.captureRate,
    insufficientCapture: p.warning === "insufficientCgmCapture",
    readingCount: p.readingCount ?? 0,
  }
}

/**
 * Suffisance par slot (US-2631) : un slot de 15 min agrégeant moins de
 * `minReadings` relevés voit sa **bande P10–P90 masquée** (percentiles extrêmes
 * non représentatifs) — on rabat p10→p25 et p90→p75 (bande extérieure de largeur
 * nulle) sans toucher médiane ni P25–P75. Fonction pure (testable).
 */
export function maskSparseAgpSlots(slots: AgpSlot[], minReadings: number): AgpSlot[] {
  return slots.map((s) =>
    s.count < minReadings ? { ...s, p10: s.p25, p90: s.p75 } : s,
  )
}

export function PatientAgpTab({
  targetLowMgdl,
  targetHighMgdl,
}: {
  targetLowMgdl: number
  targetHighMgdl: number
}) {
  const t = useTranslations("patientDetail")
  const agp = usePeriodResource<AgpSlot[]>({
    endpoint: "/api/analytics/agp",
    map: (raw) => raw as AgpSlot[],
  })
  const stats = usePeriodResource<AgpStats>({
    endpoint: "/api/analytics/glycemic-profile",
    map: mapAgpStats,
  })

  const recordCtx = usePatientRecordContext()

  // Période RÉELLEMENT représentée par les données affichées (cohérence
  // donnée/étiquette) — l'AGP est l'agrégat central de l'onglet.
  const shownPeriod: RecordPeriod | null = agp.valuePeriod ?? stats.valuePeriod
  const shownLabel = shownPeriod ? t(PERIOD_LABEL_KEY[shownPeriod]) : ""
  const requestedLabel = t(PERIOD_LABEL_KEY[recordCtx?.period ?? SEED_PERIOD])
  // Échec d'un re-fetch alors qu'une donnée est déjà affichée (elle reste
  // l'ancienne fenêtre) → on le signale, jamais silencieusement (revue #611).
  const refetchError = (agp.error || stats.error) && !!agp.data

  // Sélecteur de période — synchronisé avec les autres onglets via le contexte.
  const selector = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span id="agp-period-label" className="text-sm font-medium text-muted-foreground">
        {t("periodSelectorLabel")}
      </span>
      <PeriodSelector labelledBy="agp-period-label" />
    </div>
  )

  if (agp.loading && !agp.data) {
    return (
      <div className="space-y-4">
        {selector}
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          {t("agpLoading")}
        </p>
      </div>
    )
  }
  if (!agp.data) {
    return (
      <div className="space-y-4">
        {selector}
        <p role="alert" className="rounded-md border border-feedback-error bg-error-bg px-4 py-3 text-sm text-error-fg">
          {t("agpError")}
        </p>
      </div>
    )
  }

  const slots = maskSparseAgpSlots(agp.data, AGP_SUFFICIENCY.MIN_SLOT_READINGS)

  return (
    <div className="space-y-4">
      {selector}
      {/* Échec de re-fetch : la donnée affichée reste la fenêtre précédente
          (`shownLabel`) — on l'annonce, jamais un libellé trompeur. */}
      {refetchError && (
        <p role="alert" className="rounded-md border border-feedback-error bg-error-bg px-4 py-2 text-sm text-error-fg">
          {t("periodRefetchError", { requested: requestedLabel, shown: shownLabel })}
        </p>
      )}
      {/* Notes de suffisance / inertie (US-2631/2635). */}
      {shownPeriod === "7d" && (
        <p role="status" className="rounded-md border border-feedback-warning bg-warning-bg px-4 py-2 text-sm text-warning-fg">
          {t("agp7dNote")}
        </p>
      )}
      {shownPeriod === "90d" && (
        <p role="status" className="rounded-md border border-feedback-info/25 bg-feedback-info-bg px-4 py-2 text-sm text-feedback-info-fg">
          {t("agp90dNote")}
        </p>
      )}
      {stats.data?.insufficientCapture && (
        <p role="status" className="rounded-md border border-feedback-warning bg-warning-bg px-4 py-2 text-sm text-warning-fg">
          {t("lowCaptureWarning", { rate: Math.round(stats.data.captureRate) })}
        </p>
      )}

      {/* Bandeau stats glucométriques — masqué si aucune donnée CGM sur la
          fenêtre (pas de « 0 mg/dL / GMI 0 % » trompeur). */}
      {stats.data && stats.data.readingCount > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <AgpStat label={t("agpStatAvg")} value={`${stats.data.avgMgdl} mg/dL`} />
          <AgpStat
            label={t("agpStatGmi")}
            value={`${stats.data.gmi}%`}
            tooltip={t("agpGmiTooltip")}
          />
          <AgpStat label={t("agpStatCv")} value={`${stats.data.cv}%`} />
          <AgpStat label={t("agpStatSd")} value={`${stats.data.sdMgdl} mg/dL`} />
          <AgpStat label={t("agpStatCapture")} value={`${Math.round(stats.data.captureRate)}%`} />
        </dl>
      )}

      {/* Profil percentile 24 h — bande cible pathology-aware. `aria-busy` +
          opacité pendant un re-fetch (cohérent « Vue d'ensemble », WCAG 4.1.3). */}
      <div
        aria-busy={agp.loading}
        className={cn("transition-opacity", agp.loading && "opacity-60")}
      >
        <AgpPercentileChart
          slots={slots}
          targetLowMgdl={targetLowMgdl}
          targetHighMgdl={targetHighMgdl}
        />
      </div>
    </div>
  )
}

/** Une statistique du bandeau ; `tooltip` optionnel (infobulle info-icône). */
function AgpStat({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {tooltip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                // Élément interactif → rôle explicite `button` (WCAG 4.1.2), pas
                // un span générique focusable.
                render={<button type="button" />}
                aria-label={tooltip}
                className="cursor-help text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-xs text-xs">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
