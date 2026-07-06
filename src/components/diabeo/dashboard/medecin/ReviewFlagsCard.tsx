/**
 * US-2651 (mode c) — Flags d'orientation clinique OUVERTS (médecin, « Ma journée »).
 *
 * Liste read-only, déterministe : `ClinicalReviewFlag` produits côté backend (ex. tentative
 * d'un patient NON INSULINÉ). Objet d'ORIENTATION distinct d'`AdjustmentProposal` : n'affiche
 * **JAMAIS** de posologie (frontière dispositif médical). Renvoie vers la fiche patient pour
 * revue en consultation. Polling 60 s.
 */

"use client"

import { useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { DashboardCardHeader } from "@/components/diabeo/dashboard/DashboardCardHeader"
import { DashboardRow, DashboardAvatar, DashboardRowAction } from "@/components/diabeo/dashboard/DashboardRow"
import { PathologyPill } from "@/components/diabeo/dashboard/DashboardPill"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { ReviewFlagItem } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: ReviewFlagItem[] }

/** type de flag → clé i18n (namespace `reviewFlags`). Aucun libellé n'implique de dose. */
const FLAG_TYPE_KEY: Record<ReviewFlagItem["type"], string> = {
  reviewInConsultation: "flagReviewInConsultation",
  hba1cStale: "flagHba1cStale",
  tirBelowTarget: "flagTirBelowTarget",
  observance: "flagObservance",
}

export function ReviewFlagsCard() {
  const t = useTranslations("reviewFlags")
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/medecin/review-flags",
    60_000,
  )
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null

  return (
    <DiabeoCard role="region" aria-labelledby="card-review-flags-title">
      <DashboardCardHeader
        titleId="card-review-flags-title"
        title={t("title")}
        dot="warning"
        count={items.length}
      />
      {isStale && <StaleBanner message={t("stale")} />}
      <div className="px-4 pb-4 pt-2">
        {loading && items.length === 0 && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
        {hasError && <p className="text-sm text-glycemia-critical">{t("loadError")}</p>}
        {!loading && !hasError && items.length === 0 && (
          <DiabeoEmptyState variant="noData" title={t("emptyTitle")} message={t("emptyMessage")} />
        )}
        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((f, index) => {
              const name = f.patientFirstName || t("patientFallback")
              return (
                <DashboardRow
                  key={f.id}
                  leading={<DashboardAvatar initials={name.charAt(0).toUpperCase()} tint="warning" />}
                  title={
                    <span className="flex items-center gap-2">
                      {name}
                      <PathologyPill pathology={f.pathology} />
                    </span>
                  }
                  sub={<span>{t(FLAG_TYPE_KEY[f.type])}</span>}
                  trailing={
                    <DashboardRowAction
                      href={`/patients/${f.patientId}/review`}
                      variant={index === 0 ? "primary" : "default"}
                      aria-label={t("reviewAria", { name })}
                    >
                      {t("review")}
                    </DashboardRowAction>
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
