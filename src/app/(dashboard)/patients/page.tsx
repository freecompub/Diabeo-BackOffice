"use client"

/**
 * Patient list page.
 *
 * Fetches the connected user's accessible patients from `GET /api/patients`,
 * which returns `PatientListItemDto[]` (same shape for all roles):
 * - VIEWER (patient role): sees only their own patient.
 * - NURSE / DOCTOR / ADMIN: sees patients linked via PatientReferent
 *   (their portfolio). ADMINs without a HealthcareMember see an empty list.
 *
 * UI features: search by name, filter by pathology (DT1/DT2/GD), link to detail.
 * Clinical metrics (last glucose, TIR, sync) are placeholders — they require
 * CGM rollup queries that this page does not yet issue.
 */

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { GlycemiaValue, ClinicalBadge } from "@/components/diabeo"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { Search, ChevronRight, UserPlus, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import type { PatientListItemDto } from "@/lib/dto/patient"

type Pathology = "DT1" | "DT2" | "GD"

interface PatientRow {
  id: number
  name: string
  pathology: Pathology
  age: number | null
  lastGlucoseMgdl: number | null
  tirPercent: number | null
  lastSync: string
}

const PATHOLOGY_FILTER_VALUES = ["all", "DT1", "DT2", "GD"] as const

function getTirQuality(tir: number | null): "excellent" | "good" | "moderate" | "poor" | null {
  if (tir === null) return null
  if (tir >= 70) return "excellent"
  if (tir >= 50) return "good"
  if (tir >= 30) return "moderate"
  return "poor"
}

function ageFromBirthday(iso?: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age
}

function mapApiPatient(p: PatientListItemDto): PatientRow {
  const first = p.user.firstname?.trim() ?? ""
  const last = p.user.lastname?.trim() ?? ""
  const name = `${first} ${last}`.trim() || `Patient #${p.id}`
  return {
    id: p.id,
    name,
    pathology: p.pathology,
    age: ageFromBirthday(p.user.birthday),
    lastGlucoseMgdl: null,
    tirPercent: null,
    lastSync: "—",
  }
}

export default function PatientsPage() {
  const router = useRouter()
  const t = useTranslations("patients")
  const [search, setSearch] = useState("")
  const [pathologyFilter, setPathologyFilter] = useState("all")
  const [patients, setPatients] = useState<PatientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Note: useState initializers already set loading=true / error=null on
    // mount. Resetting them here would trigger cascading renders + violate
    // react-hooks/set-state-in-effect. The single-shot effect (deps=[]) plus
    // AbortController suffices for the strictMode dev double-fire scenario.
    const ctrl = new AbortController()
    fetch("/api/patients", { credentials: "same-origin", signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`)
        }
        return res.json() as Promise<PatientListItemDto[]>
      })
      .then((data) => {
        setPatients(data.map(mapApiPatient))
      })
      .catch((e: unknown) => {
        // AbortController signal: silent — the component unmounted or the
        // effect re-ran (React strictMode dev double-fire).
        if (e instanceof DOMException && e.name === "AbortError") return
        const msg = e instanceof Error ? e.message : "fetchFailed"
        setError(msg || "fetchFailed")
      })
      .finally(() => {
        // Only reset loading if we weren't aborted (avoids the flicker on
        // strictMode dev double-mount).
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [])

  const filtered = useMemo(() => {
    return patients.filter((p) => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase())
      const matchesPathology = pathologyFilter === "all" || p.pathology === pathologyFilter
      return matchesSearch && matchesPathology
    })
  }, [patients, search, pathologyFilter])

  /**
   * HSA H3 + review round 2 (M3/M4) — patient-safety banner. Triggered when a
   * mass decryption failure is likely (key rotation gone wrong, dump restored
   * without keys), so the practitioner doesn't continue prescribing on
   * misidentified rows.
   *
   * Heuristic: at least 2 patients have the fallback placeholder name
   * `Patient #${id}` AND null age, AND ≥80% of the visible list is in that
   * state. The ratio handles small cabinets (2/2 = 100% triggers); the
   * absolute minimum of 2 avoids alarming on a single legitimate edge case.
   * Exact equality (not `startsWith`) protects against a future patient
   * literally named "Patient #X" — match must come from `mapApiPatient`'s
   * own fallback.
   */
  const decryptIncidentDetected = useMemo(() => {
    if (patients.length === 0) return false
    const nullishCount = patients.filter(
      (p) => p.name === `Patient #${p.id}` && p.age === null,
    ).length
    if (nullishCount < 2) return false
    return nullishCount / patients.length >= 0.8
  }, [patients])

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
        subtitle={loading ? t("loading") : patientCountLabel}
      />

      <div className="space-y-4 p-6">
        {decryptIncidentDetected && (
          <div
            role="alert"
            className="rounded-md border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] px-4 py-3 text-sm text-[var(--color-danger)]"
          >
            {t("decryptIncident")}
          </div>
        )}

        {/* Search, Filters & New Patient */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" aria-hidden="true" />
            <Input
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ps-10"
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
                {loading && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-12 text-center text-[var(--color-muted-foreground)]"
                      role="status"
                      aria-live="polite"
                    >
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-hidden="true" />
                      <span className="sr-only">{t("loading")}</span>
                    </TableCell>
                  </TableRow>
                )}
                {!loading && error && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-[var(--color-danger)]"
                      role="alert"
                    >
                      {t("loadError")}
                    </TableCell>
                  </TableRow>
                )}
                {!loading && !error && filtered.map((patient) => (
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
                    </TableCell>
                    <TableCell>
                      <ClinicalBadge type="pathology" value={patient.pathology} />
                    </TableCell>
                    <TableCell className="text-[var(--color-muted-foreground)]">
                      {patient.age !== null ? t("years", { age: patient.age }) : "—"}
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
                {!loading && !error && filtered.length === 0 && (
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
