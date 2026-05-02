"use client"

/**
 * Patient list page — US-801.
 *
 * Displays a searchable, filterable table of patients with:
 * - Search by name
 * - Filter by pathology (DT1, DT2, GD)
 * - Sortable columns
 * - Link to patient detail
 * - Glycemia color coding and TIR quality indicator
 */

import { useState, useMemo } from "react"
import { useTranslations } from "next-intl"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { GlycemiaValue, ClinicalBadge } from "@/components/diabeo"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { Search, ChevronRight, UserPlus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

interface PatientRow {
  id: number
  name: string
  pathology: "DT1" | "DT2" | "GD"
  age: number
  lastGlucoseMgdl: number | null
  tirPercent: number | null
  lastSync: string
  isActive: boolean
}

// DEMO DATA — synthetic, no real PII
const DEMO_PATIENTS: PatientRow[] = [
  { id: 1, name: "Patient DT1-001", pathology: "DT1", age: 34, lastGlucoseMgdl: 127, tirPercent: 75, lastSync: "2h", isActive: true },
  { id: 2, name: "Patient DT2-002", pathology: "DT2", age: 58, lastGlucoseMgdl: 195, tirPercent: 52, lastSync: "30min", isActive: true },
  { id: 3, name: "Patient DT1-003", pathology: "DT1", age: 27, lastGlucoseMgdl: 98, tirPercent: 82, lastSync: "15min", isActive: true },
  { id: 4, name: "Patient DT1-004", pathology: "DT1", age: 41, lastGlucoseMgdl: 256, tirPercent: 38, lastSync: "1h", isActive: true },
  { id: 5, name: "Patient GD-005", pathology: "GD", age: 32, lastGlucoseMgdl: 112, tirPercent: 71, lastSync: "45min", isActive: true },
  { id: 6, name: "Patient DT2-006", pathology: "DT2", age: 63, lastGlucoseMgdl: 68, tirPercent: 55, lastSync: "3h", isActive: true },
  { id: 7, name: "Patient DT1-007", pathology: "DT1", age: 19, lastGlucoseMgdl: 145, tirPercent: 67, lastSync: "20min", isActive: true },
  { id: 8, name: "Patient DT2-008", pathology: "DT2", age: 55, lastGlucoseMgdl: null, tirPercent: null, lastSync: "7j", isActive: false },
]

const PATHOLOGY_FILTER_VALUES = ["all", "DT1", "DT2", "GD"] as const

function getTirQuality(tir: number | null): "excellent" | "good" | "moderate" | "poor" | null {
  if (tir === null) return null
  if (tir >= 70) return "excellent"
  if (tir >= 50) return "good"
  if (tir >= 30) return "moderate"
  return "poor"
}

export default function PatientsPage() {
  const router = useRouter()
  const t = useTranslations("patients")
  const [search, setSearch] = useState("")
  const [pathologyFilter, setPathologyFilter] = useState("all")

  const filtered = useMemo(() => {
    return DEMO_PATIENTS.filter((p) => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase())
      const matchesPathology = pathologyFilter === "all" || p.pathology === pathologyFilter
      return matchesSearch && matchesPathology
    })
  }, [search, pathologyFilter])

  const patientCountLabel =
    filtered.length === 1
      ? t("patientCount", { count: filtered.length })
      : t("patientsCount", { count: filtered.length })

  const pathologyFilterLabels: Record<typeof PATHOLOGY_FILTER_VALUES[number], string> = {
    all: t("filterAll"),
    DT1: "DT1",
    DT2: "DT2",
    GD: "GD",
  }

  return (
    <>
      <DashboardHeader
        title={t("title")}
        subtitle={patientCountLabel}
      />

      <div className="space-y-4 p-6">
        {/* Search, Filters & New Patient */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" aria-hidden="true" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ps-10"
              aria-label={t("searchPlaceholder")}
            />
          </div>
          <div className="flex gap-1.5" role="group" aria-label={t("filterPathology")}>
            {PATHOLOGY_FILTER_VALUES.map((value) => (
              <button
                key={value}
                onClick={() => setPathologyFilter(value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  pathologyFilter === value
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-primary-100)]"
                }`}
                aria-pressed={pathologyFilter === value}
              >
                {pathologyFilterLabels[value]}
              </button>
            ))}
          </div>
          <Link href="/patients/new">
            <Button className="gap-2 bg-teal-600 hover:bg-teal-700">
              <UserPlus className="h-4 w-4" />
              {t("newPatient")}
            </Button>
          </Link>
        </div>

        {/* Patient Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colPatient")}</TableHead>
                  <TableHead>{t("colPathology")}</TableHead>
                  <TableHead>{t("colAge")}</TableHead>
                  <TableHead>{t("colLastGlucose")}</TableHead>
                  <TableHead>{t("colTir")}</TableHead>
                  <TableHead>{t("colLastSync")}</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">{t("colActions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((patient) => (
                  <TableRow
                    key={patient.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/patients/${patient.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        router.push(`/patients/${patient.id}`)
                      }
                    }}
                    className="cursor-pointer hover:bg-[var(--color-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                    aria-label={t("viewRecord", { name: patient.name })}
                  >
                    <TableCell>
                      <Link
                        href={`/patients/${patient.id}`}
                        className="font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)]"
                      >
                        {patient.name}
                      </Link>
                      {!patient.isActive && (
                        <Badge variant="secondary" className="ms-2 text-xs">
                          {t("inactive")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <ClinicalBadge type="pathology" value={patient.pathology} />
                    </TableCell>
                    <TableCell className="text-[var(--color-muted-foreground)]">
                      {t("years", { age: patient.age })}
                    </TableCell>
                    <TableCell>
                      {patient.lastGlucoseMgdl !== null ? (
                        <GlycemiaValue value={patient.lastGlucoseMgdl} unit="mg/dL" size="sm" />
                      ) : (
                        <span className="text-sm text-[var(--color-muted-foreground)]">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {patient.tirPercent !== null ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{patient.tirPercent}%</span>
                          <ClinicalBadge
                            type="quality"
                            value={getTirQuality(patient.tirPercent) ?? "poor"}
                          />
                        </div>
                      ) : (
                        <span className="text-sm text-[var(--color-muted-foreground)]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-[var(--color-muted-foreground)]">
                      {patient.lastSync}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/patients/${patient.id}`}
                        aria-label={t("viewRecord", { name: patient.name })}
                      >
                        <ChevronRight className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-[var(--color-muted-foreground)]"
                      role="status"
                      aria-live="polite"
                    >
                      {search ? t("noPatientsFor", { search }) : t("noPatients")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
