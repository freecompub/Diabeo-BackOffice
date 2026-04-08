"use client"

/**
 * User Profile / Settings page — WEB-208.
 *
 * Two-panel layout on desktop (section list left, edit form right).
 * Accordion on mobile.
 *
 * 8 sections:
 *  1. personalInfo   — first name, last name, gender, birth date
 *  2. medicalData    — diabetes type, diagnosis year, height
 *  3. administrative — NIRPP, OID, INS (read-only)
 *  4. contact        — phone, address, city
 *  5. units          — glucose, weight, height unit dropdowns
 *  6. dayMoments     — morning / noon / evening / night time ranges
 *  7. notifications  — toggles (glycemia, insulin, appointments, auto-export)
 *  8. privacy        — toggles (researchers, healthcare, analytics, GDPR consent)
 *
 * Security:
 * - All API calls use credentials: "include" + X-Requested-With header
 * - Data is never stored in localStorage
 * - Sensitive admin fields (NIRPP, INS) are read-only
 *
 * Accessibility:
 * - Each section is a <section> with aria-labelledby
 * - Save buttons per section with aria-busy loading state
 * - Error alerts use role="alert"
 * - Select elements have visible labels
 */

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  User,
  Activity,
  Shield,
  Phone,
  Ruler,
  Clock,
  Bell,
  Lock,
  ChevronDown,
  Download,
  Loader2,
  Check,
  AlertTriangle,
  Eye,
  EyeOff,
} from "lucide-react"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import {
  DiabeoButton,
  DiabeoCard,
  DiabeoFormSection,
  DiabeoTextField,
  DiabeoToggle,
  DiabeoReadonlyField,
} from "@/components/diabeo"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  "Content-Type": "application/json",
} as const

type SectionId =
  | "personalInfo"
  | "medicalData"
  | "administrative"
  | "contact"
  | "units"
  | "dayMoments"
  | "notifications"
  | "privacy"

interface SectionMeta {
  id: SectionId
  icon: React.ReactNode
}

const SECTIONS: SectionMeta[] = [
  { id: "personalInfo", icon: <User className="size-4" /> },
  { id: "medicalData", icon: <Activity className="size-4" /> },
  { id: "administrative", icon: <Shield className="size-4" /> },
  { id: "contact", icon: <Phone className="size-4" /> },
  { id: "units", icon: <Ruler className="size-4" /> },
  { id: "dayMoments", icon: <Clock className="size-4" /> },
  { id: "notifications", icon: <Bell className="size-4" /> },
  { id: "privacy", icon: <Lock className="size-4" /> },
]

// ---------------------------------------------------------------------------
// Types for profile data
// ---------------------------------------------------------------------------

interface ProfileData {
  firstname?: string
  lastname?: string
  sex?: string
  birthday?: string
  phone?: string
  address1?: string
  city?: string
  // Admin fields (read-only)
  nirpp?: string
  ins?: string
  oid?: string
}

interface PatientData {
  pathology?: string
  yearDiag?: number
}

interface MedicalData {
  heightCm?: number
}

interface UnitPrefs {
  unitGlycemia?: number
  unitWeight?: number
  unitSize?: number
}

interface DayMoment {
  type: string
  startTime: string
  endTime: string
}

interface NotifPrefs {
  glycemiaReminders?: boolean
  insulinReminders?: boolean
  medicalAppointments?: boolean
  autoExport?: boolean
}

interface PrivacySettings {
  shareWithResearchers?: boolean
  shareWithProviders?: boolean
  analyticsEnabled?: boolean
  gdprConsent?: boolean
}

// ---------------------------------------------------------------------------
// Section save state
// ---------------------------------------------------------------------------

type SaveState = "idle" | "saving" | "saved" | "error"

// ---------------------------------------------------------------------------
// Save indicator
// ---------------------------------------------------------------------------

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null

  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      </span>
    )
  }

  if (state === "saved") {
    return (
      <span className="flex items-center gap-1 text-xs text-teal-600">
        <Check className="size-3.5" aria-hidden="true" />
      </span>
    )
  }

  if (state === "error") {
    return (
      <span className="flex items-center gap-1 text-xs text-red-600">
        <AlertTriangle className="size-3.5" aria-hidden="true" />
      </span>
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// useSectionSave — shared hook for section-level save logic
// ---------------------------------------------------------------------------

function useSectionSave<T>(
  endpoint: string,
  method: "PUT" | "POST" = "PUT"
) {
  const [state, setState] = React.useState<SaveState>("idle")
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = React.useCallback(
    async (data: T): Promise<boolean> => {
      setState("saving")
      try {
        const res = await fetch(endpoint, {
          method,
          credentials: "include",
          headers: API_HEADERS,
          body: JSON.stringify(data),
        })
        if (!res.ok) {
          setState("error")
          return false
        }
        setState("saved")
        // Auto-reset to idle after 3s
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setState("idle"), 3000)
        return true
      } catch {
        setState("error")
        return false
      }
    },
    [endpoint, method]
  )

  // Cleanup
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { state, save }
}

// ---------------------------------------------------------------------------
// PersonalInfoSection
// ---------------------------------------------------------------------------

function PersonalInfoSection({ profile }: { profile: ProfileData | null }) {
  const t = useTranslations("profile")
  const tCommon = useTranslations("common")
  const { state, save } = useSectionSave<Partial<ProfileData>>("/api/account")

  const [firstname, setFirstname] = React.useState(profile?.firstname ?? "")
  const [lastname, setLastname] = React.useState(profile?.lastname ?? "")
  const [sex, setSex] = React.useState(profile?.sex ?? "")
  const [birthday, setBirthday] = React.useState(profile?.birthday ?? "")

  React.useEffect(() => {
    if (profile) {
      setFirstname(profile.firstname ?? "")
      setLastname(profile.lastname ?? "")
      setSex(profile.sex ?? "")
      setBirthday(profile.birthday ?? "")
    }
  }, [profile])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await save({ firstname, lastname, sex: sex || undefined, birthday: birthday || undefined })
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DiabeoFormSection
        title={t("personalInfo.title")}
        description={t("personalInfo.description")}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DiabeoTextField
            label={t("personalInfo.firstname")}
            value={firstname}
            onChange={(e) => setFirstname(e.target.value)}
            autoComplete="given-name"
          />
          <DiabeoTextField
            label={t("personalInfo.lastname")}
            value={lastname}
            onChange={(e) => setLastname(e.target.value)}
            autoComplete="family-name"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="sex-select"
              className="text-sm font-medium text-foreground"
            >
              {t("personalInfo.sex")}
            </label>
            <select
              id="sex-select"
              value={sex}
              onChange={(e) => setSex(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-teal-600"
            >
              <option value="">{t("personalInfo.sexUnspecified")}</option>
              <option value="MALE">{t("personalInfo.sexMale")}</option>
              <option value="FEMALE">{t("personalInfo.sexFemale")}</option>
              <option value="OTHER">{t("personalInfo.sexOther")}</option>
            </select>
          </div>
          <DiabeoTextField
            label={t("personalInfo.birthday")}
            type="date"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            autoComplete="bday"
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <SaveIndicator state={state} />
          <DiabeoButton
            type="submit"
            variant="diabeoPrimary"
            loading={state === "saving"}
            size="sm"
          >
            {tCommon("save")}
          </DiabeoButton>
        </div>
      </DiabeoFormSection>
    </form>
  )
}

// ---------------------------------------------------------------------------
// MedicalDataSection
// ---------------------------------------------------------------------------

function MedicalDataSection({
  patient,
  medical,
}: {
  patient: PatientData | null
  medical: MedicalData | null
}) {
  const t = useTranslations("profile")
  const tCommon = useTranslations("common")
  // pathology belongs to the patient profile — PUT /api/patient
  const { state: patientState, save: savePatient } =
    useSectionSave<{ pathology?: string }>("/api/patient")
  // yearDiag and heightCm belong to medical data — PUT /api/patient/medical-data
  const { state: medicalState, save: saveMedical } =
    useSectionSave<{ yearDiag?: number; heightCm?: number }>("/api/patient/medical-data")

  // Derived combined state for the single save indicator
  const state: SaveState =
    patientState === "saving" || medicalState === "saving"
      ? "saving"
      : patientState === "error" || medicalState === "error"
        ? "error"
        : patientState === "saved" || medicalState === "saved"
          ? "saved"
          : "idle"

  const [pathology, setPathology] = React.useState(patient?.pathology ?? "")
  const [yearDiag, setYearDiag] = React.useState(
    patient?.yearDiag?.toString() ?? ""
  )
  const [heightCm, setHeightCm] = React.useState(
    medical?.heightCm?.toString() ?? ""
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Run both saves in parallel; each targets the correct endpoint
    await Promise.all([
      savePatient({ pathology: pathology || undefined }),
      saveMedical({
        yearDiag: yearDiag ? parseInt(yearDiag, 10) : undefined,
        heightCm: heightCm ? parseFloat(heightCm) : undefined,
      }),
    ])
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DiabeoFormSection
        title={t("medicalData.title")}
        description={t("medicalData.description")}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="pathology-select"
              className="text-sm font-medium text-foreground"
            >
              {t("medicalData.pathology")}
            </label>
            <select
              id="pathology-select"
              value={pathology}
              onChange={(e) => setPathology(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-teal-600"
            >
              <option value="">{t("medicalData.pathologyNone")}</option>
              <option value="DT1">{t("medicalData.pathologyDt1")}</option>
              <option value="DT2">{t("medicalData.pathologyDt2")}</option>
              <option value="GD">{t("medicalData.pathologyGd")}</option>
            </select>
          </div>
          <DiabeoTextField
            label={t("medicalData.yearDiag")}
            type="number"
            value={yearDiag}
            onChange={(e) => setYearDiag(e.target.value)}
            min={1900}
            max={new Date().getFullYear()}
            hint={t("medicalData.yearDiagHint")}
          />
          <DiabeoTextField
            label={t("medicalData.height")}
            type="number"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            min={50}
            max={250}
            hint="cm"
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <SaveIndicator state={state} />
          <DiabeoButton
            type="submit"
            variant="diabeoPrimary"
            loading={state === "saving"}
            size="sm"
          >
            {tCommon("save")}
          </DiabeoButton>
        </div>
      </DiabeoFormSection>
    </form>
  )
}

// ---------------------------------------------------------------------------
// AdministrativeSection
// ---------------------------------------------------------------------------

/**
 * Masks a sensitive identifier, showing only the last 2 characters.
 * Format: "* ** ** ** *** *** XX" where XX are the last 2 digits.
 * Returns null when the value is absent.
 *
 * Clinical safety: NIRPP and INS are sensitive administrative identifiers.
 * They must not be displayed in plain text without explicit user action.
 */
function maskIdentifier(value: string | null | undefined): string | null {
  if (!value || value.length < 2) return value ?? null
  const last2 = value.slice(-2)
  return `* ** ** ** *** *** ${last2}`
}

function AdministrativeSection({ profile }: { profile: ProfileData | null }) {
  const t = useTranslations("profile")
  const [nirppRevealed, setNirppRevealed] = React.useState(false)
  const [insRevealed, setInsRevealed] = React.useState(false)

  const handleRevealNirpp = () => {
    const next = !nirppRevealed
    setNirppRevealed(next)
    if (next) {
      window.dispatchEvent(
        new CustomEvent("diabeo_analytics", {
          detail: { event: "administrative_field_revealed", field: "nirpp" },
        })
      )
    }
  }

  const handleRevealIns = () => {
    const next = !insRevealed
    setInsRevealed(next)
    if (next) {
      window.dispatchEvent(
        new CustomEvent("diabeo_analytics", {
          detail: { event: "administrative_field_revealed", field: "ins" },
        })
      )
    }
  }

  const nirppDisplay = profile?.nirpp
    ? nirppRevealed
      ? profile.nirpp
      : (maskIdentifier(profile.nirpp) ?? t("administrative.notProvided"))
    : t("administrative.notProvided")

  const insDisplay = profile?.ins
    ? insRevealed
      ? profile.ins
      : (maskIdentifier(profile.ins) ?? t("administrative.notProvided"))
    : t("administrative.notProvided")

  return (
    <DiabeoFormSection
      title={t("administrative.title")}
      description={t("administrative.description")}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* NIRPP — masked by default with reveal toggle */}
        <div className="flex flex-col gap-1">
          <DiabeoReadonlyField
            label={t("administrative.nirpp")}
            value={nirppDisplay}
            copyable={!!profile?.nirpp && nirppRevealed}
          />
          {profile?.nirpp && (
            <button
              type="button"
              onClick={handleRevealNirpp}
              className="flex items-center gap-1 self-start rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-teal-600 focus-visible:outline-2 focus-visible:outline-teal-600 transition-colors"
              aria-label={
                nirppRevealed
                  ? `${t("administrative.hide")} NIRPP`
                  : `${t("administrative.reveal")} NIRPP`
              }
            >
              {nirppRevealed ? (
                <EyeOff className="size-3.5" aria-hidden="true" />
              ) : (
                <Eye className="size-3.5" aria-hidden="true" />
              )}
              <span>
                {nirppRevealed
                  ? t("administrative.hide")
                  : t("administrative.reveal")}
              </span>
            </button>
          )}
        </div>

        {/* INS — masked by default with reveal toggle */}
        <div className="flex flex-col gap-1">
          <DiabeoReadonlyField
            label={t("administrative.ins")}
            value={insDisplay}
            copyable={!!profile?.ins && insRevealed}
          />
          {profile?.ins && (
            <button
              type="button"
              onClick={handleRevealIns}
              className="flex items-center gap-1 self-start rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-teal-600 focus-visible:outline-2 focus-visible:outline-teal-600 transition-colors"
              aria-label={
                insRevealed
                  ? `${t("administrative.hide")} INS`
                  : `${t("administrative.reveal")} INS`
              }
            >
              {insRevealed ? (
                <EyeOff className="size-3.5" aria-hidden="true" />
              ) : (
                <Eye className="size-3.5" aria-hidden="true" />
              )}
              <span>
                {insRevealed
                  ? t("administrative.hide")
                  : t("administrative.reveal")}
              </span>
            </button>
          )}
        </div>

        <DiabeoReadonlyField
          label={t("administrative.oid")}
          value={profile?.oid ?? t("administrative.notProvided")}
          copyable={!!profile?.oid}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("administrative.readonlyNotice")}
      </p>
    </DiabeoFormSection>
  )
}

// ---------------------------------------------------------------------------
// ContactSection
// ---------------------------------------------------------------------------

function ContactSection({ profile }: { profile: ProfileData | null }) {
  const t = useTranslations("profile")
  const tCommon = useTranslations("common")
  const { state, save } = useSectionSave<Partial<ProfileData>>("/api/account")

  const [phone, setPhone] = React.useState(profile?.phone ?? "")
  const [address1, setAddress1] = React.useState(profile?.address1 ?? "")
  const [city, setCity] = React.useState(profile?.city ?? "")

  React.useEffect(() => {
    if (profile) {
      setPhone(profile.phone ?? "")
      setAddress1(profile.address1 ?? "")
      setCity(profile.city ?? "")
    }
  }, [profile])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await save({ phone: phone || undefined, address1: address1 || undefined, city: city || undefined })
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DiabeoFormSection
        title={t("contact.title")}
        description={t("contact.description")}
      >
        <DiabeoTextField
          label={t("contact.phone")}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />
        <DiabeoTextField
          label={t("contact.address")}
          value={address1}
          onChange={(e) => setAddress1(e.target.value)}
          autoComplete="street-address"
        />
        <DiabeoTextField
          label={t("contact.city")}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          autoComplete="address-level2"
        />
        <div className="flex items-center justify-end gap-2">
          <SaveIndicator state={state} />
          <DiabeoButton
            type="submit"
            variant="diabeoPrimary"
            loading={state === "saving"}
            size="sm"
          >
            {tCommon("save")}
          </DiabeoButton>
        </div>
      </DiabeoFormSection>
    </form>
  )
}

// ---------------------------------------------------------------------------
// UnitsSection
// ---------------------------------------------------------------------------

function UnitsSection({ units }: { units: UnitPrefs | null }) {
  const t = useTranslations("profile")
  const tCommon = useTranslations("common")
  const { state, save } = useSectionSave<UnitPrefs>("/api/account/units")

  const [unitGlycemia, setUnitGlycemia] = React.useState(
    units?.unitGlycemia ?? 5
  )
  const [unitWeight, setUnitWeight] = React.useState(units?.unitWeight ?? 6)
  const [unitSize, setUnitSize] = React.useState(units?.unitSize ?? 8)

  React.useEffect(() => {
    if (units) {
      setUnitGlycemia(units.unitGlycemia ?? 5)
      setUnitWeight(units.unitWeight ?? 6)
      setUnitSize(units.unitSize ?? 8)
    }
  }, [units])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await save({ unitGlycemia, unitWeight, unitSize })
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DiabeoFormSection
        title={t("units.title")}
        description={t("units.description")}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="unit-glycemia"
              className="text-sm font-medium text-foreground"
            >
              {t("units.glucose")}
            </label>
            <select
              id="unit-glycemia"
              value={unitGlycemia}
              onChange={(e) => setUnitGlycemia(parseInt(e.target.value, 10))}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-teal-600"
            >
              <option value={3}>mg/dL</option>
              <option value={4}>mmol/L</option>
              <option value={5}>g/L</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="unit-weight"
              className="text-sm font-medium text-foreground"
            >
              {t("units.weight")}
            </label>
            <select
              id="unit-weight"
              value={unitWeight}
              onChange={(e) => setUnitWeight(parseInt(e.target.value, 10))}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-teal-600"
            >
              <option value={6}>kg</option>
              <option value={7}>lbs</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="unit-size"
              className="text-sm font-medium text-foreground"
            >
              {t("units.height")}
            </label>
            <select
              id="unit-size"
              value={unitSize}
              onChange={(e) => setUnitSize(parseInt(e.target.value, 10))}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-teal-600"
            >
              <option value={8}>cm</option>
              <option value={9}>in</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <SaveIndicator state={state} />
          <DiabeoButton
            type="submit"
            variant="diabeoPrimary"
            loading={state === "saving"}
            size="sm"
          >
            {tCommon("save")}
          </DiabeoButton>
        </div>
      </DiabeoFormSection>
    </form>
  )
}

// ---------------------------------------------------------------------------
// DayMomentsSection
// ---------------------------------------------------------------------------

const DAY_MOMENT_TYPES = ["MORNING", "NOON", "EVENING", "NIGHT"] as const
type DayMomentType = (typeof DAY_MOMENT_TYPES)[number]

function DayMomentsSection({ moments }: { moments: DayMoment[] | null }) {
  const t = useTranslations("profile")
  const tCommon = useTranslations("common")
  const { state, save } = useSectionSave<DayMoment[]>(
    "/api/account/day-moments"
  )

  const defaultMoments: Record<DayMomentType, DayMoment> = {
    MORNING: { type: "MORNING", startTime: "06:00", endTime: "12:00" },
    NOON: { type: "NOON", startTime: "12:00", endTime: "14:00" },
    EVENING: { type: "EVENING", startTime: "18:00", endTime: "22:00" },
    NIGHT: { type: "NIGHT", startTime: "22:00", endTime: "06:00" },
  }

  const [values, setValues] = React.useState<Record<DayMomentType, DayMoment>>(
    () => {
      if (!moments) return defaultMoments
      const map = { ...defaultMoments }
      for (const m of moments) {
        if (DAY_MOMENT_TYPES.includes(m.type as DayMomentType)) {
          map[m.type as DayMomentType] = m
        }
      }
      return map
    }
  )

  React.useEffect(() => {
    if (moments) {
      const map = { ...defaultMoments }
      for (const m of moments) {
        if (DAY_MOMENT_TYPES.includes(m.type as DayMomentType)) {
          map[m.type as DayMomentType] = m
        }
      }
      setValues(map)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moments])

  const updateTime = (
    type: DayMomentType,
    field: "startTime" | "endTime",
    value: string
  ) => {
    setValues((prev) => ({
      ...prev,
      [type]: { ...prev[type], [field]: value },
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await save(Object.values(values))
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DiabeoFormSection
        title={t("dayMoments.title")}
        description={t("dayMoments.description")}
      >
        <div className="flex flex-col gap-4">
          {DAY_MOMENT_TYPES.map((type) => (
            <div key={type} className="grid grid-cols-3 items-center gap-3">
              <span className="text-sm font-medium text-foreground">
                {t(`dayMoments.${type.toLowerCase() as Lowercase<DayMomentType>}`)}
              </span>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`dm-start-${type}`}
                  className="text-xs text-muted-foreground"
                >
                  {t("dayMoments.start")}
                </label>
                <input
                  id={`dm-start-${type}`}
                  type="time"
                  value={values[type].startTime}
                  onChange={(e) => updateTime(type, "startTime", e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-teal-600"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`dm-end-${type}`}
                  className="text-xs text-muted-foreground"
                >
                  {t("dayMoments.end")}
                </label>
                <input
                  id={`dm-end-${type}`}
                  type="time"
                  value={values[type].endTime}
                  onChange={(e) => updateTime(type, "endTime", e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-teal-600"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2">
          <SaveIndicator state={state} />
          <DiabeoButton
            type="submit"
            variant="diabeoPrimary"
            loading={state === "saving"}
            size="sm"
          >
            {tCommon("save")}
          </DiabeoButton>
        </div>
      </DiabeoFormSection>
    </form>
  )
}

// ---------------------------------------------------------------------------
// NotificationsSection
// ---------------------------------------------------------------------------

function NotificationsSection({ prefs }: { prefs: NotifPrefs | null }) {
  const t = useTranslations("profile")
  const tCommon = useTranslations("common")
  const { state, save } = useSectionSave<NotifPrefs>(
    "/api/account/notifications"
  )

  const [glycemiaReminders, setGlycemiaReminders] = React.useState(
    prefs?.glycemiaReminders ?? false
  )
  const [insulinReminders, setInsulinReminders] = React.useState(
    prefs?.insulinReminders ?? false
  )
  const [medicalAppointments, setMedicalAppointments] = React.useState(
    prefs?.medicalAppointments ?? true
  )
  const [autoExport, setAutoExport] = React.useState(prefs?.autoExport ?? false)

  React.useEffect(() => {
    if (prefs) {
      setGlycemiaReminders(prefs.glycemiaReminders ?? false)
      setInsulinReminders(prefs.insulinReminders ?? false)
      setMedicalAppointments(prefs.medicalAppointments ?? true)
      setAutoExport(prefs.autoExport ?? false)
    }
  }, [prefs])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await save({
      glycemiaReminders,
      insulinReminders,
      medicalAppointments,
      autoExport,
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DiabeoFormSection
        title={t("notifications.title")}
        description={t("notifications.description")}
      >
        <div className="flex flex-col gap-4">
          <DiabeoToggle
            label={t("notifications.glycemiaReminders")}
            subtitle={t("notifications.glycemiaRemindersSubtitle")}
            checked={glycemiaReminders}
            onCheckedChange={setGlycemiaReminders}
          />
          <DiabeoToggle
            label={t("notifications.insulinReminders")}
            subtitle={t("notifications.insulinRemindersSubtitle")}
            checked={insulinReminders}
            onCheckedChange={setInsulinReminders}
          />
          <DiabeoToggle
            label={t("notifications.medicalAppointments")}
            subtitle={t("notifications.medicalAppointmentsSubtitle")}
            checked={medicalAppointments}
            onCheckedChange={setMedicalAppointments}
          />
          <DiabeoToggle
            label={t("notifications.autoExport")}
            subtitle={t("notifications.autoExportSubtitle")}
            checked={autoExport}
            onCheckedChange={setAutoExport}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <SaveIndicator state={state} />
          <DiabeoButton
            type="submit"
            variant="diabeoPrimary"
            loading={state === "saving"}
            size="sm"
          >
            {tCommon("save")}
          </DiabeoButton>
        </div>
      </DiabeoFormSection>
    </form>
  )
}

// ---------------------------------------------------------------------------
// PrivacySection
// ---------------------------------------------------------------------------

function PrivacySection({ settings }: { settings: PrivacySettings | null }) {
  const t = useTranslations("profile")
  const tCommon = useTranslations("common")
  const { state, save } = useSectionSave<PrivacySettings>(
    "/api/account/privacy"
  )

  const [shareWithResearchers, setShareWithResearchers] = React.useState(
    settings?.shareWithResearchers ?? false
  )
  const [shareWithProviders, setShareWithProviders] = React.useState(
    settings?.shareWithProviders ?? true
  )
  const [analyticsEnabled, setAnalyticsEnabled] = React.useState(
    settings?.analyticsEnabled ?? true
  )
  const [gdprConsent, setGdprConsent] = React.useState(
    settings?.gdprConsent ?? false
  )

  React.useEffect(() => {
    if (settings) {
      setShareWithResearchers(settings.shareWithResearchers ?? false)
      setShareWithProviders(settings.shareWithProviders ?? true)
      setAnalyticsEnabled(settings.analyticsEnabled ?? true)
      setGdprConsent(settings.gdprConsent ?? false)
    }
  }, [settings])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await save({
      shareWithResearchers,
      shareWithProviders,
      analyticsEnabled,
      gdprConsent,
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DiabeoFormSection
        title={t("privacy.title")}
        description={t("privacy.description")}
      >
        <div className="flex flex-col gap-4">
          <DiabeoToggle
            label={t("privacy.shareWithResearchers")}
            subtitle={t("privacy.shareWithResearchersSubtitle")}
            checked={shareWithResearchers}
            onCheckedChange={setShareWithResearchers}
          />
          <DiabeoToggle
            label={t("privacy.shareWithProviders")}
            subtitle={t("privacy.shareWithProvidersSubtitle")}
            checked={shareWithProviders}
            onCheckedChange={setShareWithProviders}
          />
          <DiabeoToggle
            label={t("privacy.analyticsEnabled")}
            subtitle={t("privacy.analyticsEnabledSubtitle")}
            checked={analyticsEnabled}
            onCheckedChange={setAnalyticsEnabled}
          />
          <DiabeoToggle
            label={t("privacy.gdprConsent")}
            subtitle={t("privacy.gdprConsentSubtitle")}
            checked={gdprConsent}
            onCheckedChange={setGdprConsent}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <SaveIndicator state={state} />
          <DiabeoButton
            type="submit"
            variant="diabeoPrimary"
            loading={state === "saving"}
            size="sm"
          >
            {tCommon("save")}
          </DiabeoButton>
        </div>
      </DiabeoFormSection>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Section panel wrapper (card)
// ---------------------------------------------------------------------------

function SectionPanel({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) {
  return (
    <section
      id={`section-${id}`}
      aria-labelledby={`section-title-${id}`}
    >
      <DiabeoCard variant="outlined" padding="lg">
        {children}
      </DiabeoCard>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Mobile accordion section
// ---------------------------------------------------------------------------

function AccordionSection({
  id,
  label,
  icon,
  children,
}: {
  id: string
  label: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`accordion-content-${id}`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-start text-sm font-medium text-foreground hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-teal-600"
      >
        <span className="shrink-0 text-teal-600" aria-hidden="true">
          {icon}
        </span>
        <span id={`section-title-${id}`}>{label}</span>
        <ChevronDown
          className={cn(
            "ms-auto size-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>
      <div
        id={`accordion-content-${id}`}
        role="region"
        aria-labelledby={`section-title-${id}`}
        hidden={!open}
        className="border-t border-gray-100 px-4 py-4"
      >
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export buttons
// ---------------------------------------------------------------------------

function ExportButtons() {
  const t = useTranslations("profile")
  const [exporting, setExporting] = React.useState<"pdf" | "json" | null>(null)

  const handleExport = async (format: "pdf" | "json") => {
    setExporting(format)
    try {
      const res = await fetch("/api/account/export", {
        credentials: "include",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })
      if (!res.ok) return

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `diabeo-export-${Date.now()}.${format === "pdf" ? "pdf" : "json"}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DiabeoButton
        variant="diabeoTertiary"
        size="sm"
        icon={<Download aria-hidden="true" />}
        loading={exporting === "pdf"}
        onClick={() => handleExport("pdf")}
        aria-label={t("export.pdf")}
      >
        {t("export.pdf")}
      </DiabeoButton>
      <DiabeoButton
        variant="diabeoTertiary"
        size="sm"
        icon={<Download aria-hidden="true" />}
        loading={exporting === "json"}
        onClick={() => handleExport("json")}
        aria-label={t("export.json")}
      >
        {t("export.json")}
      </DiabeoButton>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const t = useTranslations("profile")
  const tNav = useTranslations("nav")

  const [activeSection, setActiveSection] =
    React.useState<SectionId>("personalInfo")

  // Data states
  const [profile, setProfile] = React.useState<ProfileData | null>(null)
  const [patientData, setPatientData] = React.useState<PatientData | null>(null)
  const [medicalData, setMedicalData] = React.useState<MedicalData | null>(null)
  const [units, setUnits] = React.useState<UnitPrefs | null>(null)
  const [dayMoments, setDayMoments] = React.useState<DayMoment[] | null>(null)
  const [notifPrefs, setNotifPrefs] = React.useState<NotifPrefs | null>(null)
  const [privacySettings, setPrivacySettings] =
    React.useState<PrivacySettings | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)

  // -------------------------------------------------------------------------
  // Load all profile data in parallel
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    const headers = { "X-Requested-With": "XMLHttpRequest" }

    const load = async () => {
      setIsLoading(true)
      const [
        profileRes,
        unitsRes,
        momentsRes,
        notifRes,
        privacyRes,
      ] = await Promise.allSettled([
        fetch("/api/account", { credentials: "include", headers }),
        fetch("/api/account/units", { credentials: "include", headers }),
        fetch("/api/account/day-moments", { credentials: "include", headers }),
        fetch("/api/account/notifications", { credentials: "include", headers }),
        fetch("/api/account/privacy", { credentials: "include", headers }),
      ])

      if (profileRes.status === "fulfilled" && profileRes.value.ok) {
        const data = await profileRes.value.json() as ProfileData & { patient?: PatientData; medicalData?: MedicalData }
        setProfile(data)
        setPatientData(data.patient ?? null)
        setMedicalData(data.medicalData ?? null)
      }
      if (unitsRes.status === "fulfilled" && unitsRes.value.ok) {
        setUnits(await unitsRes.value.json() as UnitPrefs)
      }
      if (momentsRes.status === "fulfilled" && momentsRes.value.ok) {
        setDayMoments(await momentsRes.value.json() as DayMoment[])
      }
      if (notifRes.status === "fulfilled" && notifRes.value.ok) {
        setNotifPrefs(await notifRes.value.json() as NotifPrefs)
      }
      if (privacyRes.status === "fulfilled" && privacyRes.value.ok) {
        setPrivacySettings(await privacyRes.value.json() as PrivacySettings)
      }
      setIsLoading(false)
    }

    void load()
  }, [])

  // -------------------------------------------------------------------------
  // Section content renderer
  // -------------------------------------------------------------------------
  const renderSectionContent = (id: SectionId) => {
    switch (id) {
      case "personalInfo":
        return <PersonalInfoSection profile={profile} />
      case "medicalData":
        return (
          <MedicalDataSection patient={patientData} medical={medicalData} />
        )
      case "administrative":
        return <AdministrativeSection profile={profile} />
      case "contact":
        return <ContactSection profile={profile} />
      case "units":
        return <UnitsSection units={units} />
      case "dayMoments":
        return <DayMomentsSection moments={dayMoments} />
      case "notifications":
        return <NotificationsSection prefs={notifPrefs} />
      case "privacy":
        return <PrivacySection settings={privacySettings} />
      default:
        return null
    }
  }

  // -------------------------------------------------------------------------
  // Loading skeleton
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <>
        <DashboardHeader title={tNav("settings")} />
        <div className="flex items-center justify-center p-16">
          <Loader2
            className="size-8 animate-spin text-teal-600"
            aria-hidden="true"
          />
          <span className="sr-only">{t("loading")}</span>
        </div>
      </>
    )
  }

  // -------------------------------------------------------------------------
  // Page layout
  // -------------------------------------------------------------------------
  return (
    <>
      <DashboardHeader
        title={tNav("settings")}
        subtitle={t("subtitle")}
      />

      <div className="p-6">
        {/* Export buttons */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {t("myProfile")}
          </h2>
          <ExportButtons />
        </div>

        {/* Mobile: accordion layout */}
        <div className="flex flex-col gap-3 lg:hidden">
          {SECTIONS.map(({ id, icon }) => (
            <AccordionSection
              key={id}
              id={id}
              label={t(`${id}.title`)}
              icon={icon}
            >
              {renderSectionContent(id)}
            </AccordionSection>
          ))}
        </div>

        {/* Desktop: 2-panel layout */}
        <div className="hidden gap-6 lg:grid lg:grid-cols-[240px_1fr]">
          {/* Left panel — section navigation */}
          <nav
            aria-label={t("sectionNav")}
            className="flex flex-col gap-1"
          >
            {SECTIONS.map(({ id, icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                aria-current={activeSection === id ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm font-medium transition-colors",
                  activeSection === id
                    ? "bg-teal-50 text-teal-700"
                    : "text-foreground hover:bg-gray-100"
                )}
              >
                <span
                  className={cn(
                    "shrink-0",
                    activeSection === id
                      ? "text-teal-600"
                      : "text-muted-foreground"
                  )}
                  aria-hidden="true"
                >
                  {icon}
                </span>
                {t(`${id}.title`)}
              </button>
            ))}
          </nav>

          {/* Right panel — active section form */}
          <SectionPanel id={activeSection}>
            {renderSectionContent(activeSection)}
          </SectionPanel>
        </div>
      </div>
    </>
  )
}
