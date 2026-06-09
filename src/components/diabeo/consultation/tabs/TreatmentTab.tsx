"use client"

/** US-2018b — Onglet « Traitements » : schéma basal, ISF/ICR par créneau. */

import { useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { useConsultationData } from "../useConsultationData"
import { TabError, TabLoading } from "./TabState"

interface InsulinSettings {
  sensitivityFactors: Array<{ startHour: number; sensitivityFactorMgdl: number | string | null }>
  carbRatios: Array<{ startHour: number; gramsPerUnit: number | string | null }>
  // PumpBasalSlot : `rate` (U/h, Decimal→string) et `startTime` (@db.Time →
  // DateTime sérialisé en ISO "1970-01-01THH:MM:..Z").
  basalConfiguration: { pumpSlots: Array<{ startTime: string; rate: number | string | null }> } | null
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`
/** "1970-01-01T08:30:00.000Z" (Prisma @db.Time) → "08:30". */
const hhmm = (iso: string) => (iso.length >= 16 ? iso.slice(11, 16) : iso)

export function TreatmentTab({ cTok }: { cTok: string }) {
  const t = useTranslations("consultation")
  const { data, loading, error } = useConsultationData<InsulinSettings | null>(
    "/api/patient/insulin-settings",
    cTok,
  )

  if (loading) return <TabLoading />
  if (error) return <TabError />
  if (!data) return <DiabeoEmptyState variant="noData" />

  const basal = data.basalConfiguration?.pumpSlots ?? []

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <DiabeoCard variant="outlined" padding="md">
        <h3 className="mb-2 text-sm font-semibold">{t("treatment.isf")}</h3>
        <SlotList
          rows={data.sensitivityFactors.map((s) => ({ from: hh(s.startHour), value: `${s.sensitivityFactorMgdl ?? "—"} mg/dL/U` }))}
          empty={t("treatment.none")}
        />
      </DiabeoCard>
      <DiabeoCard variant="outlined" padding="md">
        <h3 className="mb-2 text-sm font-semibold">{t("treatment.icr")}</h3>
        <SlotList
          rows={data.carbRatios.map((c) => ({ from: hh(c.startHour), value: `${c.gramsPerUnit ?? "—"} g/U` }))}
          empty={t("treatment.none")}
        />
      </DiabeoCard>
      <DiabeoCard variant="outlined" padding="md">
        <h3 className="mb-2 text-sm font-semibold">{t("treatment.basal")}</h3>
        <SlotList
          rows={basal.map((b) => ({ from: hhmm(b.startTime), value: `${b.rate ?? "—"} U/h` }))}
          empty={t("treatment.none")}
        />
      </DiabeoCard>
    </div>
  )
}

function SlotList({ rows, empty }: { rows: Array<{ from: string; value: string }>; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((r, i) => (
        <li key={i} className="flex justify-between gap-3">
          <span className="text-muted-foreground">{r.from}</span>
          <span className="font-medium text-foreground">{r.value}</span>
        </li>
      ))}
    </ul>
  )
}
