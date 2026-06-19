/**
 * US-2603 — Barre de contexte patient persistante (dossier + futur mode revue).
 *
 * Affiche en permanence : retour (Ma journée), identité (nom, âge, pathologie),
 * drapeaux d'alerte (cohérents « Ma journée » — même source serveur
 * `getPatientFlags`), action rapide Message, et le switcher de patient.
 *
 * Composant client alimenté par des props sérialisables (calculées serveur dans
 * `page.tsx`). Aucune PII déchiffrée ici ; aucune statistique calculée.
 */

"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { ArrowLeft, MessageSquare, AlertTriangle, Activity, ZapOff, Stethoscope } from "lucide-react"
import { PatientSwitcher } from "./PatientSwitcher"

/** Drapeaux d'alerte sérialisables (miroir de `PatientFlags` serveur). */
export type ContextFlags = {
  recentHypos: boolean
  hypoCount: number
  silentMonitoring: boolean
  silentDays: number | null
  openUrgency: boolean
}

export function PatientContextBar({
  patientId,
  name,
  age,
  pathology,
  referent,
  flags,
  showStartConsultation = false,
  backHref = "/medecin",
  backLabelKey = "backToWorklist",
}: {
  patientId: number
  name: string
  age: number | null
  pathology: string | null
  referent: string | null
  flags: ContextFlags
  /**
   * US-2624 — affiche le lanceur « Nouvelle consultation » (→ `/patients/[id]/review`).
   * Vrai depuis le **dossier** ; faux dans la **consultation** elle-même (pas d'auto-lien).
   */
  showStartConsultation?: boolean
  /** Destination du retour (défaut « Ma journée » ; la consultation passe le dossier). */
  backHref?: string
  /** Clé i18n du libellé/aria du retour (union fermée → contrat vérifié à la compilation). */
  backLabelKey?: "backToWorklist" | "backToDossier"
}) {
  const t = useTranslations("patientContextBar")

  const subtitleParts = [
    pathology ?? "—",
    age !== null ? t("ageValue", { age }) : "—",
    t("referentValue", { referent: referent ?? "—" }),
  ]

  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b border-border bg-card px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href={backHref}
          aria-label={t(backLabelKey)}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-foreground">{name}</h1>
            {/* Drapeaux d'alerte — cohérents avec « Ma journée ». */}
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
          </div>
          <p className="truncate text-sm text-muted-foreground">{subtitleParts.join(" · ")}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <PatientSwitcher currentPatientId={patientId} />
        <Link
          href={`/messages?patientId=${patientId}`}
          aria-label={t("message")}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t("message")}</span>
        </Link>
        {/* US-2624 — lanceur de consultation (dossier → mode revue). */}
        {showStartConsultation && (
          <Link
            href={`/patients/${patientId}/review`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Stethoscope className="h-4 w-4" aria-hidden="true" />
            <span>{t("startConsultation")}</span>
          </Link>
        )}
      </div>
    </header>
  )
}
