"use client"

/**
 * Dashboard page — US-800.
 *
 * Displays KPIs (total patients, alertes, TIR moyen), recent alerts,
 * and quick access to patient list. Uses design system components:
 * StatCard, AlertBanner, TirDonut, PatientCard.
 */

import { useState } from "react"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import {
  StatCard,
  TirDonut,
  AlertBanner,
  PatientCard,
} from "@/components/diabeo"
import { useRouter } from "next/navigation"
import { Users, Activity, AlertTriangle, TrendingUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// Demo data for initial render — replaced by API calls in production
const DEMO_STATS = {
  totalPatients: 48,
  activeAlerts: 3,
  avgTir: 72,
  avgGmi: 7.1,
}

const DEMO_TIR = {
  veryLow: 1,
  low: 3,
  inRange: 72,
  high: 19,
  veryHigh: 5,
}

const DEMO_ALERTS = [
  { id: 1, patient: "Patient DT1-001", type: "hypo" as const, message: "Hypoglycemie detectee — 52 mg/dL" },
  { id: 2, patient: "Patient DT2-003", type: "hyper" as const, message: "Hyperglycemie severe — 320 mg/dL" },
  { id: 3, patient: "Patient DT1-007", type: "warning" as const, message: "TIR en baisse — 45% cette semaine" },
]

// DEMO DATA — synthetic, no real PII
const DEMO_PATIENTS = [
  {
    id: 1,
    name: "Patient DT1-001",
    pathology: "DT1" as const,
    age: 34,
    lastGlucose: 127,
    tir: 75,
    lastSync: new Date(Date.now() - 2 * 3600_000),
    isActive: true,
  },
  {
    id: 2,
    name: "Patient DT2-002",
    pathology: "DT2" as const,
    age: 58,
    lastGlucose: 195,
    tir: 52,
    lastSync: new Date(Date.now() - 30 * 60_000),
    isActive: true,
  },
  {
    id: 3,
    name: "Patient DT1-003",
    pathology: "DT1" as const,
    age: 27,
    lastGlucose: 98,
    tir: 82,
    lastSync: new Date(Date.now() - 15 * 60_000),
    isActive: true,
  },
]

export default function DashboardPage() {
  const router = useRouter()
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<number>>(new Set())

  return (
    <>
      <DashboardHeader
        title="Tableau de bord"
        subtitle="Vue d'ensemble de vos patients"
      />

      <div className="space-y-6 p-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Patients actifs"
            value={String(DEMO_STATS.totalPatients)}
            icon={<Users className="h-5 w-5" />}
            variant="teal"
          />
          <StatCard
            label="Alertes actives"
            value={String(DEMO_STATS.activeAlerts)}
            icon={<AlertTriangle className="h-5 w-5" />}
            variant="warning"
            trend="up"
          />
          <StatCard
            label="TIR moyen"
            value={`${DEMO_STATS.avgTir}%`}
            icon={<Activity className="h-5 w-5" />}
            variant="success"
            trend="stable"
          />
          <StatCard
            label="GMI moyen"
            value={`${DEMO_STATS.avgGmi}%`}
            icon={<TrendingUp className="h-5 w-5" />}
            variant="default"
          />
        </div>

        {/* Main content — 2 columns */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left — Alerts + TIR */}
          <div className="space-y-6 lg:col-span-2">
            {/* Alerts */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Alertes recentes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {DEMO_ALERTS.filter((a) => !dismissedAlerts.has(a.id)).map((alert) => (
                  <AlertBanner
                    key={alert.id}
                    severity={alert.type === "hypo" ? "hypo" : alert.type === "hyper" ? "hyper" : "warning"}
                    title={`${alert.patient} — ${alert.message}`}
                    dismissible
                    onDismiss={() => setDismissedAlerts((prev) => new Set(prev).add(alert.id))}
                  />
                ))}
              </CardContent>
            </Card>

            {/* Recent patients */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Patients recents</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {DEMO_PATIENTS.map((patient) => (
                    <PatientCard
                      key={patient.id}
                      name={patient.name}
                      pathology={patient.pathology}
                      age={patient.age}
                      latestGlucose={patient.lastGlucose}
                      tirPercentage={patient.tir}
                      lastSync={patient.lastSync}
                      isActive={patient.isActive}
                      onClick={() => router.push(`/patients/${patient.id}`)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right — TIR Donut */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  TIR global (7 jours)
                </CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center">
                <TirDonut
                  data={DEMO_TIR}
                  size={200}
                  showLegend
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
