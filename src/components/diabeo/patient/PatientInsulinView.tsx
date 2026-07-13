/**
 * PatientInsulinView — vue self-service patient de l'insulinothérapie (US-2650).
 *
 * Composant **présentationnel** (`"use client"`) : reçoit un `TreatmentView` déjà résolu
 * et audité côté serveur (page `(patient)/patient/insulin-therapy`). Il ne fetch rien et ne
 * construit aucune URL porteuse d'id (anti-énumération).
 *
 * Deux modes :
 *  - **lecture seule** (`canPropose=false`, défaut) : consultation uniquement.
 *  - **proposer** (`canPropose=true`, sous `PatientRecordProvider` avec un `mutate`) : sous chaque
 *    section (ISF / ICR / basale), un bouton « Proposer » ouvre l'éditeur de GROUPE en mode
 *    **proposition** (US-2663 S4) — le patient soumet sa disposition ENTIÈRE, enregistrée comme
 *    proposition d'ensemble pour revue médecin (`PUT /api/patient/insulin-slot-set`, own-id, jamais
 *    appliquée directement — ADR #13). Remplace l'ancien bouton par-créneau (`InsulinProposalDialog`).
 *
 * Mode-aware (US-2647) : `hasSettings=false` (non insuliné) → état vide, aucune posologie (AC-4).
 * Accessibilité : titres de section en `<h2>`, acronymes explicités (`Acronym`).
 *
 * @param data Vue traitement résolue serveur (`buildTreatmentView`).
 * @param canPropose Active l'action « proposer » (nécessite un transport `mutate` en contexte).
 */
"use client"

import { useTranslations } from "next-intl"
import { Acronym } from "@/components/diabeo/Acronym"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { InsulinSlotSetDialog } from "@/components/diabeo/patient/InsulinSlotSetDialog"
import { InsulinBasalSlotSetDialog } from "@/components/diabeo/patient/InsulinBasalSlotSetDialog"
import { PARAM_BOUNDS } from "@/components/diabeo/patient/insulin-parameter-endpoints"
import { ProposalList, type ProposalViewItem } from "@/components/diabeo/patient/ProposalList"
import type { TreatmentView, Slot, BasalSlot } from "@/components/diabeo/patient/patient-record-views"

type Row = { key: string; range: string; value: number }

/** Une liste de créneaux en lecture (range · valeur unité). */
function SlotRows({ rows, unit, emptyLabel }: { rows: Row[]; unit: string; emptyLabel: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">{r.range}</span>
          <span className="font-medium tabular-nums">
            {r.value} <span className="text-muted-foreground">{unit}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function PatientInsulinView({
  data,
  canPropose = false,
  proposals = [],
}: {
  data: TreatmentView
  canPropose?: boolean
  /** US-2664 — demandes en attente DU PATIENT (`source=patient`, filtré serveur). Rendu **sécurisé**
   *  (audience `patient`) : sans badge clinicien, bandeau « ne modifiez pas vos doses », ton non-prescriptif. */
  proposals?: ProposalViewItem[]
}) {
  const t = useTranslations("patientInsulin")
  const tUnits = useTranslations("insulinUnits")

  // Non insuliné / pas de configuration → état vide informatif (aucune dose affichée).
  if (!data.hasSettings) {
    return <DiabeoEmptyState variant="noData" title={t("title")} message={t("noSettings")} />
  }

  const isfRows: Row[] = data.isfSlots.map((s: Slot) => ({ key: s.id, range: s.range, value: s.value }))
  const icrRows: Row[] = data.icrSlots.map((s: Slot) => ({ key: s.id, range: s.range, value: s.value }))
  const basalRows: Row[] = data.basalSlots.map((s: BasalSlot) => ({ key: s.pumpBasalSlotId, range: s.range, value: s.rate }))

  // Créneaux ADRESSABLES pour la proposition GROUPÉE (jeu ENTIER) — audience patient (own-id).
  const isfSet = data.isfSlots.map((s: Slot) => ({ startHour: s.startHour, endHour: s.endHour, value: s.value }))
  const icrSet = data.icrSlots.map((s: Slot) => ({ startHour: s.startHour, endHour: s.endHour, value: s.value }))
  const basalSet = data.basalSlots.map((s: BasalSlot) => ({ startTime: s.startTime, endTime: s.endTime, value: s.rate }))

  return (
    <div className="space-y-4">
      {/* US-2664 — SES demandes en attente (audience patient : bandeau + sans badge clinicien). */}
      {proposals.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">{t("proposalsTitle")}</h2>
          </CardHeader>
          <CardContent>
            <ProposalList audience="patient" items={proposals} />
          </CardContent>
        </Card>
      )}
      {data.bolusInsulin && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">{t("bolusInsulin")}</h2>
          </CardHeader>
          <CardContent className="text-sm">
            <span className="font-medium">{data.bolusInsulin.name}</span>
            {data.bolusInsulin.dosage && <span className="text-muted-foreground"> · {data.bolusInsulin.dosage}</span>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">
            <Acronym code="ISF" /> — {t("isfTitle")}
          </h2>
        </CardHeader>
        <CardContent className="space-y-3">
          <SlotRows rows={isfRows} unit={tUnits("isfGl")} emptyLabel={t("noSlots")} />
          {canPropose && isfSet.length > 0 && (
            <InsulinSlotSetDialog
              param="insulinSensitivityFactor"
              paramLabel={t("isfTitle")}
              unit={tUnits("isfGl")}
              initialSlots={isfSet}
              bounds={PARAM_BOUNDS.insulinSensitivityFactor}
              mode="propose"
              audience="patient"
              structural={false}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">
            <Acronym code="ICR" /> — {t("icrTitle")}
          </h2>
        </CardHeader>
        <CardContent className="space-y-3">
          <SlotRows rows={icrRows} unit={tUnits("icr")} emptyLabel={t("noSlots")} />
          {canPropose && icrSet.length > 0 && (
            <InsulinSlotSetDialog
              param="insulinToCarbRatio"
              paramLabel={t("icrTitle")}
              unit={tUnits("icr")}
              initialSlots={icrSet}
              bounds={PARAM_BOUNDS.insulinToCarbRatio}
              mode="propose"
              audience="patient"
              structural={false}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">{t("basalTitle")}</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          <SlotRows rows={basalRows} unit={tUnits("basal")} emptyLabel={t("noSlots")} />
          {canPropose && basalSet.length > 0 && (
            <InsulinBasalSlotSetDialog
              paramLabel={t("basalTitle")}
              unit={tUnits("basal")}
              initialSlots={basalSet}
              bounds={PARAM_BOUNDS.basalRate}
              mode="propose"
              audience="patient"
              structural={false}
            />
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{canPropose ? t("proposeHint") : t("readonlyHint")}</p>
    </div>
  )
}
