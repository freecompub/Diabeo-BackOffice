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
 */
import { useTranslations, useLocale } from "next-intl"
import type { AdjustableParameter, ProposalSource } from "@prisma/client"
import { AlertTriangle } from "lucide-react"
import { bcp47 } from "@/i18n/config"
import type { SlotDiffRow } from "@/lib/insulin/slot-diff"
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
  createdAt: string
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

            <Table>
              <TableCaption className="sr-only">
                {t("groupedTableCaption", { param: paramLabel })}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("groupedColHour")}</TableHead>
                  <TableHead scope="col">{t("groupedColLive")}</TableHead>
                  <TableHead scope="col">{t("groupedColProposed")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.rows.map((row) => (
                  <TableRow
                    key={`${row.startHour}-${row.endHour}`}
                    className={row.changed ? "bg-warning-bg" : undefined}
                    aria-label={
                      row.changed
                        ? t("groupedRowChangedAria", {
                            from: row.liveValue === null ? "—" : `${fmt(row.liveValue)} ${unit}`,
                            to: `${fmt(row.proposedValue)} ${unit}`,
                          })
                        : undefined
                    }
                  >
                    <TableCell className="tabular-nums">{hourRange(row.startHour, row.endHour)}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.liveValue === null ? "—" : `${fmt(row.liveValue)} ${unit}`}
                    </TableCell>
                    <TableCell className="tabular-nums font-medium">
                      <span className="flex items-center gap-1">
                        {row.changed && (
                          <AlertTriangle className="h-3 w-3 shrink-0 text-feedback-warning" aria-hidden="true" />
                        )}
                        {fmt(row.proposedValue)} {unit}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {canDecide && (
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyId === item.id}
                  onClick={() => onDecide(item.id, "accept")}
                >
                  {t("accept")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === item.id}
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
