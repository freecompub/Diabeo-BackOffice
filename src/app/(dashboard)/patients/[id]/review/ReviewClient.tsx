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
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import type { AdjustableParameter, ProposalSource } from "@prisma/client"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { PatientContextBar, type ContextFlags } from "@/components/diabeo/patient/PatientContextBar"
import { GlycemiaValue, TirDonut, ClinicalBadge, StatCard } from "@/components/diabeo"
import type { TirData } from "@/components/diabeo/TirDonut"
import { Acronym } from "@/components/diabeo/Acronym"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { CgmChart } from "@/components/diabeo/CgmChart"
import { bcp47 } from "@/i18n/config"
import type { GlycemiaView } from "../glycemia-view"
import type { TreatmentView } from "@/lib/insulin/treatment-view"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ProposalList } from "@/components/diabeo/patient/ProposalList"
import { deriveCoexistsWith } from "@/lib/insulin/proposal-coexistence"
import { GroupedProposalReview, type ReviewGroupedViewItem } from "@/components/diabeo/patient/GroupedProposalReview"
import { Separator } from "@/components/ui/separator"
import {
  Activity, CheckCircle2, ClipboardList, FileText, HeartPulse, Pill, Stethoscope, Syringe,
} from "lucide-react"

export type ReviewProposalItem = {
  id: string
  parameterType: AdjustableParameter
  /** Provenance dérivée serveur (US-2649b) — pilote l'affichage de fiabilité (≠ confidence moteur). */
  source: ProposalSource
  /** Snapshot de la valeur courante à la CRÉATION de la proposition. */
  currentValue: number
  /** Valeur courante LIVE re-lue à l'ouverture de la revue (null si créneau introuvable).
   *  Si ≠ `currentValue`, la config a changé depuis la proposition → l'UI avertit. */
  liveCurrentValue: number | null
  proposedValue: number
  changePercent: number
  reason: string
  // US-2646 — nullable : une proposition humaine (patient/infirmier) n'a pas de confiance moteur.
  confidence: string | null
  timeSlotStartHour: number | null
  timeSlotEndHour: number | null
  /** US-2659 — cible d'une basale STYLO (daily/morning/evening) : non-null ⇒ dose en U TOTALES (pas U/h). */
  basalDoseKind: string | null
  /** US-2662 — dose basale STYLO proposée au-delà du seuil d'AVERTISSEMENT `MDI_BASAL_WARN_U` (80 U).
   *  Dérivé SERVEUR (aucune borne clinique côté client). Non bloquant : signale au médecin une dose élevée. */
  highDoseWarning: boolean
  createdAt: string
}

/**
 * US-2663 (S2) — item d'une proposition GROUPÉE (`SlotSetProposal`) PENDING pour la revue médecin. Diff
 * PRÉ-CALCULÉ serveur (`page.tsx`, via `src/lib/insulin/slot-diff.ts` + `isBaselineUnchanged`) : le client ne
 * fait aucun calcul clinique, seulement le rendu (cf. `GroupedProposalReview`).
 */
export type ReviewGroupedItem = ReviewGroupedViewItem

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
  /** US-2663 (S2) — propositions GROUPÉES (`SlotSetProposal`) PENDING, avec diff pré-calculé serveur. */
  groupedProposals: ReviewGroupedItem[]
  /** US-2659 (S3) — types de `ClinicalReviewFlag` OUVERTS du patient (dont `nocturnalHypoHighFasting` =
   *  Somogyi). Surface le contexte hypo AVANT une décision de BAISSE basale (jamais de posologie). */
  reviewFlags: string[]
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
        backHref={`/patients/${data.patient.id}`}
        backLabelKey="backToDossier"
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
/** Type de flag → clé i18n `reviewFlags.flag<PascalCase>` (source unique des libellés). */
const flagLabelKey = (type: string) => `flag${type.charAt(0).toUpperCase()}${type.slice(1)}`

function DecisionsStep({ data }: { data: ReviewData }) {
  const t = useTranslations("review")
  const tFlags = useTranslations("reviewFlags")
  const router = useRouter()

  const [items, setItems] = useState<ReviewProposalItem[]>(data.proposals)
  const [groupedItems, setGroupedItems] = useState<ReviewGroupedItem[]>(data.groupedProposals)
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

  // US-2663 (S2) — décision sur une proposition GROUPÉE (`SlotSetProposal`). Un 409 `baselineMoved`/
  // `baselineMissing` (base dérivée depuis la génération, cf. `assertBaselineUnchanged`) retombe ici : le
  // bandeau d'avertissement `GroupedProposalReview` prévenait déjà le médecin AVANT la tentative.
  const decideGrouped = async (id: string, action: "accept" | "reject") => {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/slot-set-proposals/${id}/${action}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // US-2663 (S3b-0b, revue CR) — retirer l'item décidé PUIS recalculer la coexistence : la proposition
      // SŒUR restante n'a plus de coexistence → son bandeau « une autre proposition existe » doit disparaître
      // (sans attendre un reload serveur). `deriveCoexistsWith` est un helper PUR, réutilisable côté client.
      setGroupedItems((prev) => {
        const next = prev.filter((p) => p.id !== id)
        const coex = deriveCoexistsWith(next)
        return next.map((p) => ({ ...p, coexistsWith: coex.get(p.id) ?? null }))
      })
      // US-2663 (S3b-0b, revue LOW-2) — accepter/rejeter une proposition GROUPÉE modifie la config (apply) →
      // la proposition SŒUR coexistante devient périmée (`baselineDrifted`). Réconcilier l'état SERVEUR (le
      // diff/`baselineDrifted` sont pré-calculés serveur) : la sœur ressort avec Accepter désactivé, sans
      // attendre un 409 à la tentative. Le retrait optimiste ci-dessus garde l'UX instantanée entre-temps.
      router.refresh()
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
        {/* US-2659 (S3) — orientations OUVERTES (dont Somogyi `nocturnalHypoHighFasting`) : contexte hypo à
            voir AVANT d'accepter une BAISSE basale (une baisse sur un Somogyi est le mauvais geste). */}
        {data.reviewFlags.length > 0 && (
          <div role="alert" className="rounded-md border border-feedback-warning bg-warning-bg px-3 py-2 text-xs text-warning-fg">
            <p className="font-medium">{tFlags("title")}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {data.reviewFlags.map((f) => (
                <li key={f}>{tFlags(flagLabelKey(f))}</li>
              ))}
            </ul>
          </div>
        )}
        {!data.canDecide && (
          <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            {t("decisionsReadOnly")}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-glycemia-critical">{error}</p>}

        {items.length === 0 && groupedItems.length === 0 ? (
          <DiabeoEmptyState variant="noData" title={t("decisionsTitle")} message={t("noProposals")} />
        ) : (
          <>
            {groupedItems.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">{t("groupedProposalsTitle")}</h3>
                {/* US-2663 (S2) — propositions GROUPÉES (`SlotSetProposal`), diff surligné ancien→nouveau. */}
                <GroupedProposalReview
                  items={groupedItems}
                  canDecide={data.canDecide}
                  busyId={busyId}
                  onDecide={decideGrouped}
                />
              </div>
            )}
            {items.length > 0 && (
              // US-2664 — composant de proposition UNIFIÉ (même rendu que patient/infirmière, audience clinicien).
              <ProposalList audience="clinician" items={items} canDecide={data.canDecide} busyId={busyId} onDecide={decide} />
            )}
          </>
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
  // `dirty` : n'autosave qu'après une vraie modification (pas au montage d'un
  // brouillon repris → évite une ligne d'audit HDS « fantôme »).
  const dirty = useRef(false)
  // Séquencement des autosaves : annule la requête en vol + ignore les réponses
  // périmées (ordre d'arrivée ≠ ordre d'émission sur réseau lent).
  const saveCtrl = useRef<AbortController | null>(null)
  const saveSeq = useRef(0)

  const anchorLabel = t("anchorNote", {
    days: data.anchor.periodDays,
    date: new Date(data.anchor.dataAsOf).toLocaleDateString(bcp47(locale), {
      day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris",
    }),
  })

  const saveDraft = useCallback(async (value: string) => {
    saveCtrl.current?.abort()
    const ctrl = new AbortController()
    saveCtrl.current = ctrl
    const seq = ++saveSeq.current
    setSaveState("saving")
    try {
      const res = await fetch(`/api/encounters/${data.encounterId}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
        signal: ctrl.signal,
      })
      if (seq !== saveSeq.current) return // réponse périmée → ignorée
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSaveState("saved")
    } catch {
      if (ctrl.signal.aborted || seq !== saveSeq.current) return // annulée/périmée
      setSaveState("error")
    }
  }, [data.encounterId])

  // Autosave debounced (1.5s) tant que le compte rendu n'est pas finalisé.
  useEffect(() => {
    if (finalized || !dirty.current) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void saveDraft(content) }, 1500)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [content, finalized, saveDraft])

  const onChange = (value: string) => {
    dirty.current = true
    setContent(value)
  }

  const finalize = async () => {
    if (!content.trim()) return
    setBusy(true)
    setFinalizeError(null)
    // Coupe tout autosave (timer + requête en vol) : un PATCH tardif arriverait
    // après la clôture (rejeté 409) et peindrait un faux « échec d'enregistrement ».
    if (timer.current) clearTimeout(timer.current)
    saveSeq.current++ // invalide toute réponse d'autosave encore en vol
    saveCtrl.current?.abort()
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
          onChange={(e) => onChange(e.target.value)}
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
