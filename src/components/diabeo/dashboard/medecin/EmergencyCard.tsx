/**
 * US-2401 — Alertes glycémiques / urgences en cours (médecin).
 *
 * Carte de triage en tête de « Ma journée » (mockup Home v3 §médecin) : lignes
 * riches (avatar teinté par sévérité, pathologie, valeur + TIR, pills, action
 * « Ouvrir »). Polling 30s (ADR session Samir 2026-05-13). `role="region"` +
 * live region pour annoncer l'arrivée d'alertes. Empty state = « tous stables ».
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
  type DashboardAvatarTint,
} from "@/components/diabeo/dashboard/DashboardRow"
import {
  DashboardPill,
  PathologyPill,
  type DashboardPillVariant,
} from "@/components/diabeo/dashboard/DashboardPill"
import { Acronym } from "@/components/diabeo/Acronym"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import { bcp47 } from "@/i18n/config"
import type { UrgencyItem } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: UrgencyItem[] }

// Sévérité → teinte d'avatar + variante de pill (indice visuel ; le libellé
// textuel du type d'alerte reste lu, jamais la couleur seule).
const SEVERITY_TINT: Record<string, DashboardAvatarTint> = {
  critical: "error",
  warning: "warning",
  info: "info",
}
const SEVERITY_PILL: Record<string, DashboardPillVariant> = {
  critical: "error",
  warning: "warning",
  info: "info",
}

/** En dessous de ce TIR (%), on signale « TIR bas » (ATTD : cible ≥ 70 %). */
const TIR_LOW_THRESHOLD = 50

export function EmergencyCard() {
  const t = useTranslations("dashboard.medecin")
  const locale = useLocale()
  const { data, error, loading, lastUpdatedAt, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/medecin/urgencies",
    30_000,
  )

  // code-review H5 — defensive : assume nothing about response shape.
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null

  return (
    <DiabeoCard role="region" aria-labelledby="card-urgencies-title">
      <DashboardCardHeader
        titleId="card-urgencies-title"
        title={t("urgencies.title")}
        dot="error"
        count={items.length}
        more={{ href: "/patients", label: t("urgencies.seeAll") }}
        trailing={
          /* "Last update" = horloge CLIENT (dernier poll de ce navigateur) →
             formatée dans le fuseau du lecteur, contrairement à l'heure des RDV
             (ancrée Europe/Paris). Format de nombre selon la locale active. */
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {lastUpdatedAt
              ? t("lastUpdate", {
                  time: new Date(lastUpdatedAt).toLocaleTimeString(bcp47(locale)),
                })
              : "—"}
          </span>
        }
      />
      {isStale && <StaleBanner message={t("stale")} />}

      {/* code-review M1 — live regions distinctes :
            - "polite" annonce les transitions (loading/empty/error).
            - "assertive" (count) interrompt pour les nouvelles urgences. */}
      <div className="px-4 pb-1 pt-2" role="status" aria-live="polite">
        {loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        )}
        {hasError && (
          <p className="text-sm text-glycemia-critical">{t("urgencies.error")}</p>
        )}
        {!loading && !hasError && items.length === 0 && (
          <DiabeoEmptyState
            variant="noData"
            title={t("urgencies.emptyTitle")}
            message={t("urgencies.emptyMessage")}
          />
        )}
      </div>
      <div className="px-4 pb-4">
        <p className="sr-only" role="alert" aria-live="assertive">
          {items.length > 0 ? t("urgencies.countAnnounce", { count: items.length }) : ""}
        </p>
        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((u, index) => {
              const name = u.patientFirstName || t("patientFallback")
              const valueText =
                u.glucoseValueMgdl !== null
                  ? `${u.glucoseValueMgdl} mg/dL`
                  : u.ketoneValueMmol !== null
                  ? `${u.ketoneValueMmol} mmol/L`
                  : null
              const tirLow = u.tirPercent !== null && u.tirPercent < TIR_LOW_THRESHOLD
              const alertLabel = t.has(`urgencies.alert.${u.alertType}`)
                ? t(`urgencies.alert.${u.alertType}`)
                : u.alertType
              return (
                <DashboardRow
                  key={u.id}
                  leading={
                    <DashboardAvatar
                      initials={name.charAt(0).toUpperCase()}
                      tint={SEVERITY_TINT[u.severity] ?? "neutral"}
                    />
                  }
                  title={
                    <span className="flex items-center gap-2">
                      {name}
                      <PathologyPill pathology={u.pathology} />
                    </span>
                  }
                  sub={
                    valueText || u.tirPercent !== null ? (
                      <span>
                        {valueText}
                        {u.tirPercent !== null && (
                          <>
                            {valueText ? " · " : ""}
                            <Acronym code="TIR" className="cursor-help" /> {u.tirPercent} %
                          </>
                        )}
                      </span>
                    ) : undefined
                  }
                  trailing={
                    <>
                      <DashboardPill variant={SEVERITY_PILL[u.severity] ?? "info"}>
                        {alertLabel}
                      </DashboardPill>
                      {tirLow && (
                        <DashboardPill variant="warning">
                          <Acronym
                            code="TIR"
                            className="cursor-help no-underline decoration-transparent"
                          />{" "}
                          {t("urgencies.tirLow")}
                        </DashboardPill>
                      )}
                      <DashboardRowAction
                        href={`/patients/${u.patientId}`}
                        variant={index === 0 ? "primary" : "default"}
                        aria-label={t("urgencies.openAria", { name })}
                      >
                        {t("urgencies.open")}
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
