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
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { PatientContextBar, type ContextFlags } from "@/components/diabeo/patient/PatientContextBar"
import { GlycemiaValue, TirDonut, ClinicalBadge, StatCard } from "@/components/diabeo"
import type { TirData } from "@/components/diabeo/TirDonut"
import { Acronym } from "@/components/diabeo/Acronym"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { CgmChart } from "@/components/diabeo/CgmChart"
import { bcp47 } from "@/i18n/config"
// DTO de vue depuis le module neutre co-localisé (US-2632) → composant
// autoportant, aucun import du dossier de route.
import type {
  GlycemiaView, TreatmentView, SlotCoverage, DocumentItem,
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
  /** Série CGM 24h (déjà mappée serveur : mg/dL + heure Europe/Paris + fraîcheur). */
  glycemia: GlycemiaView
  /** Réglages insuline (par créneau) + traitements associés. */
  treatment: TreatmentView
  /** Documents médicaux (métadonnées ; téléchargement via route sécurisée). */
  documents: DocumentItem[]
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
   * Construit l'URL de téléchargement d'un document (le composant n'embarque
   * pas l'id patient lui-même). Page → `?patientId=`, drawer → jeton `cTok`.
   */
  documentHref: (docId: number) => string
}

export function PatientRecord({
  data,
  sharingDisabled = false,
  documentHref,
}: PatientRecordProps) {
  const t = useTranslations("patientDetail")
  // Libellés d'unités de paramètres insuline : source unique partagée avec la
  // carte « propositions » (namespace `insulinUnits`).
  const tUnits = useTranslations("insulinUnits")
  const locale = useLocale()
  const [activeTab, setActiveTab] = useState("overview")

  // Consentement retiré : aucune donnée patient rendue (cf. page.tsx).
  if (sharingDisabled || !data) {
    return (
      <>
        <DashboardHeader title={t("patientFallback")} subtitle="" />
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

  const name = data.name || t("patientFallback")
  const sexLabel = data.sex === "F" ? t("female") : data.sex === "M" ? t("male") : "—"
  const { stats, objectives } = data

  return (
    <>
      <PatientContextBar
        patientId={data.id}
        name={name}
        age={data.age}
        pathology={data.pathology}
        referent={data.referent}
        flags={data.flags}
        showStartConsultation
      />

      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6" aria-label={t("tabsAriaLabel")}>
            <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
            <TabsTrigger value="glycemia">{t("tabGlycemia")}</TabsTrigger>
            <TabsTrigger value="treatment">{t("tabTreatment")}</TabsTrigger>
            <TabsTrigger value="documents">{t("tabDocuments")}</TabsTrigger>
          </TabsList>

          {/* ── Vue d'ensemble (câblée) ─────────────────────── */}
          <TabsContent value="overview" className="space-y-6">
            {stats?.insufficientCapture && (
              <p
                role="status"
                className="rounded-md border border-feedback-warning bg-warning-bg px-4 py-2 text-sm text-warning-fg"
              >
                {t("lowCaptureWarning", { rate: Math.round(stats.captureRate) })}
              </p>
            )}
            {stats ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label={t("avgGlucose14d")}
                  value={String(stats.avgGlucoseMgdl)}
                  unit="mg/dL"
                  icon={<Activity className="h-5 w-5" />}
                  variant="default"
                />
                <StatCard
                  label={t("kpiTir14d")}
                  value={`${Math.round(stats.tir.inRange)}%`}
                  icon={<TrendingUp className="h-5 w-5" />}
                  variant={stats.tir.inRange >= objectives.tirTargetPct ? "success" : "warning"}
                />
                <StatCard
                  label={t("kpiGmi")}
                  value={`${stats.gmi}%`}
                  icon={<Heart className="h-5 w-5" />}
                  variant="default"
                />
                <StatCard
                  label={t("kpiCv")}
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
                      <span className="text-muted-foreground">{t("avgGlucose14d")}</span>
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
                    <Acronym code="TIR" /> {t("tirDonutPeriod")}
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
                        <a
                          href={documentHref(doc.id)}
                          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted"
                        >
                          <Download size={14} aria-hidden="true" />
                          {t("download")}
                        </a>
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

