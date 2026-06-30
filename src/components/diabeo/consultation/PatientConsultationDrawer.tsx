"use client"

/**
 * US-2018b / US-2633 — Drawer de consultation patient (workspace éphémère).
 *
 * Panneau latéral (extensible plein écran) ouvert par-dessus la liste.
 * `role="dialog"` + `aria-modal` ; le reste de l'app est rendu `inert` par le
 * `ConsultationProvider`, ce qui piège naturellement le focus clavier dans le
 * drawer (pas de trap manuel à maintenir).
 *
 * US-2633 — le contenu est désormais le **composant unifié** `<PatientRecord>`
 * (même rendu que la page `/patients/[id]`), alimenté par `GET
 * /api/patients/record` via le jeton éphémère `cTok` (en-tête
 * `x-consultation-token`, aucun id patient en URL). L'onglet « Profil
 * glycémique » est injecté (câblé `cTok`) en attendant l'AGP unifié (US-2634).
 * Les drapeaux d'alerte (« Ma journée ») sont remontés dans l'en-tête du drawer.
 */

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { Maximize2, Minimize2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { PatientRecord, type PatientRecordData } from "@/components/diabeo/patient/PatientRecord"
import { PatientAlertFlags } from "@/components/diabeo/patient/PatientAlertFlags"
import type { ConsultationPatient } from "./ConsultationContext"
import { useConsultationData } from "./useConsultationData"
import { GlycemicProfileTab } from "./tabs/GlycemicProfileTab"
import { TabError, TabLoading } from "./tabs/TabState"

interface Props {
  patient: ConsultationPatient
  cTok: string
  expanded: boolean
  onClose: () => void
  onToggleExpanded: () => void
}

export function PatientConsultationDrawer({
  patient,
  cTok,
  expanded,
  onClose,
  onToggleExpanded,
}: Props) {
  const t = useTranslations("consultation")
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Récupération du dossier unifié via le jeton éphémère (aucun id en URL).
  const { data, loading, error } = useConsultationData<PatientRecordData>("/api/patients/record", cTok)

  // Déplace le focus dans le drawer à l'ouverture (WCAG — gestion du focus).
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const ageLabel = patient.age !== null ? `${patient.age} ${t("yearsShort")}` : null
  const subtitle = [`${t(`pathology.${patient.pathology}`)}`, ageLabel].filter(Boolean).join(" · ")

  return (
    <>
      {/* Scrim — clic en dehors = fermeture ; assombrit la sidebar/le contenu. */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="consultation-title"
        className={cn(
          "fixed inset-y-0 end-0 z-50 flex flex-col border-s border-border bg-card shadow-2xl",
          "transition-[width] duration-200",
          expanded ? "w-full" : "w-full sm:w-[88%] lg:w-[76%]",
        )}
      >
        {/* Bandeau éphémère — texte coral-700 (couleur « alerte » du DS) pour un
            contraste AA sur le fond ambré pâle (l'ambre #F59E0B en texte ne
            passait pas, ~2:1 ; review a11y). L'accent ambré reste sur la pastille.
            `text-coral-700` est mappé via `@theme inline` dans `globals.css`
            (--color-coral-700 → --diabeo-secondary-700). */}
        <p className="flex items-center gap-2 border-b border-glycemia-high/30 bg-glycemia-high/10 px-4 py-1.5 text-xs font-medium text-coral-700">
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-glycemia-high"
            aria-hidden="true"
          />
          {t("ephemeralNotice")}
        </p>

        {/* En-tête patient */}
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-semibold text-teal-700"
          >
            {patient.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{t("breadcrumbRoot")}</p>
            <div className="flex items-center gap-2">
              <h2
                id="consultation-title"
                ref={headingRef}
                tabIndex={-1}
                // Focalisé par programme à l'ouverture (gestion du focus WCAG
                // 2.4.3). Indicateur visible au focus clavier (WCAG 2.4.7) —
                // même style d'outline que les boutons du drawer.
                className="truncate rounded-sm text-base font-semibold text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
              >
                {patient.name}
              </h2>
              {/* Drapeaux d'alerte « Ma journée » — remontés ici en mode drawer
                  (source partagée avec PatientContextBar), dispo dès le fetch. */}
              {data && <PatientAlertFlags flags={data.flags} />}
            </div>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onToggleExpanded}
            className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
            aria-label={expanded ? t("collapse") : t("expand")}
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
            aria-label={t("close")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Contenu — dossier unifié (mêmes onglets que la page) + onglet profil
            glycémique injecté via cTok. Les onglets/clavier sont gérés par le
            composant (Tabs Radix). */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <TabLoading />
          ) : error || !data ? (
            <TabError />
          ) : (
            <PatientRecord
              data={data}
              variant="drawer"
              glycemicProfileSlot={{
                label: t("tabs.glycemicProfile"),
                content: <GlycemicProfileTab cTok={cTok} />,
              }}
            />
          )}
        </div>

        {/* Annonce d'ouverture pour lecteurs d'écran (WCAG 4.1.3). */}
        <p className="sr-only" role="status" aria-live="polite">
          {t("openedAnnounce", { name: patient.name })}
        </p>
      </aside>
    </>
  )
}
