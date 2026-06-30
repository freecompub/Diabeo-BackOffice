/**
 * US-2633 — Drapeaux d'alerte patient (présentational, partagé).
 *
 * Source unique des pastilles d'alerte « Ma journée » (urgence ouverte,
 * hypoglycémies récentes, surveillance silencieuse). Extrait de
 * `PatientContextBar` pour être réutilisé tel quel dans l'en-tête du drawer de
 * consultation (US-2633) — même rendu, mêmes seuils, mêmes libellés i18n
 * (namespace `patientContextBar`).
 *
 * Aucune donnée déchiffrée ni calcul : reçoit des `ContextFlags` déjà projetés
 * côté serveur (miroir de `getPatientFlags`).
 */

"use client"

import { useTranslations } from "next-intl"
import { AlertTriangle, Activity, ZapOff } from "lucide-react"
// Source neutre (pas `./PatientContextBar`) → pas de cycle de type.
import type { ContextFlags } from "./patient-record-views"

export function PatientAlertFlags({ flags }: { flags: ContextFlags }) {
  const t = useTranslations("patientContextBar")

  if (!flags.openUrgency && !flags.recentHypos && !flags.silentMonitoring) return null

  return (
    <>
      {flags.openUrgency && (
        <span className="inline-flex items-center gap-1 rounded-full border border-feedback-error bg-error-bg px-2 py-0.5 text-xs font-medium text-error-fg">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {t("flagUrgency")}
        </span>
      )}
      {flags.recentHypos && (
        <span className="inline-flex items-center gap-1 rounded-full border border-feedback-warning bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-fg">
          <Activity className="h-3 w-3" aria-hidden="true" />
          {t("flagHypos", { count: flags.hypoCount })}
        </span>
      )}
      {flags.silentMonitoring && (
        <span className="inline-flex items-center gap-1 rounded-full border border-feedback-warning bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-fg">
          <ZapOff className="h-3 w-3" aria-hidden="true" />
          {t("flagSilent")}
        </span>
      )}
    </>
  )
}
