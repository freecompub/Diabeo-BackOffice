/**
 * PatientInsulinView — vue LECTURE self-service patient de l'insulinothérapie (US-2650).
 *
 * Composant **présentationnel** (`"use client"`) : reçoit un `TreatmentView` déjà résolu
 * et audité côté serveur (page `(patient)/patient/insulin-therapy`). Il ne fetch rien, ne
 * construit aucune URL porteuse d'id (anti-énumération) et n'expose AUCUNE action d'écriture
 * (le patient PROPOSE via une tranche ultérieure ; jamais d'écriture directe — ADR #13).
 *
 * Mode-aware (US-2647) :
 *  - **basal/bolus & dose fixe** : `hasSettings=true` → créneaux ISF/ICR + schéma basal.
 *  - **non insuliné** : `hasSettings=false` → état vide informatif (AC-4 : aucune posologie).
 *
 * Accessibilité : sections `aria-labelledby`, acronymes explicités (`Acronym` ISF/ICR),
 * valeurs en `tabular-nums`. i18n : namespace `patientInsulin` (+ `insulinUnits`).
 *
 * @param data Vue traitement résolue serveur (`buildTreatmentView`).
 */
"use client"

import { useTranslations } from "next-intl"
import { Acronym } from "@/components/diabeo/Acronym"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type { TreatmentView, Slot, BasalSlot } from "@/components/diabeo/patient/patient-record-views"

/** Une liste de créneaux en lecture seule (range · valeur unité). */
function SlotRows({
  slots,
  unit,
  emptyLabel,
}: {
  slots: { key: string; range: string; value: number }[]
  unit: string
  emptyLabel: string
}) {
  if (slots.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <ul className="space-y-1">
      {slots.map((s) => (
        <li key={s.key} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">{s.range}</span>
          <span className="font-medium tabular-nums">
            {s.value} <span className="text-muted-foreground">{unit}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function PatientInsulinView({ data }: { data: TreatmentView }) {
  const t = useTranslations("patientInsulin")
  const tUnits = useTranslations("insulinUnits")

  // Non insuliné / pas de configuration → état vide informatif (aucune dose affichée).
  if (!data.hasSettings) {
    return <DiabeoEmptyState variant="noData" title={t("title")} message={t("noSettings")} />
  }

  const isf = data.isfSlots.map((s: Slot) => ({ key: s.id, range: s.range, value: s.value }))
  const icr = data.icrSlots.map((s: Slot) => ({ key: s.id, range: s.range, value: s.value }))
  const basal = data.basalSlots.map((s: BasalSlot) => ({ key: s.pumpBasalSlotId, range: s.range, value: s.rate }))

  return (
    <div className="space-y-4">
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
          <SlotRows slots={isf} unit={tUnits("isfGl")} emptyLabel={t("noSlots")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">
            <Acronym code="ICR" /> — {t("icrTitle")}
          </h2>
        </CardHeader>
        <CardContent>
          <SlotRows slots={icr} unit={tUnits("icr")} emptyLabel={t("noSlots")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold">{t("basalTitle")}</h2>
        </CardHeader>
        <CardContent>
          <SlotRows slots={basal} unit={tUnits("basal")} emptyLabel={t("noSlots")} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t("readonlyHint")}</p>
    </div>
  )
}
