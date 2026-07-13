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
 *  - L'appariement rationale ↔ ligne est POLYMORPHE par levier (US-2663 S3d) : clé `startHour` (ISF/ICR/pompe)
 *    ou `(usage, moment)` (dose fixe, `SlotDiffRow.usage`/`SlotDiffRow.moment`) — cf. `rationaleKeyOf`.
 *
 * US-2663 (S3d) — DOSE FIXE (mode « doses simples ») : le libellé de créneau devient « Bolus · Matin »
 * (`usage`/`moment` traduits, `SlotDiffRow.startHour`/`endHour` ne portent qu'un ordre synthétique, jamais un
 * horaire réel) et une ligne dont la dose proposée dépasse le seuil d'usage (`SlotDiffRow.highDoseWarning`,
 * dérivé SERVEUR — bornes cliniques jamais côté client) affiche un badge d'alerte NON bloquant à côté de la
 * valeur proposée.
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
  /**
   * US-2663 (S3e) — `true` pour une proposition `basalRate` de forme STYLO (doses `daily`/`morning`/`evening`,
   * U TOTALES). Dérivé SERVEUR (forme du jeu, `page.tsx`) — `basalRate` porte pompe (U/h) ET stylo (U totales) :
   * ce drapeau sélectionne l'unité d'affichage (`u` vs `basal`) et le libellé de dose. Absent = pompe/autre levier.
   */
  isPenBasal?: boolean
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

/**
 * US-2663 (S3e) — libellés de raison BASALE STYLO : une dose stylo est en **U TOTALES** (pas un « débit » U/h de
 * pompe). Restreint aux 3 raisons basales (la rationale moteur d'un item stylo est toujours `basalTooLow`/`High`/
 * `Correct`). Sélectionné à la place de `REASON_LABEL_KEY` quand `isPenBasal` ; fallback sur le libellé partagé
 * pour toute autre raison (défense, jamais atteint sur un stylo).
 */
const STYLO_REASON_LABEL_KEY: Partial<Record<AdjustmentReason, string>> = {
  basalTooLow: "reasonStyloBasalTooLow",
  basalTooHigh: "reasonStyloBasalTooHigh",
  basalCorrect: "reasonStyloBasalCorrect",
}

/** Confiance moteur (`SlotRationale.confidence`) → clé i18n `review.confidence<X>`. */
// US-2663 (S3b-0b, revue CR) — typé sur la confiance NON-NULL de `SlotRationale` (dérivé, pas réécrit) :
// une évolution du schéma de confiance casserait la compilation ici, comme `REASON_LABEL_KEY` sur l'enum Prisma.
const CONFIDENCE_LABEL_KEY: Record<NonNullable<SlotRationale["confidence"]>, string> = {
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
/** Unité par paramètre. US-2663 (S3c) — ISF/ICR (g/L·U, g/U) + basale POMPE (`basalRate` → U/h) émis en
 * `SlotSetProposal` ; la basale STYLO (U totales) et la dose fixe rejoignent l'affichage dans leurs PR dédiées. */
const PARAM_UNIT_KEY: Record<AdjustableParameter, "isfGl" | "icr" | "basal" | "u"> = {
  insulinSensitivityFactor: "isfGl",
  insulinToCarbRatio: "icr",
  basalRate: "basal",
  fixedDose: "u",
}

/** "08h→22h" (encodage horaire, pas de traduction — même convention que `treatment-view.ts` `hourRange`). */
const hourRange = (startHour: number, endHour: number): string =>
  `${String(startHour).padStart(2, "0")}h–${String(endHour).padStart(2, "0")}h`

/**
 * US-2663 (S3d) — Clé d'appariement rationale ↔ ligne, POLYMORPHE par levier : `(usage, moment)` pour la dose
 * fixe (pas d'horaire réel — `SlotDiffRow.startHour` n'est qu'un ordre synthétique), `startHour` (chaîne) pour
 * les autres leviers (ISF/ICR/pompe). Utilisée à la fois côté rationale (`SlotRationale`) et côté ligne
 * (`SlotDiffRow`) pour garantir le même hachage des deux côtés.
 */
const rationaleKeyOf = (
  parameterType: AdjustableParameter,
  entry: { startHour?: number; usage?: string; moment?: string; basalDoseKind?: string },
): string =>
  // US-2663 (S3e) — la basale STYLO apparie par `basalDoseKind` (présent des DEUX côtés : rationale moteur ET
  // ligne de diff). Prioritaire sur `startHour` : une ligne stylo n'a qu'un `startHour` synthétique (ordre).
  entry.basalDoseKind ??
  (parameterType === "fixedDose" ? `${entry.usage}:${entry.moment}` : String(entry.startHour))

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
        // US-2663 (S3e) — la basale STYLO s'affiche en U TOTALES (`u`), pas en U/h (`basal`) : `basalRate` porte
        // les deux modalités, désambiguïsées par `isPenBasal` (dérivé serveur). Cf. `ProposalList` (par-valeur).
        const unit = item.isPenBasal ? tUnits("u") : tUnits(PARAM_UNIT_KEY[item.parameterType])
        const paramLabel = t(PARAM_LABEL_KEY[item.parameterType])
        // US-2663 (S3b-0b, polymorphe S3d) — rationale MOTEUR appariée au créneau par clé POLYMORPHE
        // (`startHour` ISF/ICR/pompe, `(usage, moment)` dose fixe — cf. `rationaleKeyOf`). `null` = propositions
        // humaines, cf. `createSetProposal`.
        const rationaleByKey = new Map(
          (item.rationale ?? []).map((r) => [rationaleKeyOf(item.parameterType, r), r]),
        )
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
                  const rationale = annotated
                    ? (rationaleByKey.get(rationaleKeyOf(item.parameterType, row)) ?? null)
                    : null
                  const risk =
                    annotated && row.proposedValue !== null
                      ? deriveRiskDirection(item.parameterType, row.liveValue ?? row.proposedValue, row.proposedValue)
                      : "none"
                  // US-2663 (S3d) — libellé de créneau DOSE FIXE traduit « Bolus · Matin » (`usage`/`moment`,
                  // pas d'horaire réel) ; fallback `timeLabel`/`hourRange` inchangé pour les autres leviers.
                  // US-2663 (S3e) — libellé de dose STYLO traduit (« Dose du soir », `basalDoseKind`, pas
                  // d'horaire réel) ; sinon dose fixe (« Bolus · Matin ») ; sinon `timeLabel`/`hourRange`.
                  const cellLabel =
                    item.isPenBasal && row.basalDoseKind !== undefined
                      ? t(`styloBasalKind.${row.basalDoseKind}`)
                      : item.parameterType === "fixedDose" && row.usage !== undefined && row.moment !== undefined
                        ? `${t(`fixedDoseUsage.${row.usage}`)} · ${t(`fixedDoseMoment.${row.moment}`)}`
                        : (row.timeLabel ?? hourRange(row.startHour, row.endHour))
                  return (
                    <TableRow
                      key={
                        item.isPenBasal && row.basalDoseKind !== undefined
                          ? `${row.basalDoseKind}-${row.removed ? "rm" : "pr"}`
                          : item.parameterType === "fixedDose"
                            ? `${row.usage}-${row.moment}-${row.removed ? "rm" : "pr"}`
                            : `${row.startHour}-${row.endHour}-${row.removed ? "rm" : "pr"}`
                      }
                      className={row.changed ? "bg-warning-bg" : undefined}
                      aria-label={rowAria}
                    >
                      {/* US-2663 (S3c) — `timeLabel` (bornes EXACTES "HH:MM") préféré pour la basale POMPE ;
                          fallback `hourRange` (heures entières) pour ISF/ICR. US-2663 (S3d) — libellé
                          `usage`/`moment` traduit pour la dose fixe (`cellLabel`), pas un horaire réel. */}
                      <TableCell className={item.parameterType === "fixedDose" || item.isPenBasal ? undefined : "tabular-nums"}>
                        {cellLabel}
                      </TableCell>
                      <TableCell className="tabular-nums">{liveText}</TableCell>
                      <TableCell className="tabular-nums font-medium">
                        <span className="flex items-center gap-1">
                          {row.changed && (
                            <AlertTriangle className="h-3 w-3 shrink-0 text-warning-fg" aria-hidden="true" />
                          )}
                          {row.removed ? "—" : `${fmt(row.proposedValue ?? 0)} ${unit}`}
                          {row.changed && <span className="sr-only">({changeKind})</span>}
                          {/* US-2663 (S3d) — avertissement NON bloquant dose élevée (`highDoseWarning`, dérivé
                              SERVEUR — bornes cliniques jamais côté client), même pattern que le badge
                              d'alerte « dérive structurelle » (`border-feedback-warning`/`text-warning-fg`). */}
                          {row.highDoseWarning && (
                            <Badge variant="outline" className="gap-1 border-feedback-warning text-warning-fg">
                              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                              {t("groupedHighDoseWarning")}
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        {(rationale !== null || risk !== "none") && (
                          <span className="flex flex-wrap items-center gap-1 text-xs">
                            {rationale && (
                              <>
                                <span className="text-foreground">{t(
                                  item.isPenBasal
                                    ? (STYLO_REASON_LABEL_KEY[rationale.reason] ?? REASON_LABEL_KEY[rationale.reason])
                                    : REASON_LABEL_KEY[rationale.reason],
                                )}</span>
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
                                {/* US-2663 (S3b-0b, revue medical MEDIUM) — glycémie moyenne OBSERVÉE ayant motivé
                                    la reco : objective une dé-escalade de sécurité (ex. corrections atterrissant en
                                    moyenne à 0,60 g/L = preuve d'hypo). Valeur g/L (moteur ISF/ICR). */}
                                {rationale.averageObservedValue != null && (
                                  <span className="text-muted-foreground tabular-nums">
                                    {t("rationaleAvgGlucose", { value: fmt(rationale.averageObservedValue) })}
                                  </span>
                                )}
                              </>
                            )}
                            {risk !== "none" && (
                              // Contraste (revue a11y 1.4.3) : `text-warning-fg` (≥ 4.5:1 sur `bg-warning-bg` d'une
                              // ligne changée), pas `text-feedback-warning` (~2:1). Bordure ambre conservée.
                              <Badge
                                variant="outline"
                                className={risk === "hypo" ? "border-feedback-warning text-warning-fg" : "text-muted-foreground"}
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
