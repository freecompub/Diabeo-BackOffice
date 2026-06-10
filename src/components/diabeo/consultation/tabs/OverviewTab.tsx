"use client"

/** US-2018b — Onglet « Vue d'ensemble » : identité, pathologie, objectifs, référent. */

import { useTranslations } from "next-intl"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { useConsultationData } from "../useConsultationData"
import { TabError, TabLoading } from "./TabState"

interface OverviewData {
  pathology: "DT1" | "DT2" | "GD"
  user: { sex: string | null; birthday: string | null }
  // Le modèle GlycemiaObjective expose des bornes par moment (limitEm/Bm/Am*),
  // pas un simple min/max. On n'interprète pas ces bornes ici (risque clinique) :
  // l'onglet indique seulement si des objectifs sont définis, le détail relève
  // de l'écran objectifs dédié.
  glycemiaObjectives: Array<unknown>
  referent: { pro: { name: string | null } | null } | null
}

function age(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  let a = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--
  return a
}

export function OverviewTab({ cTok }: { cTok: string }) {
  const t = useTranslations("consultation")
  const { data, loading, error } = useConsultationData<OverviewData>("/api/patient", cTok)

  if (loading) return <TabLoading />
  if (error || !data) return <TabError />

  const a = age(data.user.birthday)
  const hasObjectives = data.glycemiaObjectives.length > 0

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DiabeoCard variant="outlined" padding="md">
        <h3 className="mb-2 text-sm font-semibold">{t("overview.identity")}</h3>
        <dl className="space-y-1 text-sm">
          <Row label={t("overview.pathology")} value={t(`pathology.${data.pathology}`)} />
          <Row label={t("overview.age")} value={a !== null ? `${a} ${t("yearsShort")}` : "—"} />
          <Row label={t("overview.referent")} value={data.referent?.pro?.name ?? "—"} />
        </dl>
      </DiabeoCard>

      <DiabeoCard variant="outlined" padding="md">
        <h3 className="mb-2 text-sm font-semibold">{t("overview.objectives")}</h3>
        <dl className="space-y-1 text-sm">
          <Row
            label={t("overview.objectivesStatus")}
            value={hasObjectives ? t("overview.configured") : t("overview.notSet")}
          />
        </dl>
      </DiabeoCard>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  )
}
