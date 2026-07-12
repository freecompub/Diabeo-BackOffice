"use client"

/**
 * US-2664 — Composant UNIFIÉ de liste de propositions d'ajustement, **audience-aware**.
 *
 * Un seul rendu partagé entre les 3 surfaces (médecin / infirmière / patient), décliné par `audience` :
 *
 *  - **`clinician`** (médecin, infirmière) : rendu riche existant (transition de valeur, badges provenance /
 *    risque hypo / dose élevée, blocage `baselineMoved`). Si `canDecide` (DOCTOR) : boutons Accepter / Rejeter.
 *    Voit **toutes** les provenances.
 *  - **`patient`** : rendu **sécurisé** (validé medical, frontière MDR). AUCUN badge de decision-support
 *    clinicien (dose élevée / risque / baselineMoved / %), ton **non-prescriptif** (« votre demande »), et un
 *    **bandeau non-dismissible « ne modifiez pas vos doses »**. Le patient ne reçoit QUE ses propres demandes
 *    (`source=patient`, filtre imposé SERVEUR — cf. `adjustmentService.list({ sources })`).
 *
 * Purement présentational : ne fetch rien, ne construit aucune URL porteuse d'id. L'action de décision est
 * INJECTÉE (`onDecide`) — le composant n'appelle jamais l'API lui-même.
 */
import { useTranslations, useLocale } from "next-intl"
import type { AdjustableParameter, ProposalSource } from "@prisma/client"
import { deriveRiskDirection } from "@/lib/insulin/risk-direction"
import { bcp47 } from "@/i18n/config"
import { PROPOSAL_MAJOR_CHANGE_PCT } from "@/lib/review-constants"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

/** Item minimal consommé par la liste. `ReviewProposalItem` (revue médecin) en est un sur-ensemble. */
export type ProposalViewItem = {
  id: string
  parameterType: AdjustableParameter
  source: ProposalSource
  currentValue: number
  /** Valeur courante LIVE (revue médecin). `null` = créneau introuvable. Ignoré en audience `patient`. */
  liveCurrentValue: number | null
  proposedValue: number
  changePercent: number
  /** Basale STYLO (daily/morning/evening) ⇒ U totales, pas U/h. */
  basalDoseKind: string | null
  /** US-2662 — dose stylo > seuil d'avertissement. Clinicien uniquement. */
  highDoseWarning: boolean
}

/** parameterType → clé i18n `review.param<X>` (libellés cliniques neutres, valables pour les 2 audiences). */
const PARAM_LABEL_KEY: Record<AdjustableParameter, string> = {
  basalRate: "paramBasalRate",
  insulinSensitivityFactor: "paramInsulinSensitivityFactor",
  insulinToCarbRatio: "paramInsulinToCarbRatio",
  fixedDose: "paramFixedDose",
}
const PARAM_UNIT_KEY: Record<AdjustableParameter, "isfGl" | "icr" | "basal" | "u"> = {
  insulinSensitivityFactor: "isfGl",
  insulinToCarbRatio: "icr",
  basalRate: "basal",
  fixedDose: "u",
}
/** Unité d'une proposition : basale STYLO (`basalDoseKind` non-null) = U totales, pas U/h. */
const unitKey = (p: ProposalViewItem) =>
  p.parameterType === "basalRate" && p.basalDoseKind != null ? "u" : PARAM_UNIT_KEY[p.parameterType]

export function ProposalList({
  items,
  audience,
  canDecide = false,
  busyId = null,
  onDecide,
}: {
  items: ProposalViewItem[]
  audience: "clinician" | "patient"
  /** Clinicien uniquement — active Accepter/Rejeter (DOCTOR). Ignoré en audience `patient`. */
  canDecide?: boolean
  busyId?: string | null
  onDecide?: (id: string, action: "accept" | "reject") => void
}) {
  const t = useTranslations("review")
  const tUnits = useTranslations("insulinUnits")
  const tAdj = useTranslations("adjustments")
  const tPatient = useTranslations("patientInsulin")
  const locale = useLocale()
  const fmt = (n: number) => n.toLocaleString(bcp47(locale), { maximumFractionDigits: 2 })

  if (items.length === 0) return null

  // ─────────────────────────────── AUDIENCE PATIENT (rendu sécurisé) ───────────────────────────────
  if (audience === "patient") {
    return (
      <div className="space-y-2">
        {/* Garde-fou medical NON négociable : bandeau non-dismissible, ton non-prescriptif. */}
        <p role="status" className="rounded-md border border-feedback-warning bg-warning-bg px-3 py-2 text-sm font-medium text-warning-fg">
          {tPatient("proposalsBanner")}
        </p>
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{t(PARAM_LABEL_KEY[p.parameterType])}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {tPatient("proposalYourRequest", { from: fmt(p.currentValue), to: fmt(p.proposedValue) })} {tUnits(unitKey(p))}
                </span>
              </span>
              {/* Ni badge clinicien, ni action : lecture stricte, sans decision-support. */}
              <Badge variant="outline" className="text-muted-foreground">{tPatient("proposalPendingChip")}</Badge>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // ─────────────────────────────── AUDIENCE CLINICIEN (rendu riche existant) ───────────────────────────────
  return (
    <ul className="space-y-2">
      {items.map((p) => {
        // US-2649b — base LIVE vs snapshot. « changed »/« unavailable » → la valeur ABSOLUE proposée ne
        // s'applique plus sur la bonne base : on BLOQUE l'acceptation + on masque les badges %/risque périmés.
        const changed = p.liveCurrentValue !== null && p.liveCurrentValue !== p.currentValue
        const unavailable = p.liveCurrentValue === null
        const blocked = changed || unavailable
        return (
          <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{t(PARAM_LABEL_KEY[p.parameterType])}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("valueTransition", { from: fmt(p.currentValue), to: fmt(p.proposedValue) })} {tUnits(unitKey(p))}
              </span>
              {changed && (
                <span role="alert" className="text-xs font-medium tabular-nums text-destructive">
                  {t("liveValueChanged", { live: fmt(p.liveCurrentValue as number) })} {tUnits(unitKey(p))}
                </span>
              )}
              {unavailable && (
                <span role="alert" className="text-xs font-medium text-destructive">
                  {t("liveValueUnavailable")}
                </span>
              )}
            </span>
            {!blocked && (
              <Badge variant={Math.abs(p.changePercent) >= PROPOSAL_MAJOR_CHANGE_PCT ? "destructive" : "secondary"}>
                {p.changePercent > 0 ? `+${Math.round(p.changePercent)}` : Math.round(p.changePercent)}&nbsp;%
              </Badge>
            )}
            <Badge variant={p.source === "patient" ? "default" : "outline"}>{tAdj(`source.${p.source}`)}</Badge>
            {p.highDoseWarning && (
              <Badge variant="outline" className="border-feedback-warning text-feedback-warning">
                {t("proposalHighDose")}
              </Badge>
            )}
            {!blocked &&
              (() => {
                const risk = deriveRiskDirection(p.parameterType, p.currentValue, p.proposedValue)
                return risk === "none" ? null : (
                  <Badge variant="outline" className={risk === "hypo" ? "border-feedback-warning text-feedback-warning" : "text-muted-foreground"}>
                    {tAdj(`risk.${risk}`)}
                  </Badge>
                )
              })()}
            {canDecide && onDecide && (
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyId === p.id || blocked}
                  title={blocked ? t("acceptBlockedHint") : undefined}
                  onClick={() => onDecide(p.id, "accept")}
                >
                  {t("accept")}
                </Button>
                <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => onDecide(p.id, "reject")}>
                  {t("reject")}
                </Button>
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
