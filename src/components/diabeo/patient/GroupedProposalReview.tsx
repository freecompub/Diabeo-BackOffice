"use client"

/**
 * US-2663 (S2) — DIFF surligné (ancien → nouveau) d'une `SlotSetProposal` PENDING (ISF/ICR), pour l'écran de
 * revue médecin (`/patients/[id]/review`, `DecisionsStep`). Referme le constat « SlotSetProposal invisible à
 * la revue » : jusqu'ici, seules les propositions PAR-VALEUR (`AdjustmentProposal`, `ProposalList`) y étaient
 * visibles — les propositions GROUPÉES (jeu de créneaux entier, ADR #23) ne l'étaient pas.
 *
 * Purement présentational : ne fetch rien, ne construit aucune URL porteuse d'id ; le diff (`rows`,
 * `baselineDrifted`, `structuralChange`) est PRÉ-CALCULÉ serveur (`page.tsx`, via `src/lib/insulin/slot-diff.ts`
 * + `isBaselineUnchanged`). L'action de décision est INJECTÉE (`onDecide`) — même contrat que `ProposalList`
 * (US-2664).
 *
 * Chaque ligne du tableau est un créneau PROPOSÉ, annoté de sa valeur LIVE appariée par `startHour`. Les lignes
 * `changed` (valeur/borne différente, ou créneau nouveau) sont surlignées (`bg-warning-bg`) avec un indicateur
 * visuel (icône) et un `aria-label` sur la ligne pour les lecteurs d'écran.
 *
 * `baselineDrifted` (la base active a dérivé depuis le snapshot pris à la génération, cf.
 * `isBaselineUnchanged`) affiche un bandeau `role="alert"` — AVERTISSEMENT à l'affichage uniquement : le
 * blocage réel est côté serveur (`assertBaselineUnchanged`, 409 `baselineMoved`/`baselineMissing` à
 * l'acceptation, cf. `PATCH /api/slot-set-proposals/:id/accept`). Ce bandeau prévient le médecin AVANT qu'il
 * ne tente d'accepter une proposition qui sera de toute façon rejetée par le serveur.
 *
 * US-2663 (S3b-0b) — RATIONALE MOTEUR + indice de COEXISTENCE :
 *  - Chaque créneau CHANGÉ (non supprimé) d'un item `source: "algorithm"` est annoté de sa rationale
 *    (motif `AdjustmentReason`, confiance, volume d'observations — colonne « Motif ») et de la DIRECTION DE
 *    RISQUE (`deriveRiskDirection`, côte à côte avec le motif). Une proposition HUMAINE (`source ≠ algorithm`)
 *    n'a jamais de rationale (`item.rationale === null`) ; seule la direction de risque peut y être affichée.
 *  - `coexistsWith` (non-null) affiche un bandeau `role="status"` : une autre proposition `pending` existe sur
 *    le même paramètre, d'une classe d'origine différente (décision produit D2) — le médecin arbitre.
 */
import { useTranslations, useLocale } from "next-intl"
import type { AdjustableParameter, AdjustmentReason, ProposalSource } from "@prisma/client"
import { AlertTriangle, Info } from "lucide-react"
import { bcp47 } from "@/i18n/config"
import type { SlotDiffRow } from "@/lib/insulin/slot-diff"
import type { SlotRationale } from "@/lib/insulin/grouped-proposal"
import { deriveRiskDirection } from "@/lib/insulin/risk-direction"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/** Item consommé par le composant — une `SlotSetProposal` PENDING avec son diff pré-calculé serveur. */
export type ReviewGroupedViewItem = {
  id: string
  parameterType: AdjustableParameter
  /** Provenance dérivée serveur (ADR #27) — badge partagé avec `ProposalList` (`adjustments.source.*`). */
  source: ProposalSource
  rows: SlotDiffRow[]
  /** `true` = la base active a dérivé depuis le snapshot pris à la génération (`isBaselineUnchanged` négatif). */
  baselineDrifted: boolean
  /** `true` = cardinalité/bornes différentes entre live et proposé (créneau ajouté/supprimé/déplacé). */
  structuralChange: boolean
  /** US-2663 (S3b-0b) — rationale MOTEUR par créneau changé, appariée par `startHour`. `null` si `source ≠
   *  algorithm` (propositions humaines) ou JSON illisible (parse défensive serveur, fail-closed). */
  rationale: SlotRationale[] | null
  /** US-2663 (S3b-0b) — provenance d'une proposition SŒUR `pending` sur le même paramètre (classe d'origine
   *  différente, D2). `null` = aucune coexistence. */
  coexistsWith: ProposalSource | null
  createdAt: string
}

/** `AdjustmentReason` → clé i18n `review.reason<X>`. Exhaustif (tous les leviers) — un ajout à l'enum Prisma
 *  sans entrée ici casse la compilation (`Record` total), pas un fallback silencieux à l'affichage. */
const REASON_LABEL_KEY: Record<AdjustmentReason, string> = {
  basalTooLow: "reasonBasalTooLow",
  basalTooHigh: "reasonBasalTooHigh",
  basalCorrect: "reasonBasalCorrect",
  isfTooLow: "reasonIsfTooLow",
  isfTooHigh: "reasonIsfTooHigh",
  isfCorrect: "reasonIsfCorrect",
  icrTooLow: "reasonIcrTooLow",
  icrTooHigh: "reasonIcrTooHigh",
  icrCorrect: "reasonIcrCorrect",
  fixedDoseTooLow: "reasonFixedDoseTooLow",
  fixedDoseTooHigh: "reasonFixedDoseTooHigh",
  fixedDoseCorrect: "reasonFixedDoseCorrect",
  insufficientData: "reasonInsufficientData",
  patientRequested: "reasonPatientRequested",
  manualAdjustment: "reasonManualAdjustment",
}

/** Confiance moteur (`SlotRationale.confidence`) → clé i18n `review.confidence<X>`. */
const CONFIDENCE_LABEL_KEY: Record<"low" | "medium" | "high", string> = {
  low: "confidenceLow",
  medium: "confidenceMedium",
  high: "confidenceHigh",
}

/** parameterType → clé i18n `review.param<X>` — mêmes clés que `ProposalList` (libellés partagés). */
const PARAM_LABEL_KEY: Record<AdjustableParameter, string> = {
  basalRate: "paramBasalRate",
  insulinSensitivityFactor: "paramInsulinSensitivityFactor",
  insulinToCarbRatio: "paramInsulinToCarbRatio",
  fixedDose: "paramFixedDose",
}
/** Unité par paramètre. En pratique seuls ISF/ICR sont émis en `SlotSetProposal` à ce jour (cf. grouped-proposal.ts). */
const PARAM_UNIT_KEY: Record<AdjustableParameter, "isfGl" | "icr" | "basal" | "u"> = {
  insulinSensitivityFactor: "isfGl",
  insulinToCarbRatio: "icr",
  basalRate: "basal",
  fixedDose: "u",
}

/** "08h→22h" (encodage horaire, pas de traduction — même convention que `treatment-view.ts` `hourRange`). */
const hourRange = (startHour: number, endHour: number): string =>
  `${String(startHour).padStart(2, "0")}h–${String(endHour).padStart(2, "0")}h`

export function GroupedProposalReview({
  items,
  canDecide,
  busyId,
  onDecide,
}: {
  items: ReviewGroupedViewItem[]
  canDecide: boolean
  busyId: string | null
  onDecide: (id: string, action: "accept" | "reject") => void
}) {
  const t = useTranslations("review")
  const tUnits = useTranslations("insulinUnits")
  const tAdj = useTranslations("adjustments")
  const locale = useLocale()
  const fmt = (n: number) => n.toLocaleString(bcp47(locale), { maximumFractionDigits: 2 })

  if (items.length === 0) return null

  return (
    <ul className="space-y-4">
      {items.map((item) => {
        const unit = tUnits(PARAM_UNIT_KEY[item.parameterType])
        const paramLabel = t(PARAM_LABEL_KEY[item.parameterType])
        // US-2663 (S3b-0b) — rationale MOTEUR appariée au créneau par `startHour` (`null` = propositions
        // humaines, cf. `createSetProposal`).
        const rationaleByHour = new Map((item.rationale ?? []).map((r) => [r.startHour, r]))
        return (
          <li key={item.id} className="space-y-2 rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{paramLabel}</span>
              <Badge variant={item.source === "patient" ? "default" : "outline"}>
                {tAdj(`source.${item.source}`)}
              </Badge>
              {item.structuralChange && (
                <Badge variant="outline" className="border-feedback-warning text-feedback-warning">
                  {t("groupedStructuralChangeNote")}
                </Badge>
              )}
            </div>

            {item.baselineDrifted && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-feedback-warning bg-warning-bg px-3 py-2 text-xs font-medium text-warning-fg"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {t("groupedBaselineDrifted")}
              </p>
            )}

            {item.coexistsWith != null && (
              <p
                role="status"
                className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {t("groupedCoexists", { source: tAdj(`source.${item.coexistsWith}`) })}
              </p>
            )}

            <Table>
              <TableCaption className="sr-only">
                {t("groupedTableCaption", { param: paramLabel })}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("groupedColHour")}</TableHead>
                  <TableHead scope="col">{t("groupedColLive")}</TableHead>
                  <TableHead scope="col">{t("groupedColProposed")}</TableHead>
                  <TableHead scope="col">{t("groupedColReason")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.rows.map((row) => {
                  const liveText = row.liveValue === null ? "—" : `${fmt(row.liveValue)} ${unit}`
                  // Marqueur NON basé sur la couleur seule (WCAG 1.4.1) — lu aussi en navigation par cellules.
                  const changeKind = row.removed
                    ? t("groupedCellRemoved")
                    : row.liveValue === null
                      ? t("groupedCellNew")
                      : t("groupedCellChanged")
                  // aria-label de la ligne (navigation par lignes) — distingue supprimé / nouveau / modifié.
                  const rowAria = row.removed
                    ? t("groupedRowRemovedAria", { from: liveText })
                    : row.liveValue === null
                      ? t("groupedRowNewAria", { to: `${fmt(row.proposedValue ?? 0)} ${unit}` })
                      : row.changed
                        ? t("groupedRowChangedAria", { from: liveText, to: `${fmt(row.proposedValue ?? 0)} ${unit}` })
                        : undefined
                  // US-2663 (S3b-0b) — rationale + risque UNIQUEMENT sur un créneau CHANGÉ non supprimé (un
                  // créneau supprimé/inchangé n'a pas de « nouvelle » dose à justifier). Rationale = `null` pour
                  // une proposition humaine (`item.rationale === null`, cf. `createSetProposal`). Risque =
                  // direction générique (toute provenance), current = `liveValue` (fallback `proposedValue`
                  // pour un créneau NOUVEAU, sans base de comparaison → `none`).
                  const annotated = row.changed && !row.removed
                  const rationale = annotated ? (rationaleByHour.get(row.startHour) ?? null) : null
                  const risk =
                    annotated && row.proposedValue !== null
                      ? deriveRiskDirection(item.parameterType, row.liveValue ?? row.proposedValue, row.proposedValue)
                      : "none"
                  return (
                    <TableRow
                      key={`${row.startHour}-${row.endHour}-${row.removed ? "rm" : "pr"}`}
                      className={row.changed ? "bg-warning-bg" : undefined}
                      aria-label={rowAria}
                    >
                      <TableCell className="tabular-nums">{hourRange(row.startHour, row.endHour)}</TableCell>
                      <TableCell className="tabular-nums">{liveText}</TableCell>
                      <TableCell className="tabular-nums font-medium">
                        <span className="flex items-center gap-1">
                          {row.changed && (
                            <AlertTriangle className="h-3 w-3 shrink-0 text-warning-fg" aria-hidden="true" />
                          )}
                          {row.removed ? "—" : `${fmt(row.proposedValue ?? 0)} ${unit}`}
                          {row.changed && <span className="sr-only">({changeKind})</span>}
                        </span>
                      </TableCell>
                      <TableCell>
                        {(rationale !== null || risk !== "none") && (
                          <span className="flex flex-wrap items-center gap-1 text-xs">
                            {rationale && (
                              <>
                                <span className="text-foreground">{t(REASON_LABEL_KEY[rationale.reason])}</span>
                                {rationale.confidence && (
                                  <Badge variant="outline" className="text-muted-foreground">
                                    {t(CONFIDENCE_LABEL_KEY[rationale.confidence])}
                                  </Badge>
                                )}
                                {rationale.supportingEvents != null && (
                                  <span className="text-muted-foreground">
                                    {t("rationaleVolume", { count: rationale.supportingEvents })}
                                  </span>
                                )}
                              </>
                            )}
                            {risk !== "none" && (
                              <Badge
                                variant="outline"
                                className={risk === "hypo" ? "border-feedback-warning text-feedback-warning" : "text-muted-foreground"}
                              >
                                {tAdj(`risk.${risk}`)}
                              </Badge>
                            )}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {canDecide && (
              <span className="flex gap-2">
                {/* Parité avec `ProposalList` (medical) : Accepter DÉSACTIVÉ si la base a dérivé — l'accept
                    renverrait 409 côté serveur (CAS S1). `aria-label` inclut le paramètre (plusieurs
                    propositions → « Accepter » répété serait ambigu, WCAG 2.4.6). */}
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyId === item.id || item.baselineDrifted}
                  title={item.baselineDrifted ? t("acceptBlockedHint") : undefined}
                  aria-label={t("groupedAcceptAria", { param: paramLabel })}
                  onClick={() => onDecide(item.id, "accept")}
                >
                  {t("accept")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === item.id}
                  aria-label={t("groupedRejectAria", { param: paramLabel })}
                  onClick={() => onDecide(item.id, "reject")}
                >
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
