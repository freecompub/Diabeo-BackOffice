/**
 * `PatientRecord` — composant **présentational** de la fiche patient (US-2632).
 *
 * Rend l'en-tête contextuel + les onglets à partir d'un DTO **déjà résolu,
 * audité et calculé côté serveur** (aucun calcul clinique ici). Agnostique de
 * la source : la page le câble via une projection RSC (`PatientDetailClient`),
 * le drawer le câblera via `cTok` (US-2633).
 *
 * Les liens construits **dans ce composant** ne portent pas l'id patient : le
 * téléchargement de document passe par le contrat `documentHref` fourni par
 * l'adaptateur (page = `?patientId=`, drawer = jeton `cTok`).
 *
 * ⚠️ `PatientContextBar` (rendu ici) construit encore en interne des liens
 * porteurs de l'id patient (`/patients/[id]/review`, `/messages?patientId=`) ;
 * leur passage à un contrat opaque pour le mode drawer est traité en **US-2633**.
 */

"use client"

import { useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { PatientContextBar } from "@/components/diabeo/patient/PatientContextBar"
import { PeriodSelector } from "@/components/diabeo/patient/PeriodSelector"
import { PatientAgpTab } from "@/components/diabeo/patient/PatientAgpTab"
import { PatientMealTrendsTab } from "@/components/diabeo/patient/PatientMealTrendsTab"
import {
  usePeriodAnalytics,
  usePatientRecordContext,
  PERIOD_LABEL_KEY,
  SEED_PERIOD,
} from "@/components/diabeo/patient/PatientRecordContext"
import { GlycemiaValue, TirDonut, ClinicalBadge, StatCard } from "@/components/diabeo"
import type { TirData } from "@/components/diabeo/TirDonut"
import { Acronym } from "@/components/diabeo/Acronym"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { CgmChart } from "@/components/diabeo/CgmChart"
import { bcp47 } from "@/i18n/config"
// DTO de vue depuis le module neutre co-localisé (US-2632) → composant
// autoportant, aucun import du dossier de route.
import type {
  GlycemiaView, TreatmentView, SlotCoverage, DocumentItem, ContextFlags,
} from "./patient-record-views"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Activity, Clock, Download, FileText, Heart, Pill, Syringe, TrendingUp, User } from "lucide-react"

export type PatientRecordData = {
  id: number
  /** UUID opaque (anti-énumération) pour le switcher. */
  publicRef: string
  name: string
  /** Drapeaux d'alerte de la barre de contexte (cohérents « Ma journée »). */
  flags: ContextFlags
  age: number | null
  sex: "M" | "F" | "X" | null
  pathology: string | null
  diagYear: number | null
  referent: string | null
  objectives: {
    targetLowMgdl: number
    targetHighMgdl: number
    tirTargetPct: number
    hypoMaxPct: number
    cvMaxPct: number
  }
  /** Stats glycémiques calculées serveur ; `null` si aucune donnée CGM. */
  stats: {
    avgGlucoseMgdl: number
    gmi: number
    cv: number
    tir: TirData
    readingCount: number
    captureRate: number
    /** Capture CGM < 70 % → stats non représentatives (caveat clinique). */
    insufficientCapture: boolean
  } | null
  /**
   * Source de données de la fiche (US-2638) — dérivée de la présence d'un
   * capteur (`patientHasCgm`). En `bgm` (glycémie capillaire), la fiche bascule
   * de présentation : jamais d'indicateur CGM-only (TIR-temps, GMI, AGP) qui
   * serait trompeur. Fail-closed.
   */
  dataSource: "cgm" | "bgm"
  /**
   * Stats capillaires — présent UNIQUEMENT si `dataSource === "bgm"` (sinon
   * `null`). Substitutions : **% de relevés en cible** (≠ TIR-temps, biais
   * d'échantillonnage) · **HbA1c labo** datée (≠ GMI/eA1c, jamais calculé en
   * BGM) · **fréquence** (relevés/jour, ≠ taux de capture) · **nuage de points**
   * (≠ courbe continue). Seuils pathology-aware (US-2631).
   */
  bgm: {
    avgMgdl: number | null
    inRangePercent: number | null
    readingsPerDay: number
    targetRangeMgdl: { low: number; high: number }
    hba1c: { value: number; date: string; ageDays: number; stale: boolean } | null
    /** Nuage modal-day : heure du jour (min) × mg/dL. */
    points: { timeMinutes: number; mgdl: number }[]
  } | null
  /** Série CGM 24h (déjà mappée serveur : mg/dL + heure Europe/Paris + fraîcheur). */
  glycemia: GlycemiaView
  /** Réglages insuline (par créneau) + traitements associés. */
  treatment: TreatmentView
  /** Documents médicaux (métadonnées ; téléchargement via route sécurisée). */
  documents: DocumentItem[]
}

/**
 * Mappe la réponse `/api/analytics/glycemic-profile` sur la forme `stats` du DTO
 * (US-2634 — re-fetch période). Miroir EXACT du mapping serveur de
 * `buildPatientRecordData` ; `null` si aucune donnée CGM sur la fenêtre.
 */
function mapProfileToStats(raw: unknown): PatientRecordData["stats"] {
  const p = raw as {
    readingCount: number
    captureRate: number
    warning?: string
    metrics: { averageGlucoseMgdl: number; gmi: number; coefficientOfVariation: number }
    tir: { severeHypo: number; hypo: number; inRange: number; elevated: number; hyper: number }
  }
  if (!p || p.readingCount <= 0) return null
  return {
    avgGlucoseMgdl: p.metrics.averageGlucoseMgdl,
    gmi: p.metrics.gmi,
    cv: p.metrics.coefficientOfVariation,
    tir: {
      veryLow: p.tir.severeHypo,
      low: p.tir.hypo,
      inRange: p.tir.inRange,
      high: p.tir.elevated,
      veryHigh: p.tir.hyper,
    },
    readingCount: p.readingCount,
    captureRate: p.captureRate,
    insufficientCapture: p.warning === "insufficientCgmCapture",
  }
}

/** category enum → clé i18n du libellé. */
const DOC_CATEGORY_KEY: Record<string, string> = {
  general: "docCatGeneral",
  forDoctor: "docCatForDoctor",
  personal: "docCatPersonal",
  prescription: "docCatPrescription",
  labResults: "docCatLabResults",
  other: "docCatOther",
}

export interface PatientRecordProps {
  data: PatientRecordData | null
  sharingDisabled?: boolean
  /**
   * Mode de rendu. `page` (défaut) : chrome plein écran (barre de contexte).
   * `drawer` : intégré au drawer de consultation éphémère — pas de
   * `PatientContextBar` (l'en-tête du drawer porte l'identité + les drapeaux),
   * pas de lien porteur d'id patient.
   */
  variant?: "page" | "drawer"
  /**
   * Construit l'URL de téléchargement d'un document (le composant n'embarque
   * pas l'id patient lui-même). Page → `?patientId=`. **Optionnel** : en mode
   * drawer (jeton `cTok` en en-tête, non plaçable dans un `href`), on omet ce
   * contrat et les documents sont listés sans lien de téléchargement.
   */
  documentHref?: (docId: number) => string
}

export function PatientRecord({
  data,
  sharingDisabled = false,
  variant = "page",
  documentHref,
}: PatientRecordProps) {
  const t = useTranslations("patientDetail")
  // Libellés d'unités de paramètres insuline : source unique partagée avec la
  // carte « propositions » (namespace `insulinUnits`).
  const tUnits = useTranslations("insulinUnits")
  const locale = useLocale()
  const [activeTab, setActiveTab] = useState("overview")

  // US-2634 — KPI « Vue d'ensemble » pilotés par la période sélectionnée.
  // Amorce = projection serveur 14 j (`data.stats`) ; re-fetch debounced si la
  // période change (hook no-op hors provider / à l'amorce → pas de flicker).
  // Appelé inconditionnellement (règles des hooks) AVANT tout early-return.
  const recordCtx = usePatientRecordContext()
  const liveStats = usePeriodAnalytics({
    seed: data?.stats ?? null,
    endpoint: "/api/analytics/glycemic-profile",
    map: mapProfileToStats,
  })
  // Libellé = période RÉELLEMENT affichée (`valuePeriod`), jamais la période
  // demandée : sur erreur/chargement, la donnée d'amorce ne doit jamais porter
  // le libellé d'une autre fenêtre (faux rassurement clinique, revue #610).
  const periodLabel = t(PERIOD_LABEL_KEY[liveStats.valuePeriod])
  const requestedLabel = t(PERIOD_LABEL_KEY[recordCtx?.period ?? SEED_PERIOD])

  // Consentement retiré : aucune donnée patient rendue (cf. page.tsx). En mode
  // drawer, l'en-tête est porté par le drawer → pas de DashboardHeader.
  if (sharingDisabled || !data) {
    return (
      <>
        {variant === "page" && <DashboardHeader title={t("patientFallback")} subtitle="" />}
        <div className={variant === "drawer" ? "" : "p-6"}>
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

  const name = data.name || t("patientFallback")
  const sexLabel = data.sex === "F" ? t("female") : data.sex === "M" ? t("male") : "—"
  const { objectives } = data
  // Stats pilotées par la période (US-2634) — `liveStats.value` = amorce serveur
  // 14 j tant que la période n'a pas changé, sinon retour re-fetché.
  const stats = liveStats.value
  const statsLoading = liveStats.loading
  const statsError = liveStats.error
  // GMI/statistiques non représentatifs sous 14 j (consensus AGP) — caveat
  // affiché même si la capture est bonne (revue médicale #610).
  const shortWindow = liveStats.valuePeriod === "7d"

  return (
    <>
      {/* Mode page : barre de contexte plein écran (liens porteurs d'id patient).
          Mode drawer : omise — l'en-tête du drawer porte l'identité + les
          drapeaux, et aucun lien d'id ne doit fuiter (anti-énumération). */}
      {variant === "page" && (
        <PatientContextBar
          patientId={data.id}
          name={name}
          age={data.age}
          pathology={data.pathology}
          referent={data.referent}
          flags={data.flags}
          showStartConsultation
        />
      )}

      <div className={variant === "drawer" ? "" : "p-6"}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6" aria-label={t("tabsAriaLabel")}>
            <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
            <TabsTrigger value="glycemicProfile">{t("tabGlycemicProfile")}</TabsTrigger>
            <TabsTrigger value="mealTrends">{t("tabMealTrends")}</TabsTrigger>
            <TabsTrigger value="glycemia">{t("tabGlycemia")}</TabsTrigger>
            <TabsTrigger value="treatment">{t("tabTreatment")}</TabsTrigger>
            <TabsTrigger value="documents">{t("tabDocuments")}</TabsTrigger>
          </TabsList>

          {/* ── Vue d'ensemble (câblée) ─────────────────────── */}
          <TabsContent value="overview" className="space-y-6">
            {/* Sélecteur de période (US-2634) — synchronisé entre onglets via
                le contexte ; pilote les KPI ci-dessous (re-fetch debounced). */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span id="period-selector-label" className="text-sm font-medium text-muted-foreground">
                {t("periodSelectorLabel")}
              </span>
              <PeriodSelector labelledBy="period-selector-label" />
            </div>
            {/* Annonce lecteurs d'écran du (re)chargement des KPI (WCAG 4.1.3).
                En erreur, on n'annonce PAS « mis à jour » : le bandeau role=alert
                ci-dessous porte le message (pas de double annonce trompeuse). */}
            <p className="sr-only" role="status" aria-live="polite">
              {statsLoading ? t("periodLoading") : statsError ? "" : t("periodLoaded", { period: periodLabel })}
            </p>
            {/* Échec de re-fetch : la donnée affichée est retombée sur l'amorce
                (`periodLabel`) — on le signale, jamais un libellé trompeur. */}
            {statsError && (
              <p
                role="alert"
                className="rounded-md border border-feedback-error bg-error-bg px-4 py-2 text-sm text-error-fg"
              >
                {t("periodRefetchError", { requested: requestedLabel, shown: periodLabel })}
              </p>
            )}
            {/* Représentativité : fenêtre < 14 j → GMI/stats indicatifs. */}
            {stats && shortWindow && (
              <p
                role="status"
                className="rounded-md border border-feedback-warning bg-warning-bg px-4 py-2 text-sm text-warning-fg"
              >
                {t("shortWindowCaveat")}
              </p>
            )}
            {stats?.insufficientCapture && (
              <p
                role="status"
                className="rounded-md border border-feedback-warning bg-warning-bg px-4 py-2 text-sm text-warning-fg"
              >
                {t("lowCaptureWarning", { rate: Math.round(stats.captureRate) })}
              </p>
            )}
            {stats ? (
              <div
                aria-busy={statsLoading}
                className={cn(
                  "grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-4",
                  statsLoading && "opacity-60",
                )}
              >
                <StatCard
                  label={t("avgGlucosePeriod", { period: periodLabel })}
                  value={String(stats.avgGlucoseMgdl)}
                  unit="mg/dL"
                  icon={<Activity className="h-5 w-5" />}
                  variant="default"
                />
                <StatCard
                  label={t("kpiTirPeriod", { period: periodLabel })}
                  value={`${Math.round(stats.tir.inRange)}%`}
                  icon={<TrendingUp className="h-5 w-5" />}
                  variant={stats.tir.inRange >= objectives.tirTargetPct ? "success" : "warning"}
                />
                <StatCard
                  label={t("kpiGmiPeriod", { period: periodLabel })}
                  value={`${stats.gmi}%`}
                  icon={<Heart className="h-5 w-5" />}
                  variant="default"
                />
                <StatCard
                  label={t("kpiCvPeriod", { period: periodLabel })}
                  value={`${stats.cv}%`}
                  icon={<Clock className="h-5 w-5" />}
                  variant={stats.cv <= objectives.cvMaxPct ? "success" : "warning"}
                />
              </div>
            ) : (
              <Card>
                <CardContent className="py-6">
                  <p className="text-sm text-muted-foreground">{t("noCgmData")}</p>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <User className="h-4 w-4" aria-hidden="true" />
                    {t("profileTitle")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">{t("pathology")}</span>
                      <div className="mt-1">
                        {data.pathology ? (
                          <ClinicalBadge type="pathology" value={data.pathology} />
                        ) : (
                          <span className="font-medium">—</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("diagnostic")}</span>
                      <p className="mt-1 font-medium">{data.diagYear ?? "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("sex")}</span>
                      <p className="mt-1 font-medium">{sexLabel}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("age")}</span>
                      <p className="mt-1 font-medium">
                        {data.age !== null ? t("ageValue", { age: data.age }) : "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("referentDoctor")}</span>
                      <p className="mt-1 font-medium">{data.referent ?? "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("avgGlucosePeriod", { period: periodLabel })}</span>
                      <div className="mt-1">
                        {stats ? (
                          <GlycemiaValue value={stats.avgGlucoseMgdl} unit="mg/dL" size="sm" />
                        ) : (
                          <span className="font-medium">—</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <Separator className="my-4" />

                  <div className="text-sm">
                    <span className="text-muted-foreground">{t("glycemicObjectives")}</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {t("targetBadge", {
                          low: objectives.targetLowMgdl,
                          high: objectives.targetHighMgdl,
                        })}
                      </Badge>
                      <Badge variant="outline">
                        {t("tirTargetBadge", { target: objectives.tirTargetPct })}
                      </Badge>
                      <Badge variant="outline">
                        {t("hypoMaxBadge", { target: objectives.hypoMaxPct })}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    <Acronym code="TIR" /> {t("tirDonutPeriodLabel", { period: periodLabel })}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center">
                  {stats ? (
                    <TirDonut data={stats.tir} size={180} showLegend />
                  ) : (
                    <p className="py-8 text-sm text-muted-foreground">{t("noCgmData")}</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Profil glycémique (AGP — US-2635, natif page + drawer) ──────── */}
          <TabsContent value="glycemicProfile" className="space-y-6">
            <PatientAgpTab
              targetLowMgdl={objectives.targetLowMgdl}
              targetHighMgdl={objectives.targetHighMgdl}
            />
          </TabsContent>

          {/* ── Tendances de repas (US-2637, natif page + drawer) ──────── */}
          <TabsContent value="mealTrends" className="space-y-6">
            <PatientMealTrendsTab />
          </TabsContent>

          {/* ── Glycémie (câblée — Phase 2) ─────────────────── */}
          <TabsContent value="glycemia" className="space-y-6">
            {/* Sécurité clinique : un relevé plus récent que l'affiché est hors
                plage et a été exclu de la série (hypo sévère < 40 / capteur
                LOW-HIGH) → bannière prioritaire, même sans relevé affichable. */}
            {data.glycemia.recentOutOfRange && (
              <p
                // LOW = urgence actionnable (assertif) ; HIGH = important mais
                // non seconde-critique (poli) — cf. revue clinique PR #555.
                role={data.glycemia.recentOutOfRange === "low" ? "alert" : "status"}
                className="rounded-md border border-feedback-warning bg-warning-bg px-4 py-2 text-sm text-warning-fg"
              >
                {data.glycemia.recentOutOfRange === "low"
                  ? t("recentOutOfRangeLow")
                  : t("recentOutOfRangeHigh")}
              </p>
            )}
            {data.glycemia.points.length > 0 ? (
              <>
                {data.glycemia.lastReadingMgdl !== null && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Activity className="h-4 w-4" aria-hidden="true" />
                        {t("lastReading")}
                        {data.glycemia.lastReadingAt && (
                          <span className="text-xs font-normal text-muted-foreground">
                            {t("lastReadingAt", { time: data.glycemia.lastReadingAt })}
                            {data.glycemia.lastReadingAgeMin !== null && (
                              <> · {ageLabel(t, data.glycemia.lastReadingAgeMin)}</>
                            )}
                          </span>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {/* Pastille couleur sur les MÊMES cibles que le graphe (cgm.low/ok) ;
                          les zones sévères (54/250) restent les seuils physiologiques. */}
                      <GlycemiaValue
                        value={data.glycemia.lastReadingMgdl}
                        unit="mg/dL"
                        thresholds={{ low: objectives.targetLowMgdl, high: objectives.targetHighMgdl }}
                      />
                      {data.glycemia.stale && (
                        <p role="status" className="text-xs text-warning-fg">
                          {t("staleReadingNote")}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Activity className="h-4 w-4" aria-hidden="true" />
                      {t("glycemicProfile24h")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CgmChart
                      data={data.glycemia.points}
                      targetLow={objectives.targetLowMgdl}
                      targetHigh={objectives.targetHighMgdl}
                    />
                    {/* Réconcilie courbe ↔ stats : les relevés hors plage
                        d'affichage ne sont pas tracés mais comptent dans le TIR
                        (cf. revue PR #557). */}
                    {data.glycemia.outOfDisplayRangeCount > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t("outOfDisplayRangeNote", { count: data.glycemia.outOfDisplayRangeCount })}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="py-10">
                  <DiabeoEmptyState variant="noData" title={t("tabGlycemia")} message={t("noCgmData")} />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Traitements (câblé — Phase 3) ───────────────── */}
          <TabsContent value="treatment" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Syringe className="h-4 w-4" aria-hidden="true" />
                  {t("insulinConfigTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.treatment.hasSettings ? (
                  <div className="space-y-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">{t("method")}</span>
                      <p className="mt-1 font-medium">
                        {data.treatment.deliveryMethod === "pump" ? t("deliveryPump") : t("deliveryManual")}
                      </p>
                    </div>
                    {data.treatment.bolusInsulin && (
                      <div>
                        <span className="text-muted-foreground">{t("bolusInsulinLabel")}</span>
                        <p className="mt-1 font-medium">
                          {data.treatment.bolusInsulin.name}
                          {data.treatment.bolusInsulin.genericName && (
                            <span className="font-normal text-muted-foreground">
                              {" · "}
                              {data.treatment.bolusInsulin.genericName}
                            </span>
                          )}
                          {data.treatment.bolusInsulin.dosage && (
                            <span className="font-normal text-muted-foreground">
                              {" · "}
                              {data.treatment.bolusInsulin.dosage}
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                    {/* FK bolus renseignée mais incohérente (inactive / terminée /
                        usage non-bolus) → indice non bloquant pour ne pas laisser
                        croire à l'absence d'insuline bolus (revue PR #554). */}
                    {data.treatment.bolusInconsistent && (
                      <div>
                        <span className="text-muted-foreground">{t("bolusInsulinLabel")}</span>
                        <p role="status" className="mt-1 text-xs text-warning-fg">
                          {t("bolusInconsistentNote")}
                        </p>
                      </div>
                    )}
                    {/* Pompe affichée uniquement si la méthode déclarée est « pompe »
                        (cohérence : ne pas présenter un device appairé comme la voie
                        active pour un patient sous stylo). Méthode pompe sans device
                        → « aucune pompe appairée ». */}
                    {data.treatment.deliveryMethod === "pump" && (
                      <div>
                        <span className="text-muted-foreground">{t("pumpModelLabel")}</span>
                        {data.treatment.pump ? (
                          <p className="mt-1 font-medium">
                            {data.treatment.pump.label}
                            {data.treatment.pump.syncStale && (
                              <span className="font-normal text-warning-fg">
                                {" · "}
                                {t("pumpSyncStale")}
                              </span>
                            )}
                          </p>
                        ) : (
                          <p className="mt-1 font-medium text-muted-foreground">{t("noPairedPump")}</p>
                        )}
                      </div>
                    )}
                    {data.treatment.isfSlots.length > 0 && (
                      <SlotList
                        label={<Acronym code="ISF" />}
                        unit={tUnits("isfGl")}
                        slots={data.treatment.isfSlots}
                        coverage={data.treatment.isfCoverage}
                        family="ratio"
                      />
                    )}
                    {data.treatment.icrSlots.length > 0 && (
                      <SlotList
                        label={<Acronym code="ICR" />}
                        unit={tUnits("icr")}
                        slots={data.treatment.icrSlots}
                        coverage={data.treatment.icrCoverage}
                        family="ratio"
                      />
                    )}
                    {data.treatment.basalSlots.length > 0 && (
                      <SlotList
                        label={t("basalLabel")}
                        unit={tUnits("basal")}
                        slots={data.treatment.basalSlots.map((b) => ({ range: b.range, value: b.rate }))}
                        coverage={data.treatment.basalCoverage}
                        family="basal"
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noInsulinSettings")}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Pill className="h-4 w-4" aria-hidden="true" />
                  {t("associatedTreatmentsTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.treatment.treatments.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {data.treatment.treatments.map((tr) => (
                      <li key={tr.id} className="rounded-md border border-border bg-card px-3 py-2">
                        <span className="font-medium">{tr.name || "—"}</span>
                        {tr.posology && <span className="text-muted-foreground"> · {tr.posology}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noComplementaryTreatment")}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Documents (câblé — Phase 4) ─────────────────── */}
          <TabsContent value="documents" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  {t("medicalDocumentsTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.documents.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {data.documents.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                      >
                        <FileText size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{doc.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {doc.category ? t(DOC_CATEGORY_KEY[doc.category] ?? "uncategorized") : t("uncategorized")}
                            {" · "}
                            {new Date(doc.dateIso).toLocaleDateString(bcp47(locale), {
                              day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris",
                            })}
                            {doc.size && ` · ${doc.size.value} ${t(doc.size.unitKey)}`}
                          </span>
                        </span>
                        {/* Lien de téléchargement uniquement si un contrat
                            d'URL est fourni (mode page). En mode drawer, le
                            scope passe par le jeton `cTok` en en-tête, non
                            plaçable dans un `href` → document listé sans lien. */}
                        {documentHref && (
                          <a
                            href={documentHref(doc.id)}
                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted"
                          >
                            <Download size={14} aria-hidden="true" />
                            {t("download")}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noDocument")}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

/** Liste de créneaux horaires « plage · valeur unité » (ISF / ICR / basal). */
function SlotList({
  label,
  unit,
  slots,
  coverage,
  family,
}: {
  label: ReactNode
  unit: string
  slots: { range: string; value: number }[]
  coverage?: SlotCoverage
  /** "ratio" = ISF/ICR (trou = config à vérifier) ; "basal" = pompe (24 h requis). */
  family?: "ratio" | "basal"
}) {
  const t = useTranslations("patientDetail")
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <ul className="mt-1 space-y-1">
        {slots.map((s, i) => (
          <li key={`${s.range}-${i}`} className="flex justify-between tabular-nums">
            <span className="text-muted-foreground">{s.range}</span>
            <span className="font-medium">
              {s.value} {unit}
            </span>
          </li>
        ))}
      </ul>
      {/* Garde-fou structurel non bloquant (lignes indépendantes). Trou : pour
          ISF/ICR une heure non couverte est gérée fail-closed au calcul de bolus
          (findSlotForHour → undefined → l'appelant lève), donc ici simple
          « config à vérifier » ; pour le basal pompe une heure non couverte est
          plus significative. Chevauchement : déjà rejeté au write-path ISF/ICR,
          donc canari d'intégrité (donnée legacy/import). */}
      {coverage?.hasGap && (
        <p role="status" className="mt-1 text-xs text-warning-fg">
          {family === "basal" ? t("slotGapNoteBasal") : t("slotGapNote")}
        </p>
      )}
      {coverage?.hasOverlap && (
        <p role="status" className="mt-1 text-xs text-warning-fg">
          {t("slotOverlapNote")}
        </p>
      )}
    </div>
  )
}

/** Âge du dernier relevé en libellé relatif (< 60 min → minutes, sinon heures). */
function ageLabel(t: ReturnType<typeof useTranslations>, ageMin: number): string {
  return ageMin < 60 ? t("agoMinutes", { n: ageMin }) : t("agoHours", { n: Math.floor(ageMin / 60) })
}

