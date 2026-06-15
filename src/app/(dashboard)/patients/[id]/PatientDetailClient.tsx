/**
 * Dossier patient — vue client (onglets + rendu).
 *
 * Reçoit les données déjà résolues/auditées par le Server Component parent
 * (`page.tsx`). Ne fait AUCUN calcul clinique : rend les valeurs serveur.
 * Phase 1 : onglet « Vue d'ensemble » câblé ; Glycémie / Traitements /
 * Documents → état « bientôt disponible » (phases suivantes).
 */

"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { GlycemiaValue, TirDonut, ClinicalBadge, StatCard } from "@/components/diabeo"
import type { TirData } from "@/components/diabeo/TirDonut"
import { Acronym } from "@/components/diabeo/Acronym"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Activity, Clock, Heart, TrendingUp, User } from "lucide-react"

export type PatientDetailData = {
  id: number
  name: string
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
  }
  /** Stats glycémiques calculées serveur ; `null` si aucune donnée CGM. */
  stats: {
    avgGlucoseMgdl: number
    gmi: number
    cv: number
    tir: TirData
    readingCount: number
  } | null
}

export function PatientDetailClient({ data }: { data: PatientDetailData }) {
  const t = useTranslations("patientDetail")
  const [activeTab, setActiveTab] = useState("overview")

  const name = data.name || t("patientFallback")
  const sexLabel = data.sex === "F" ? t("female") : data.sex === "M" ? t("male") : "—"
  const { stats, objectives } = data

  return (
    <>
      <DashboardHeader
        title={name}
        subtitle={t("subtitle", {
          pathology: data.pathology ?? "—",
          age: data.age ?? "—",
          referent: data.referent ?? "—",
        })}
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
                  label={t("kpiTir7d")}
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
                  variant={stats.cv <= 36 ? "success" : "warning"}
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

          {/* ── Glycémie / Traitements / Documents (phases suivantes) ── */}
          <TabsContent value="glycemia">
            <ComingSoon t={t} />
          </TabsContent>
          <TabsContent value="treatment">
            <ComingSoon t={t} />
          </TabsContent>
          <TabsContent value="documents">
            <ComingSoon t={t} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

function ComingSoon({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <Card>
      <CardContent className="py-10">
        <DiabeoEmptyState variant="noData" title={t("comingSoon")} message={t("comingSoonDesc")} />
      </CardContent>
    </Card>
  )
}
