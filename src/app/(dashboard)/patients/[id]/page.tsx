"use client"

/**
 * Patient detail page — US-802.
 *
 * Full patient view with tabs:
 * - Vue d'ensemble (profile, objectives, TIR donut)
 * - Glycemie (CGM chart — US-803)
 * - Traitements (insulin settings, devices)
 * - Documents
 *
 * Uses design system: GlycemiaValue, TirDonut, ClinicalBadge, StatCard, AlertBanner.
 */

import { useState } from "react"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import {
  GlycemiaValue,
  TirDonut,
  ClinicalBadge,
  StatCard,
} from "@/components/diabeo"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
  Activity,
  Calendar,
  Clock,
  Heart,
  Pill,
  Syringe,
  TrendingUp,
  User,
} from "lucide-react"
import { CgmChart } from "@/components/diabeo/CgmChart"

// DEMO DATA — synthetic, no real PII
const DEMO_PATIENT = {
  id: 1,
  name: "Patient DT1-001",
  age: 34,
  sex: "F",
  pathology: "DT1" as const,
  diagYear: 2015,
  referent: "Service diabétologie — CH Demo",
  lastGlucoseMgdl: 127,
  gmi: 7.1,
  cv: 34.2,
  avgGlucoseMgdl: 158,
  tir: { veryLow: 1, low: 3, inRange: 75, high: 17, veryHigh: 4 },
  insulinSettings: {
    delivery: "Pompe",
    pump: "INSULET OMNIPOD Dash",
    bolusInsulin: "FIASP 100 U/mL",
    basalRate: "0.8 U/h (moy.)",
    icr: "10 g/U (moy.)",
    isf: "0.30 g/L/U (moy.)",
  },
  objectives: {
    targetLow: 70,
    targetHigh: 180,
    tirTarget: 70,
    hypoTarget: 4,
  },
}

// Demo CGM data (24h)
const DEMO_CGM = Array.from({ length: 288 }, (_, i) => {
  const hour = (i * 5) / 60
  const base = 130 + 40 * Math.sin((hour - 8) * Math.PI / 6)
  const noise = (Math.sin(i * 0.7) + Math.cos(i * 1.3)) * 15
  return {
    time: `${String(Math.floor(hour) % 24).padStart(2, "0")}:${String((i * 5) % 60).padStart(2, "0")}`,
    glucose: Math.round(Math.max(40, Math.min(350, base + noise))),
  }
})

export default function PatientDetailPage() {
  const [activeTab, setActiveTab] = useState("overview")
  const patient = DEMO_PATIENT

  return (
    <>
      <DashboardHeader
        title={patient.name}
        subtitle={`${patient.pathology} — ${patient.age} ans — Suivi par ${patient.referent}`}
      />

      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6" aria-label="Sections du dossier patient">
            <TabsTrigger value="overview">Vue d&apos;ensemble</TabsTrigger>
            <TabsTrigger value="glycemia">Glycemie</TabsTrigger>
            <TabsTrigger value="treatment">Traitements</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          {/* ── Overview Tab ──────────────────────────────── */}
          <TabsContent value="overview" className="space-y-6">
            {/* KPI row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Glycemie actuelle"
                value={String(patient.lastGlucoseMgdl)}
                unit="mg/dL"
                icon={<Activity className="h-5 w-5" />}
                variant="success"
              />
              <StatCard
                label="TIR (7j)"
                value={`${patient.tir.inRange}%`}
                icon={<TrendingUp className="h-5 w-5" />}
                variant={patient.tir.inRange >= 70 ? "success" : "warning"}
              />
              <StatCard
                label="GMI"
                value={`${patient.gmi}%`}
                icon={<Heart className="h-5 w-5" />}
                variant="default"
              />
              <StatCard
                label="CV"
                value={`${patient.cv}%`}
                icon={<Clock className="h-5 w-5" />}
                variant={patient.cv <= 36 ? "success" : "warning"}
              />
            </div>

            {/* Profile + TIR */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Profile card */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <User className="h-4 w-4" aria-hidden="true" />
                    Profil patient
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-[var(--color-muted-foreground)]">Pathologie</span>
                      <div className="mt-1">
                        <ClinicalBadge type="pathology" value={patient.pathology} />
                      </div>
                    </div>
                    <div>
                      <span className="text-[var(--color-muted-foreground)]">Diagnostic</span>
                      <p className="mt-1 font-medium">{patient.diagYear}</p>
                    </div>
                    <div>
                      <span className="text-[var(--color-muted-foreground)]">Sexe</span>
                      <p className="mt-1 font-medium">{patient.sex === "F" ? "Femme" : "Homme"}</p>
                    </div>
                    <div>
                      <span className="text-[var(--color-muted-foreground)]">Age</span>
                      <p className="mt-1 font-medium">{patient.age} ans</p>
                    </div>
                    <div>
                      <span className="text-[var(--color-muted-foreground)]">Medecin referent</span>
                      <p className="mt-1 font-medium">{patient.referent}</p>
                    </div>
                    <div>
                      <span className="text-[var(--color-muted-foreground)]">Glycemie moyenne (14j)</span>
                      <div className="mt-1">
                        <GlycemiaValue value={patient.avgGlucoseMgdl} unit="mg/dL" size="sm" />
                      </div>
                    </div>
                  </div>

                  <Separator className="my-4" />

                  <div className="text-sm">
                    <span className="text-[var(--color-muted-foreground)]">Objectifs glycemiques</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">
                        Cible : {patient.objectives.targetLow}–{patient.objectives.targetHigh} mg/dL
                      </Badge>
                      <Badge variant="outline">
                        TIR cible : {patient.objectives.tirTarget}%
                      </Badge>
                      <Badge variant="outline">
                        Hypo max : {patient.objectives.hypoTarget}%
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* TIR Donut */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">TIR (7 jours)</CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center">
                  <TirDonut
                    data={patient.tir}
                    size={180}
                    showLegend
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Glycemia Tab (US-803) ────────────────────── */}
          <TabsContent value="glycemia" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" aria-hidden="true" />
                  Profil glycemique (24h)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CgmChart
                  data={DEMO_CGM}
                  targetLow={patient.objectives.targetLow}
                  targetHigh={patient.objectives.targetHigh}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Treatment Tab ────────────────────────────── */}
          <TabsContent value="treatment" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Syringe className="h-4 w-4" aria-hidden="true" />
                  Configuration insulinotherapie
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-[var(--color-muted-foreground)]">Methode</span>
                    <p className="mt-1 font-medium">{patient.insulinSettings.delivery}</p>
                  </div>
                  <div>
                    <span className="text-[var(--color-muted-foreground)]">Pompe</span>
                    <p className="mt-1 font-medium">{patient.insulinSettings.pump}</p>
                  </div>
                  <div>
                    <span className="text-[var(--color-muted-foreground)]">Insuline bolus</span>
                    <p className="mt-1 font-medium">{patient.insulinSettings.bolusInsulin}</p>
                  </div>
                  <div>
                    <span className="text-[var(--color-muted-foreground)]">Debit basal moyen</span>
                    <p className="mt-1 font-medium">{patient.insulinSettings.basalRate}</p>
                  </div>
                  <div>
                    <span className="text-[var(--color-muted-foreground)]">ICR moyen</span>
                    <p className="mt-1 font-medium">{patient.insulinSettings.icr}</p>
                  </div>
                  <div>
                    <span className="text-[var(--color-muted-foreground)]">ISF moyen</span>
                    <p className="mt-1 font-medium">{patient.insulinSettings.isf}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Pill className="h-4 w-4" aria-hidden="true" />
                  Traitements associes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Aucun traitement complementaire enregistre
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Documents Tab ────────────────────────────── */}
          <TabsContent value="documents" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calendar className="h-4 w-4" aria-hidden="true" />
                  Documents medicaux
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Aucun document enregistre
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
