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
import { Search, ChevronRight } from "lucide-react"
import Link from "next/link"

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

const DEMO_PATIENTS: PatientRow[] = [
  { id: 1, name: "Alice Dupont", pathology: "DT1", age: 34, lastGlucoseMgdl: 127, tirPercent: 75, lastSync: "2h", isActive: true },
  { id: 2, name: "Bob Martin", pathology: "DT2", age: 58, lastGlucoseMgdl: 195, tirPercent: 52, lastSync: "30min", isActive: true },
  { id: 3, name: "Claire Leroy", pathology: "DT1", age: 27, lastGlucoseMgdl: 98, tirPercent: 82, lastSync: "15min", isActive: true },
  { id: 4, name: "David Moreau", pathology: "DT1", age: 41, lastGlucoseMgdl: 256, tirPercent: 38, lastSync: "1h", isActive: true },
  { id: 5, name: "Emma Bernard", pathology: "GD", age: 32, lastGlucoseMgdl: 112, tirPercent: 71, lastSync: "45min", isActive: true },
  { id: 6, name: "Fabien Petit", pathology: "DT2", age: 63, lastGlucoseMgdl: 68, tirPercent: 55, lastSync: "3h", isActive: true },
  { id: 7, name: "Gaelle Robert", pathology: "DT1", age: 19, lastGlucoseMgdl: 145, tirPercent: 67, lastSync: "20min", isActive: true },
  { id: 8, name: "Hugo Richard", pathology: "DT2", age: 55, lastGlucoseMgdl: null, tirPercent: null, lastSync: "7j", isActive: false },
]

const PATHOLOGY_FILTERS = [
  { value: "all", label: "Tous" },
  { value: "DT1", label: "DT1" },
  { value: "DT2", label: "DT2" },
  { value: "GD", label: "GD" },
]

function getTirQuality(tir: number | null): "excellent" | "good" | "moderate" | "poor" | null {
  if (tir === null) return null
  if (tir >= 70) return "excellent"
  if (tir >= 50) return "good"
  if (tir >= 30) return "moderate"
  return "poor"
}

export default function PatientsPage() {
  const [search, setSearch] = useState("")
  const [pathologyFilter, setPathologyFilter] = useState("all")

  const filtered = useMemo(() => {
    return DEMO_PATIENTS.filter((p) => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase())
      const matchesPathology = pathologyFilter === "all" || p.pathology === pathologyFilter
      return matchesSearch && matchesPathology
    })
  }, [search, pathologyFilter])

  return (
    <>
      <DashboardHeader
        title="Patients"
        subtitle={`${filtered.length} patient${filtered.length > 1 ? "s" : ""}`}
      />

      <div className="space-y-4 p-6">
        {/* Search & Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" aria-hidden="true" />
            <Input
              placeholder="Rechercher un patient..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              aria-label="Rechercher un patient"
            />
          </div>
          <div className="flex gap-1.5" role="group" aria-label="Filtrer par pathologie">
            {PATHOLOGY_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setPathologyFilter(f.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  pathologyFilter === f.value
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-primary-100)]"
                }`}
                aria-pressed={pathologyFilter === f.value}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Patient Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Pathologie</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Derniere glycemie</TableHead>
                  <TableHead>TIR</TableHead>
                  <TableHead>Derniere sync</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((patient) => (
                  <TableRow
                    key={patient.id}
                    className="cursor-pointer hover:bg-[var(--color-muted)]"
                  >
                    <TableCell>
                      <Link
                        href={`/patients/${patient.id}`}
                        className="font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)]"
                      >
                        {patient.name}
                      </Link>
                      {!patient.isActive && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          Inactif
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <ClinicalBadge type="pathology" value={patient.pathology} />
                    </TableCell>
                    <TableCell className="text-[var(--color-muted-foreground)]">
                      {patient.age} ans
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
                        aria-label={`Voir le dossier de ${patient.name}`}
                      >
                        <ChevronRight className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-[var(--color-muted-foreground)]">
                      Aucun patient trouve
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
