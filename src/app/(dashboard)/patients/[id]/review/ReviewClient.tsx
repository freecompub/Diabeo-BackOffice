/**
 * Mode revue de consultation — vue client (stepper vertical) — US-2605.
 *
 * Reçoit les données déjà résolues/auditées par le Server Component parent
 * (`page.tsx`). AUCUN calcul clinique : rend les valeurs serveur. Stepper
 * **déterministe, sans IA** en 6 étapes : Résumé, Glycémie, Traitement, Mode de
 * vie (placeholder V1), Décisions médicales, Compte rendu.
 *
 * - Décisions (étape 5) : accepter/rejeter une `AdjustmentProposal` est réservé
 *   au médecin (`canDecide`) — gardé aussi côté route (DOCTOR-only).
 * - Compte rendu (étape 6) : éditeur → autosave du brouillon (PATCH) puis
 *   finalisation (POST) en addendum IMMUABLE, ancré sur la version des données.
 */

"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import type { AdjustableParameter } from "@prisma/client"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { PatientContextBar, type ContextFlags } from "@/components/diabeo/patient/PatientContextBar"
import { GlycemiaValue, TirDonut, ClinicalBadge, StatCard } from "@/components/diabeo"
import type { TirData } from "@/components/diabeo/TirDonut"
import { Acronym } from "@/components/diabeo/Acronym"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { CgmChart } from "@/components/diabeo/CgmChart"
import { bcp47 } from "@/i18n/config"
import type { GlycemiaView } from "../glycemia-view"
import type { TreatmentView } from "../treatment-view"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Activity, CheckCircle2, ClipboardList, FileText, HeartPulse, Pill, Stethoscope, Syringe,
} from "lucide-react"

export type ReviewProposalItem = {
  id: string
  parameterType: AdjustableParameter
  currentValue: number
  proposedValue: number
  changePercent: number
  reason: string
  confidence: string
  timeSlotStartHour: number | null
  timeSlotEndHour: number | null
  createdAt: string
}

export type ReviewData = {
  encounterId: number
  /** Brouillon de compte rendu repris (le cas échéant). */
  draftReport: string | null
  /** Médecin (ou admin) : peut accepter/rejeter une proposition (étape 5). */
  canDecide: boolean
  /** Ancrage version des données affiché dans le compte rendu. */
  anchor: { periodDays: number; dataAsOf: string }
  patient: {
    id: number
    name: string
    age: number | null
    sex: "M" | "F" | "X" | null
    pathology: string | null
    diagYear: number | null
    referent: string | null
    flags: ContextFlags
  }
  objectives: {
    targetLowMgdl: number
    targetHighMgdl: number
    tirTargetPct: number
    hypoMaxPct: number
    cvMaxPct: number
  }
  stats: {
    avgGlucoseMgdl: number
    gmi: number
    cv: number
    tir: TirData
    readingCount: number
    captureRate: number
    insufficientCapture: boolean
  } | null
  glycemia: GlycemiaView
  treatment: TreatmentView
  proposals: ReviewProposalItem[]
}

/** parameterType → clé i18n (règle acronyme « Libellé (ACRONYME) »). */
const PARAM_LABEL_KEY: Record<AdjustableParameter, string> = {
  basalRate: "paramBasalRate",
  insulinSensitivityFactor: "paramInsulinSensitivityFactor",
  insulinToCarbRatio: "paramInsulinToCarbRatio",
}

/** parameterType → clé d'unité (namespace `insulinUnits`). ISF stocké en g/L. */
const PARAM_UNIT_KEY: Record<AdjustableParameter, "isfGl" | "icr" | "basal"> = {
  insulinSensitivityFactor: "isfGl",
  insulinToCarbRatio: "icr",
  basalRate: "basal",
}

const STEPS = [
  { id: "summary", icon: Activity },
  { id: "glycemia", icon: HeartPulse },
  { id: "treatment", icon: Syringe },
  { id: "lifestyle", icon: Pill },
  { id: "decisions", icon: Stethoscope },
  { id: "report", icon: FileText },
] as const

type StepId = (typeof STEPS)[number]["id"]

export function ReviewClient({
  data,
  sharingDisabled = false,
}: {
  data: ReviewData | null
  sharingDisabled?: boolean
}) {
  const t = useTranslations("review")
  const [active, setActive] = useState<StepId>("summary")

  if (sharingDisabled || !data) {
    return (
      <>
        <DashboardHeader title={t("title")} subtitle="" />
        <div className="p-6">
          <Card>
            <CardContent className="py-10">
              <DiabeoEmptyState
                variant="noData"
                title={t("sharingDisabledTitle")}
                message={t("sharingDisabledDesc")}
              />
            </CardContent>
          </Card>
        </div>
      </>
    )
  }

  const name = data.patient.name || t("patientFallback")

  return (
    <>
      <PatientContextBar
        patientId={data.patient.id}
        name={name}
        age={data.patient.age}
        pathology={data.patient.pathology}
        referent={data.patient.referent}
        flags={data.patient.flags}
      />

      <div className="p-6">
        <DashboardHeader title={t("title")} subtitle={t("subtitle")} />

        <Tabs
          orientation="vertical"
          value={active}
          onValueChange={(v) => setActive(v as StepId)}
          className="mt-6 gap-6"
        >
          <TabsList variant="line" aria-label={t("stepperAriaLabel")} className="min-w-52 shrink-0">
            {STEPS.map((step, i) => (
              <TabsTrigger
                key={step.id}
                value={step.id}
                aria-current={active === step.id ? "step" : undefined}
              >
                <step.icon aria-hidden="true" />
                <span className="me-1 tabular-nums text-muted-foreground">{i + 1}.</span>
                {t(`step_${step.id}`)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="summary" className="space-y-6">
            <SummaryStep data={data} />
          </TabsContent>
          <TabsContent value="glycemia" className="space-y-6">
            <GlycemiaStep data={data} />
          </TabsContent>
          <TabsContent value="treatment" className="space-y-6">
            <TreatmentStep data={data} />
          </TabsContent>
          <TabsContent value="lifestyle" className="space-y-6">
            <Card>
              <CardContent className="py-10">
                <DiabeoEmptyState
                  variant="noData"
                  title={t("step_lifestyle")}
                  message={t("lifestylePlaceholder")}
                />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="decisions" className="space-y-6">
            <DecisionsStep data={data} />
          </TabsContent>
          <TabsContent value="report" className="space-y-6">
            <ReportStep data={data} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

/* ── Étape 1 — Résumé ─────────────────────────────────────────────── */
function SummaryStep({ data }: { data: ReviewData }) {
  const t = useTranslations("review")
  const { stats, objectives, patient } = data
  return (
    <>
      {patient.flags.openUrgency && (
        <p role="alert" className="rounded-md border border-feedback-warning bg-warning-bg px-4 py-2 text-sm text-warning-fg">
          {t("flagUrgency")}
        </p>
      )}
      {patient.flags.recentHypos && (
        <p role="status" className="rounded-md border border-feedback-warning bg-warning-bg px-4 py-2 text-sm text-warning-fg">
          {t("flagRecentHypos", { count: patient.flags.hypoCount })}
        </p>
      )}
      {patient.flags.silentMonitoring && (
        <p role="status" className="rounded-md border border-feedback-warning bg-warning-bg px-4 py-2 text-sm text-warning-fg">
          {t("flagSilent", { days: patient.flags.silentDays ?? 0 })}
        </p>
      )}
      {stats?.insufficientCapture && (
        <p role="status" className="rounded-md border border-feedback-warning bg-warning-bg px-4 py-2 text-sm text-warning-fg">
          {t("lowCaptureWarning", { rate: Math.round(stats.captureRate) })}
        </p>
      )}

      {stats ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t("avgGlucose")} value={String(stats.avgGlucoseMgdl)} unit="mg/dL" icon={<Activity className="h-5 w-5" />} />
            <StatCard label={t("kpiTir")} value={`${Math.round(stats.tir.inRange)}%`} variant={stats.tir.inRange >= objectives.tirTargetPct ? "success" : "warning"} />
            <StatCard label={t("kpiGmi")} value={`${stats.gmi}%`} />
            <StatCard label={t("kpiCv")} value={`${stats.cv}%`} variant={stats.cv <= objectives.cvMaxPct ? "success" : "warning"} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <Acronym code="TIR" /> {t("tirDonutPeriod", { days: data.anchor.periodDays })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-center gap-8">
              <TirDonut data={stats.tir} size={180} showLegend />
              <div className="flex flex-col gap-2 text-sm">
                {patient.pathology && <ClinicalBadge type="pathology" value={patient.pathology} />}
                <span className="text-muted-foreground">
                  {t("targetRange", { low: objectives.targetLowMgdl, high: objectives.targetHighMgdl })}
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">{t("noCgmData")}</p>
          </CardContent>
        </Card>
      )}
    </>
  )
}

/* ── Étape 2 — Glycémie ───────────────────────────────────────────── */
function GlycemiaStep({ data }: { data: ReviewData }) {
  const t = useTranslations("review")
  const { glycemia, objectives } = data
  return (
    <>
      {glycemia.recentOutOfRange && (
        <p
          role={glycemia.recentOutOfRange === "low" ? "alert" : "status"}
          className="rounded-md border border-feedback-warning bg-warning-bg px-4 py-2 text-sm text-warning-fg"
        >
          {glycemia.recentOutOfRange === "low" ? t("recentOutOfRangeLow") : t("recentOutOfRangeHigh")}
        </p>
      )}
      {glycemia.points.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" aria-hidden="true" />
              {t("glycemicProfile24h")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {glycemia.lastReadingMgdl !== null && (
              <GlycemiaValue
                value={glycemia.lastReadingMgdl}
                unit="mg/dL"
                thresholds={{ low: objectives.targetLowMgdl, high: objectives.targetHighMgdl }}
              />
            )}
            <CgmChart data={glycemia.points} targetLow={objectives.targetLowMgdl} targetHigh={objectives.targetHighMgdl} />
            {glycemia.outOfDisplayRangeCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("outOfDisplayRangeNote", { count: glycemia.outOfDisplayRangeCount })}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10">
            <DiabeoEmptyState variant="noData" title={t("step_glycemia")} message={t("noCgmData")} />
          </CardContent>
        </Card>
      )}
    </>
  )
}

/* ── Étape 3 — Traitement ─────────────────────────────────────────── */
function TreatmentStep({ data }: { data: ReviewData }) {
  const t = useTranslations("review")
  const tUnits = useTranslations("insulinUnits")
  const { treatment } = data
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Syringe className="h-4 w-4" aria-hidden="true" />
          {t("insulinConfigTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {treatment.hasSettings ? (
          <>
            <div>
              <span className="text-muted-foreground">{t("method")}</span>
              <p className="mt-1 font-medium">
                {treatment.deliveryMethod === "pump" ? t("deliveryPump") : t("deliveryManual")}
              </p>
            </div>
            {treatment.bolusInsulin && (
              <div>
                <span className="text-muted-foreground">{t("bolusInsulinLabel")}</span>
                <p className="mt-1 font-medium">{treatment.bolusInsulin.name}</p>
              </div>
            )}
            <SlotBlock label={<Acronym code="ISF" />} unit={tUnits("isfGl")} slots={treatment.isfSlots} />
            <SlotBlock label={<Acronym code="ICR" />} unit={tUnits("icr")} slots={treatment.icrSlots} />
            <SlotBlock
              label={t("basalLabel")}
              unit={tUnits("basal")}
              slots={treatment.basalSlots.map((b) => ({ range: b.range, value: b.rate }))}
            />
            {treatment.treatments.length > 0 && (
              <div>
                <span className="text-muted-foreground">{t("associatedTreatmentsTitle")}</span>
                <ul className="mt-1 space-y-1">
                  {treatment.treatments.map((tr) => (
                    <li key={tr.id} className="rounded-md border border-border bg-card px-3 py-2">
                      <span className="font-medium">{tr.name || "—"}</span>
                      {tr.posology && <span className="text-muted-foreground"> · {tr.posology}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">{t("noInsulinSettings")}</p>
        )}
      </CardContent>
    </Card>
  )
}

function SlotBlock({ label, unit, slots }: { label: ReactNode; unit: string; slots: { range: string; value: number }[] }) {
  if (slots.length === 0) return null
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <ul className="mt-1 space-y-1">
        {slots.map((s, i) => (
          <li key={`${s.range}-${i}`} className="flex justify-between tabular-nums">
            <span className="text-muted-foreground">{s.range}</span>
            <span className="font-medium">{s.value} {unit}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Étape 5 — Décisions médicales ────────────────────────────────── */
function DecisionsStep({ data }: { data: ReviewData }) {
  const t = useTranslations("review")
  const tParam = useTranslations("review")
  const tUnits = useTranslations("insulinUnits")
  const locale = useLocale()
  const fmt = (n: number) => n.toLocaleString(bcp47(locale), { maximumFractionDigits: 2 })

  const [items, setItems] = useState<ReviewProposalItem[]>(data.proposals)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = async (id: string, action: "accept" | "reject") => {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/adjustment-proposals/${id}/${action}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "accept" ? { applyImmediately: false } : {}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setItems((prev) => prev.filter((p) => p.id !== id))
    } catch {
      setError(t("decisionError"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="h-4 w-4" aria-hidden="true" />
          {t("decisionsTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("decisionsHint")}</p>
        {!data.canDecide && (
          <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            {t("decisionsReadOnly")}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-glycemia-critical">{error}</p>}

        {items.length === 0 ? (
          <DiabeoEmptyState variant="noData" title={t("decisionsTitle")} message={t("noProposals")} />
        ) : (
          <ul className="space-y-2">
            {items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{tParam(PARAM_LABEL_KEY[p.parameterType])}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t("valueTransition", { from: fmt(p.currentValue), to: fmt(p.proposedValue) })} {tUnits(PARAM_UNIT_KEY[p.parameterType])}
                  </span>
                </span>
                <Badge variant={Math.abs(p.changePercent) >= 20 ? "destructive" : "secondary"}>
                  {p.changePercent > 0 ? `+${Math.round(p.changePercent)}` : Math.round(p.changePercent)}&nbsp;%
                </Badge>
                {data.canDecide && (
                  <span className="flex gap-2">
                    <Button size="sm" variant="default" disabled={busyId === p.id} onClick={() => decide(p.id, "accept")}>
                      {t("accept")}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => decide(p.id, "reject")}>
                      {t("reject")}
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Étape 6 — Compte rendu ───────────────────────────────────────── */
type SaveState = "idle" | "saving" | "saved" | "error"

function ReportStep({ data }: { data: ReviewData }) {
  const t = useTranslations("review")
  const locale = useLocale()
  const [content, setContent] = useState(data.draftReport ?? "")
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [finalized, setFinalized] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const anchorLabel = t("anchorNote", {
    days: data.anchor.periodDays,
    date: new Date(data.anchor.dataAsOf).toLocaleDateString(bcp47(locale), {
      day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris",
    }),
  })

  const saveDraft = useCallback(async (value: string) => {
    setSaveState("saving")
    try {
      const res = await fetch(`/api/encounters/${data.encounterId}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSaveState("saved")
    } catch {
      setSaveState("error")
    }
  }, [data.encounterId])

  // Autosave debounced (1.5s) tant que le compte rendu n'est pas finalisé.
  useEffect(() => {
    if (finalized) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void saveDraft(content) }, 1500)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [content, finalized, saveDraft])

  const finalize = async () => {
    if (!content.trim()) return
    setBusy(true)
    setFinalizeError(null)
    if (timer.current) clearTimeout(timer.current)
    try {
      const res = await fetch(`/api/encounters/${data.encounterId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setFinalized(true)
    } catch {
      setFinalizeError(t("finalizeError"))
    } finally {
      setBusy(false)
    }
  }

  if (finalized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-feedback-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t("finalizedTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p role="status" className="text-sm text-muted-foreground">{t("finalizedNote")}</p>
          <Separator />
          <p className="whitespace-pre-wrap text-sm">{content}</p>
          <p className="text-xs text-muted-foreground">{anchorLabel}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" aria-hidden="true" />
          {t("reportTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label htmlFor="review-report" className="text-sm text-muted-foreground">{t("reportLabel")}</label>
        <textarea
          id="review-report"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          placeholder={t("reportPlaceholder")}
        />
        <p className="text-xs text-muted-foreground">{anchorLabel}</p>
        <div className="flex items-center justify-between gap-3">
          <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {saveState === "saving" && t("saving")}
            {saveState === "saved" && t("saved")}
            {saveState === "error" && <span className="text-glycemia-critical">{t("saveError")}</span>}
          </span>
          <Button onClick={finalize} disabled={busy || !content.trim()}>
            {t("finalize")}
          </Button>
        </div>
        {finalizeError && <p role="alert" className="text-sm text-glycemia-critical">{finalizeError}</p>}
      </CardContent>
    </Card>
  )
}
