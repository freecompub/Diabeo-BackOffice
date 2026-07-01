"use client"

/**
 * US-2638 (slice B) — Vue d'ensemble **glycémie capillaire (BGM)**.
 *
 * Rendue à la place des KPI CGM quand `dataSource === "bgm"` (fail-closed : jamais
 * de TIR-temps/GMI/AGP, trompeurs en capillaire). Substitutions + garde-fous de
 * libellé (revue #614) :
 *  - **Moyenne des relevés (capillaire)** — jamais présentée comme un eA1c.
 *  - **% de relevés en cible** — explicitement distinct du TIR-temps + caveat
 *    biais d'échantillonnage (relevés non répartis uniformément).
 *  - **HbA1c (laboratoire)** datée + « ancienne » (> 180 j) — jamais un GMI.
 *  - **Fréquence** = relevés/jour sur la fenêtre (≠ taux de capture CGM).
 *
 * KPI pilotés par la période (US-2634) via `/api/analytics/bgm-stats` ; l'HbA1c
 * labo (valeur unique, non fenêtrée) vient de l'amorce serveur.
 */

import { useLocale, useTranslations } from "next-intl"
import { Activity, Droplet, Target, TestTube } from "lucide-react"
import { cn } from "@/lib/utils"
import { bcp47 } from "@/i18n/config"
import { StatCard } from "@/components/diabeo"
import { usePeriodAnalytics, PERIOD_LABEL_KEY } from "./PatientRecordContext"
import type { PatientRecordData } from "./PatientRecord"

type Bgm = NonNullable<PatientRecordData["bgm"]>
// Sous-ensemble fenêtré par la période (le nuage `points` est rendu par l'onglet
// Glycémie depuis l'amorce, pas ici — on ne le re-fetch donc pas).
type BgmPeriodView = Pick<Bgm, "avgMgdl" | "inRangePercent" | "readingsPerDay" | "targetRangeMgdl">

export function PatientBgmOverview({ bgm }: { bgm: Bgm }) {
  const t = useTranslations("patientDetail")
  const locale = useLocale()

  const live = usePeriodAnalytics<BgmPeriodView>({
    seed: {
      avgMgdl: bgm.avgMgdl,
      inRangePercent: bgm.inRangePercent,
      readingsPerDay: bgm.readingsPerDay,
      targetRangeMgdl: bgm.targetRangeMgdl,
    },
    endpoint: "/api/analytics/bgm-stats",
    map: (raw) => {
      const r = raw as Partial<BgmPeriodView>
      return {
        avgMgdl: r.avgMgdl ?? null,
        inRangePercent: r.inRangePercent ?? null,
        readingsPerDay: r.readingsPerDay ?? 0,
        targetRangeMgdl: r.targetRangeMgdl ?? bgm.targetRangeMgdl,
      }
    },
  })
  const periodLabel = t(PERIOD_LABEL_KEY[live.valuePeriod])
  const v = live.value
  const hba1c = bgm.hba1c

  return (
    <div className="space-y-4">
      {/* Bandeau : la fiche est en mode capillaire (pas d'indicateur CGM). */}
      <p role="status" className="rounded-md border border-feedback-info/25 bg-feedback-info-bg px-4 py-2 text-sm text-feedback-info-fg">
        {t("bgmModeBanner")}
      </p>

      {/* Annonce lecteurs d'écran du (re)chargement des KPI (WCAG 4.1.3). */}
      <p className="sr-only" role="status" aria-live="polite">
        {live.loading ? t("periodLoading") : t("periodLoaded", { period: periodLabel })}
      </p>

      <div
        aria-busy={live.loading}
        className={cn(
          "grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-4",
          live.loading && "opacity-60",
        )}
      >
        <StatCard
          label={t("bgmAvgLabel", { period: periodLabel })}
          value={v.avgMgdl ?? "—"}
          unit={v.avgMgdl !== null ? "mg/dL" : undefined}
          icon={<Activity className="h-5 w-5" />}
          variant="default"
        />
        <StatCard
          label={t("bgmInRangeLabel", { period: periodLabel })}
          value={v.inRangePercent !== null ? `${v.inRangePercent}%` : "—"}
          icon={<Target className="h-5 w-5" />}
          variant="default"
        />
        <StatCard
          label={t("bgmFrequencyLabel", { period: periodLabel })}
          value={v.readingsPerDay}
          unit={t("bgmPerDay")}
          icon={<Droplet className="h-5 w-5" />}
          variant="default"
        />
        <StatCard
          label={t("bgmHba1cLabel")}
          value={hba1c ? `${hba1c.value}%` : "—"}
          icon={<TestTube className="h-5 w-5" />}
          variant={hba1c?.stale ? "warning" : "default"}
        />
      </div>

      {/* Caveat clinique : % de relevés en cible ≠ TIR-temps (biais). */}
      <p className="text-xs text-muted-foreground">{t("bgmInRangeCaveat")}</p>

      {/* Datation HbA1c labo (jamais un GMI CGM). */}
      {hba1c && (
        <p className={cn("text-xs", hba1c.stale ? "text-warning-fg" : "text-muted-foreground")}>
          {t("bgmHba1cDated", {
            date: new Date(hba1c.date).toLocaleDateString(bcp47(locale), {
              day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris",
            }),
          })}
          {hba1c.stale && <> · {t("bgmHba1cStale")}</>}
        </p>
      )}
    </div>
  )
}
