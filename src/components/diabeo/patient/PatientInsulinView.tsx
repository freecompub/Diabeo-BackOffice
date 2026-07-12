/**
 * PatientInsulinView — vue self-service patient de l'insulinothérapie (US-2650).
 *
 * Composant **présentationnel** (`"use client"`) : reçoit un `TreatmentView` déjà résolu
 * et audité côté serveur (page `(patient)/patient/insulin-therapy`). Il ne fetch rien et ne
 * construit aucune URL porteuse d'id (anti-énumération).
 *
 * Deux modes :
 *  - **lecture seule** (`canPropose=false`, défaut) : consultation uniquement.
 *  - **proposer** (`canPropose=true`, sous `PatientRecordProvider` avec un `mutate`) : un
 *    bouton par créneau ouvre `InsulinProposalDialog` → `POST /api/adjustment-proposals`
 *    (bornes patient + validation médecin — jamais d'écriture directe, ADR #13).
 *
 * Mode-aware (US-2647) : `hasSettings=false` (non insuliné) → état vide, aucune posologie (AC-4).
 * Accessibilité : titres de section en `<h2>`, acronymes explicités (`Acronym`).
 *
 * @param data Vue traitement résolue serveur (`buildTreatmentView`).
 * @param canPropose Active l'action « proposer » (nécessite un transport `mutate` en contexte).
 */
"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Acronym } from "@/components/diabeo/Acronym"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { InsulinProposalDialog } from "@/components/diabeo/patient/InsulinProposalDialog"
import { ProposalList, type ProposalViewItem } from "@/components/diabeo/patient/ProposalList"
import type { TreatmentView, Slot, BasalSlot } from "@/components/diabeo/patient/patient-record-views"

type Row = { key: string; range: string; value: number; action?: ReactNode }

/** Une liste de créneaux en lecture (range · valeur unité), avec action optionnelle. */
function SlotRows({ rows, unit, emptyLabel }: { rows: Row[]; unit: string; emptyLabel: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">{r.range}</span>
          <span className="flex items-center gap-3">
            <span className="font-medium tabular-nums">
              {r.value} <span className="text-muted-foreground">{unit}</span>
            </span>
            {r.action}
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

  const isfRows: Row[] = data.isfSlots.map((s: Slot) => ({
    key: s.id,
    range: s.range,
    value: s.value,
    action: canPropose ? (
      <InsulinProposalDialog
        parameterType="insulinSensitivityFactor"
        paramLabel={t("isfTitle")}
        slot={{ range: s.range, value: s.value }}
        target={{ kind: "timeSlot", startHour: s.startHour, endHour: s.endHour }}
        unit={tUnits("isfGl")}
      />
    ) : undefined,
  }))

  const icrRows: Row[] = data.icrSlots.map((s: Slot) => ({
    key: s.id,
    range: s.range,
    value: s.value,
    action: canPropose ? (
      <InsulinProposalDialog
        parameterType="insulinToCarbRatio"
        paramLabel={t("icrTitle")}
        slot={{ range: s.range, value: s.value }}
        target={{ kind: "timeSlot", startHour: s.startHour, endHour: s.endHour }}
        unit={tUnits("icr")}
      />
    ) : undefined,
  }))

  const basalRows: Row[] = data.basalSlots.map((s: BasalSlot) => ({
    key: s.pumpBasalSlotId,
    range: s.range,
    value: s.rate,
    action: canPropose ? (
      <InsulinProposalDialog
        parameterType="basalRate"
        paramLabel={t("basalTitle")}
        slot={{ range: s.range, value: s.rate }}
        target={{ kind: "pumpSlot", pumpBasalSlotId: s.pumpBasalSlotId }}
        unit={tUnits("basal")}
      />
    ) : undefined,
  }))

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
        <CardContent>
          <SlotRows rows={isfRows} unit={tUnits("isfGl")} emptyLabel={t("noSlots")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">
            <Acronym code="ICR" /> — {t("icrTitle")}
          </h2>
        </CardHeader>
        <CardContent>
          <SlotRows rows={icrRows} unit={tUnits("icr")} emptyLabel={t("noSlots")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">{t("basalTitle")}</h2>
        </CardHeader>
        <CardContent>
          <SlotRows rows={basalRows} unit={tUnits("basal")} emptyLabel={t("noSlots")} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{canPropose ? t("proposeHint") : t("readonlyHint")}</p>
    </div>
  )
}
