"use client"

/**
 * @module app/(dashboard)/events/new/page
 * @description Event creation form — US-WEB-205.
 *
 * Multi-section form allowing healthcare staff to record a diabetes event
 * for a patient. Sections are shown/hidden dynamically based on the selected
 * event types (multi-select chip group).
 *
 * Sections:
 *   1. Date/time header — native datetime-local input
 *   2. Event type selector — multi-select chip group (5 types)
 *   3. Dynamic sections per type:
 *      - glycemia: glucose value (mg/dL)
 *      - insulinMeal: carbohydrates, bolus dose, basal dose
 *      - physicalActivity: activity type + duration
 *      - context: context type
 *      - occasional: weight, HbA1c, ketones, blood pressure
 *   4. Comment — always visible when at least one type is selected
 *   5. Action bar — Save (primary) + Cancel (secondary)
 *
 * Validation mirrors the Zod schema in src/lib/validators/events.ts.
 * Unsaved changes are protected by a beforeunload listener.
 *
 * On success, POSTs to /api/events and redirects to /dashboard.
 *
 * @see src/lib/validators/events.ts — canonical validation rules
 * @see src/app/api/events/route.ts — API endpoint
 *
 * Clinical safety:
 * - Glucose value range: 20–600 mg/dL (Zod schema)
 * - Bolus dose max: 25 U (matches CLINICAL_BOUNDS.MAX_SINGLE_BOLUS)
 * - Basal dose max: 10 U/h
 * - HbA1c range: 4.0–14.0 %
 * - Ketones range: 0–20 mmol/L
 * - Activity duration max: 600 min
 * - Blood pressure: systolic 50–300, diastolic 20–200 mmHg
 *
 * Analytics events dispatched:
 * - event_form_view: page load
 * - event_type_selected: when chip toggled on
 * - event_type_deselected: when chip toggled off
 * - event_form_submit_attempt: on Save click
 * - event_form_submit_success: on 201 response
 * - event_form_submit_error: on non-2xx response
 * - event_form_cancel: on Cancel click
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { DiabeoTextField } from "@/components/diabeo/DiabeoTextField"
import { DiabeoFormSection } from "@/components/diabeo/DiabeoFormSection"
import { AlertBanner } from "@/components/diabeo/AlertBanner"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { type DiabetesEventInput } from "@/lib/validators/events"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventType =
  | "glycemia"
  | "insulinMeal"
  | "physicalActivity"
  | "context"
  | "occasional"

type ActivityType =
  | "walking"
  | "running"
  | "cycling"
  | "swimming"
  | "gym"
  | "sports"
  | "housework"
  | "gardening"
  | "yoga"
  | "other"

type ContextType =
  | "stress"
  | "illness"
  | "menstruation"
  | "alcohol"
  | "travel"
  | "sleepIssue"
  | "medication"
  | "hypoglycemia"
  | "hyperglycemia"
  | "other"

interface FormState {
  eventDate: string
  eventTypes: EventType[]
  glycemiaValue: string
  carbohydrates: string
  bolusDose: string
  basalDose: string
  activityType: ActivityType | ""
  activityDuration: string
  contextType: ContextType | ""
  weight: string
  hba1c: string
  ketones: string
  systolicPressure: string
  diastolicPressure: string
  comment: string
}

interface FormErrors {
  eventDate?: string
  eventTypes?: string
  glycemiaValue?: string
  carbohydrates?: string
  bolusDose?: string
  basalDose?: string
  activityType?: string
  activityDuration?: string
  contextType?: string
  weight?: string
  hba1c?: string
  ketones?: string
  systolicPressure?: string
  diastolicPressure?: string
  comment?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_TYPES: EventType[] = [
  "glycemia",
  "insulinMeal",
  "physicalActivity",
  "context",
  "occasional",
]

const ACTIVITY_TYPES: ActivityType[] = [
  "walking",
  "running",
  "cycling",
  "swimming",
  "gym",
  "sports",
  "housework",
  "gardening",
  "yoga",
  "other",
]

const CONTEXT_TYPES: ContextType[] = [
  "stress",
  "illness",
  "menstruation",
  "alcohol",
  "travel",
  "sleepIssue",
  "medication",
  "hypoglycemia",
  "hyperglycemia",
  "other",
]

/** Format the current datetime to a value compatible with datetime-local input */
function formatDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Parse a string to a float, returning undefined if empty or NaN */
function parseOptionalFloat(value: string): number | undefined {
  if (value.trim() === "") return undefined
  const n = parseFloat(value)
  return isNaN(n) ? undefined : n
}

/** Parse a string to an integer, returning undefined if empty or NaN */
function parseOptionalInt(value: string): number | undefined {
  if (value.trim() === "") return undefined
  const n = parseInt(value, 10)
  return isNaN(n) ? undefined : n
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * NewEventPage
 *
 * Client component. Renders the multi-section diabetes event creation form.
 * Uses local state for form values and errors — no form library to keep
 * the bundle lean and maintain direct control over clinical validation.
 */
export default function NewEventPage() {
  const router = useRouter()
  const t = useTranslations("events")
  const tCommon = useTranslations("common")

  // -------------------------------------------------------------------------
  // Form state
  // -------------------------------------------------------------------------

  const [form, setForm] = React.useState<FormState>({
    eventDate: formatDatetimeLocal(new Date()),
    eventTypes: [],
    glycemiaValue: "",
    carbohydrates: "",
    bolusDose: "",
    basalDose: "",
    activityType: "",
    activityDuration: "",
    contextType: "",
    weight: "",
    hba1c: "",
    ketones: "",
    systolicPressure: "",
    diastolicPressure: "",
    comment: "",
  })

  const [errors, setErrors] = React.useState<FormErrors>({})
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  /** Track whether form has been dirtied for unsaved changes protection */
  const isDirty = React.useRef(false)

  // -------------------------------------------------------------------------
  // Analytics on mount
  // -------------------------------------------------------------------------

  React.useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("diabeo_analytics", {
        detail: { event: "event_form_view" },
      })
    )
  }, [])

  // -------------------------------------------------------------------------
  // Unsaved changes protection
  // -------------------------------------------------------------------------

  React.useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty.current) {
        e.preventDefault()
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [])

  // -------------------------------------------------------------------------
  // Field helpers
  // -------------------------------------------------------------------------

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    isDirty.current = true
    setForm((prev) => ({ ...prev, [key]: value }))
    // Clear the error for this field on change
    if (errors[key as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }))
    }
  }

  const toggleEventType = (type: EventType) => {
    isDirty.current = true
    setForm((prev) => {
      const next = prev.eventTypes.includes(type)
        ? prev.eventTypes.filter((t) => t !== type)
        : [...prev.eventTypes, type]
      return { ...prev, eventTypes: next }
    })

    // Analytics
    const alreadySelected = form.eventTypes.includes(type)
    window.dispatchEvent(
      new CustomEvent("diabeo_analytics", {
        detail: {
          event: alreadySelected ? "event_type_deselected" : "event_type_selected",
          eventType: type,
        },
      })
    )

    if (errors.eventTypes) {
      setErrors((prev) => ({ ...prev, eventTypes: undefined }))
    }
  }

  // -------------------------------------------------------------------------
  // Client-side validation — mirrors Zod schema ranges
  // -------------------------------------------------------------------------

  const validate = (): boolean => {
    const next: FormErrors = {}

    if (!form.eventDate) {
      next.eventDate = t("errors.eventDateRequired")
    }

    if (form.eventTypes.length === 0) {
      next.eventTypes = t("errors.eventTypesRequired")
    }

    if (form.eventTypes.includes("glycemia")) {
      const v = parseOptionalFloat(form.glycemiaValue)
      if (v === undefined) {
        next.glycemiaValue = t("errors.glycemiaValueRequired")
      } else if (v < 20 || v > 600) {
        next.glycemiaValue = t("errors.glycemiaValueRange")
      }
    }

    if (form.eventTypes.includes("insulinMeal")) {
      const carbs = parseOptionalFloat(form.carbohydrates)
      if (carbs === undefined) {
        next.carbohydrates = t("errors.carbohydratesRequired")
      } else if (carbs < 0) {
        next.carbohydrates = t("errors.carbohydratesMin")
      } else if (carbs > 500) {
        next.carbohydrates = t("errors.carbohydratesMax")
      }
      const bolus = parseOptionalFloat(form.bolusDose)
      if (bolus !== undefined && (bolus < 0 || bolus > 25)) {
        next.bolusDose = t("errors.bolusDoseRange")
      }
      const basal = parseOptionalFloat(form.basalDose)
      if (basal !== undefined && (basal < 0 || basal > 10)) {
        next.basalDose = t("errors.basalDoseRange")
      }
    }

    if (form.eventTypes.includes("physicalActivity")) {
      if (!form.activityType) {
        next.activityType = t("errors.activityTypeRequired")
      }
      const dur = parseOptionalInt(form.activityDuration)
      if (dur === undefined) {
        next.activityDuration = t("errors.activityDurationRequired")
      } else if (dur <= 0 || dur > 600) {
        next.activityDuration = t("errors.activityDurationRange")
      }
    }

    if (form.eventTypes.includes("context")) {
      if (!form.contextType) {
        next.contextType = t("errors.contextTypeRequired")
      }
    }

    if (form.eventTypes.includes("occasional")) {
      const weight = parseOptionalFloat(form.weight)
      if (weight !== undefined && (weight <= 0 || weight > 300)) {
        next.weight = t("errors.weightRange")
      }
      const hba1c = parseOptionalFloat(form.hba1c)
      if (hba1c !== undefined && (hba1c < 4.0 || hba1c > 14.0)) {
        next.hba1c = t("errors.hba1cRange")
      }
      const ketones = parseOptionalFloat(form.ketones)
      if (ketones !== undefined && (ketones < 0 || ketones > 20)) {
        next.ketones = t("errors.ketonesRange")
      }
      const sys = parseOptionalInt(form.systolicPressure)
      if (sys !== undefined && (sys < 50 || sys > 300)) {
        next.systolicPressure = t("errors.systolicPressureRange")
      }
      const dia = parseOptionalInt(form.diastolicPressure)
      if (dia !== undefined && (dia < 20 || dia > 200)) {
        next.diastolicPressure = t("errors.diastolicPressureRange")
      }
    }

    const comment = form.comment.trim()
    if (comment && comment.length > 1000) {
      next.comment = t("errors.commentMax")
    }

    setErrors(next)
    return Object.keys(next).length === 0
  }

  // -------------------------------------------------------------------------
  // Build API payload — matches DiabetesEventInput type
  // -------------------------------------------------------------------------

  const buildPayload = (): DiabetesEventInput => {
    // Convert datetime-local string to ISO 8601
    const eventDate = new Date(form.eventDate).toISOString()

    const payload: DiabetesEventInput = {
      eventDate,
      eventTypes: form.eventTypes,
    }

    if (form.eventTypes.includes("glycemia")) {
      payload.glycemiaValue = parseOptionalFloat(form.glycemiaValue)
    }
    if (form.eventTypes.includes("insulinMeal")) {
      payload.carbohydrates = parseOptionalFloat(form.carbohydrates)
      const bolus = parseOptionalFloat(form.bolusDose)
      if (bolus !== undefined) payload.bolusDose = bolus
      const basal = parseOptionalFloat(form.basalDose)
      if (basal !== undefined) payload.basalDose = basal
    }
    if (form.eventTypes.includes("physicalActivity")) {
      payload.activityType = form.activityType as ActivityType
      payload.activityDuration = parseOptionalInt(form.activityDuration)
    }
    if (form.eventTypes.includes("context")) {
      payload.contextType = form.contextType as ContextType
    }
    if (form.eventTypes.includes("occasional")) {
      const weight = parseOptionalFloat(form.weight)
      if (weight !== undefined) payload.weight = weight
      const hba1c = parseOptionalFloat(form.hba1c)
      if (hba1c !== undefined) payload.hba1c = hba1c
      const ketones = parseOptionalFloat(form.ketones)
      if (ketones !== undefined) payload.ketones = ketones
      const sys = parseOptionalInt(form.systolicPressure)
      if (sys !== undefined) payload.systolicPressure = sys
      const dia = parseOptionalInt(form.diastolicPressure)
      if (dia !== undefined) payload.diastolicPressure = dia
    }

    const comment = form.comment.trim()
    if (comment) payload.comment = comment

    return payload
  }

  // -------------------------------------------------------------------------
  // Submit handler
  // -------------------------------------------------------------------------

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)

    window.dispatchEvent(
      new CustomEvent("diabeo_analytics", {
        detail: { event: "event_form_submit_attempt" },
      })
    )

    if (!validate()) {
      // Focus the first invalid field for accessibility
      const firstErrorField = Object.keys(errors)[0]
      if (firstErrorField) {
        const el = document.getElementById(`event-${firstErrorField}`)
        el?.focus()
      }
      return
    }

    setIsSubmitting(true)

    try {
      const payload = buildPayload()
      const response = await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      })

      if (response.status === 201) {
        isDirty.current = false
        window.dispatchEvent(
          new CustomEvent("diabeo_analytics", {
            detail: { event: "event_form_submit_success" },
          })
        )
        router.push("/dashboard")
        return
      }

      // Handle known error statuses
      let errorKey = "errors.submitFailed"
      if (response.status === 400) errorKey = "errors.validationFailed"
      else if (response.status === 401) errorKey = "errors.unauthorized"
      else if (response.status === 403) errorKey = "errors.gdprConsentRequired"
      else if (response.status === 404) errorKey = "errors.patientNotFound"

      window.dispatchEvent(
        new CustomEvent("diabeo_analytics", {
          detail: { event: "event_form_submit_error", status: response.status },
        })
      )
      setSubmitError(t(errorKey))
    } catch {
      window.dispatchEvent(
        new CustomEvent("diabeo_analytics", {
          detail: { event: "event_form_submit_error", status: "network" },
        })
      )
      setSubmitError(t("errors.networkError"))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    window.dispatchEvent(
      new CustomEvent("diabeo_analytics", {
        detail: { event: "event_form_cancel" },
      })
    )
    router.back()
  }

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const hasTypes = form.eventTypes.length > 0
  const showGlycemia = form.eventTypes.includes("glycemia")
  const showInsulinMeal = form.eventTypes.includes("insulinMeal")
  const showActivity = form.eventTypes.includes("physicalActivity")
  const showContext = form.eventTypes.includes("context")
  const showOccasional = form.eventTypes.includes("occasional")

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      <DashboardHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />

      <div className="p-6">
        <form
          onSubmit={handleSubmit}
          noValidate
          aria-label={t("formAriaLabel")}
          className="mx-auto max-w-2xl space-y-6"
        >
          {/* ----------------------------------------------------------------
           * Submit error banner
           * -------------------------------------------------------------- */}
          {submitError && (
            <AlertBanner
              severity="warning"
              title={t("errors.submitErrorTitle")}
              description={submitError}
              dismissible
              onDismiss={() => setSubmitError(null)}
            />
          )}

          {/* ----------------------------------------------------------------
           * Section 1 — Date / Time
           * -------------------------------------------------------------- */}
          <Card>
            <CardContent className="pt-6">
              <DiabeoFormSection title={t("sections.dateTime")}>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="event-datetime">
                    {t("fields.eventDate")}
                    <span className="ms-0.5 text-feedback-error" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <input
                    id="event-datetime"
                    type="datetime-local"
                    required
                    aria-required="true"
                    aria-invalid={errors.eventDate ? true : undefined}
                    aria-describedby={errors.eventDate ? "event-datetime-error" : undefined}
                    value={form.eventDate}
                    onChange={(e) => setField("eventDate", e.target.value)}
                    className={cn(
                      "h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm",
                      "transition-colors focus-visible:outline-none focus-visible:ring-1",
                      "focus-visible:ring-teal-600",
                      errors.eventDate
                        ? "border-feedback-error focus-visible:ring-feedback-error"
                        : "border-input"
                    )}
                  />
                  {errors.eventDate && (
                    <p
                      id="event-datetime-error"
                      role="alert"
                      className="text-xs font-medium text-feedback-error"
                    >
                      {errors.eventDate}
                    </p>
                  )}
                </div>
              </DiabeoFormSection>
            </CardContent>
          </Card>

          {/* ----------------------------------------------------------------
           * Section 2 — Event type selector (multi-select chips)
           * -------------------------------------------------------------- */}
          <Card>
            <CardContent className="pt-6">
              <DiabeoFormSection
                title={t("sections.eventType")}
                description={t("sections.eventTypeHint")}
              >
                <div
                  role="group"
                  aria-label={t("fields.eventTypes")}
                  aria-required="true"
                  className="flex flex-wrap gap-2"
                >
                  {EVENT_TYPES.map((type) => {
                    const isSelected = form.eventTypes.includes(type)
                    return (
                      <button
                        key={type}
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        onClick={() => toggleEventType(type)}
                        className={cn(
                          "rounded-full px-4 py-2 text-sm font-medium",
                          "border transition-all duration-150",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600",
                          isSelected
                            ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                            : "border-input bg-background text-foreground hover:border-teal-400 hover:bg-teal-50"
                        )}
                      >
                        {t(`types.${type}`)}
                      </button>
                    )
                  })}
                </div>

                {errors.eventTypes && (
                  <p role="alert" className="text-xs font-medium text-feedback-error">
                    {errors.eventTypes}
                  </p>
                )}
              </DiabeoFormSection>
            </CardContent>
          </Card>

          {/* ----------------------------------------------------------------
           * Section 3a — Glycemia
           * -------------------------------------------------------------- */}
          {showGlycemia && (
            <Card>
              <CardContent className="pt-6">
                <DiabeoFormSection
                  title={t("sections.glycemia")}
                  description={t("sections.glycemiaHint")}
                >
                  <DiabeoTextField
                    id="event-glycemiaValue"
                    label={t("fields.glycemiaValue")}
                    type="number"
                    inputMode="decimal"
                    min={20}
                    max={600}
                    step="1"
                    required
                    placeholder="120"
                    value={form.glycemiaValue}
                    onChange={(e) => setField("glycemiaValue", e.target.value)}
                    error={errors.glycemiaValue}
                    hint={t("hints.glycemiaValue")}
                  />
                </DiabeoFormSection>
              </CardContent>
            </Card>
          )}

          {/* ----------------------------------------------------------------
           * Section 3b — Insulin / Meal
           * -------------------------------------------------------------- */}
          {showInsulinMeal && (
            <Card>
              <CardContent className="pt-6">
                <DiabeoFormSection
                  title={t("sections.insulinMeal")}
                  description={t("sections.insulinMealHint")}
                >
                  <DiabeoTextField
                    id="event-carbohydrates"
                    label={t("fields.carbohydrates")}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={500}
                    step="1"
                    required
                    placeholder="60"
                    value={form.carbohydrates}
                    onChange={(e) => setField("carbohydrates", e.target.value)}
                    error={errors.carbohydrates}
                    hint={t("hints.carbohydrates")}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <DiabeoTextField
                      id="event-bolusDose"
                      label={t("fields.bolusDose")}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={25}
                      step="0.5"
                      placeholder="4.0"
                      value={form.bolusDose}
                      onChange={(e) => setField("bolusDose", e.target.value)}
                      error={errors.bolusDose}
                      hint={t("hints.bolusDose")}
                    />
                    <DiabeoTextField
                      id="event-basalDose"
                      label={t("fields.basalDose")}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={10}
                      step="0.1"
                      placeholder="0.8"
                      value={form.basalDose}
                      onChange={(e) => setField("basalDose", e.target.value)}
                      error={errors.basalDose}
                      hint={t("hints.basalDose")}
                    />
                  </div>
                </DiabeoFormSection>
              </CardContent>
            </Card>
          )}

          {/* ----------------------------------------------------------------
           * Section 3c — Physical Activity
           * -------------------------------------------------------------- */}
          {showActivity && (
            <Card>
              <CardContent className="pt-6">
                <DiabeoFormSection
                  title={t("sections.physicalActivity")}
                  description={t("sections.physicalActivityHint")}
                >
                  {/* Activity type dropdown */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="activity-type">
                      {t("fields.activityType")}
                      <span className="ms-0.5 text-feedback-error" aria-hidden="true">
                        *
                      </span>
                    </Label>
                    <select
                      id="event-activityType"
                      required
                      aria-required="true"
                      aria-invalid={errors.activityType ? true : undefined}
                      aria-describedby={
                        errors.activityType ? "event-activityType-error" : undefined
                      }
                      value={form.activityType}
                      onChange={(e) =>
                        setField("activityType", e.target.value as ActivityType)
                      }
                      className={cn(
                        "h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm",
                        "transition-colors focus-visible:outline-none focus-visible:ring-1",
                        "focus-visible:ring-teal-600",
                        errors.activityType
                          ? "border-feedback-error focus-visible:ring-feedback-error"
                          : "border-input"
                      )}
                    >
                      <option value="" disabled>
                        {t("placeholders.activityType")}
                      </option>
                      {ACTIVITY_TYPES.map((at) => (
                        <option key={at} value={at}>
                          {t(`activityTypes.${at}`)}
                        </option>
                      ))}
                    </select>
                    {errors.activityType && (
                      <p
                        id="event-activityType-error"
                        role="alert"
                        className="text-xs font-medium text-feedback-error"
                      >
                        {errors.activityType}
                      </p>
                    )}
                  </div>

                  <DiabeoTextField
                    id="event-activityDuration"
                    label={t("fields.activityDuration")}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={600}
                    step="1"
                    required
                    placeholder="30"
                    value={form.activityDuration}
                    onChange={(e) => setField("activityDuration", e.target.value)}
                    error={errors.activityDuration}
                    hint={t("hints.activityDuration")}
                  />
                </DiabeoFormSection>
              </CardContent>
            </Card>
          )}

          {/* ----------------------------------------------------------------
           * Section 3d — Context
           * -------------------------------------------------------------- */}
          {showContext && (
            <Card>
              <CardContent className="pt-6">
                <DiabeoFormSection
                  title={t("sections.context")}
                  description={t("sections.contextHint")}
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="context-type">
                      {t("fields.contextType")}
                      <span className="ms-0.5 text-feedback-error" aria-hidden="true">
                        *
                      </span>
                    </Label>
                    <select
                      id="event-contextType"
                      required
                      aria-required="true"
                      aria-invalid={errors.contextType ? true : undefined}
                      aria-describedby={
                        errors.contextType ? "event-contextType-error" : undefined
                      }
                      value={form.contextType}
                      onChange={(e) =>
                        setField("contextType", e.target.value as ContextType)
                      }
                      className={cn(
                        "h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm",
                        "transition-colors focus-visible:outline-none focus-visible:ring-1",
                        "focus-visible:ring-teal-600",
                        errors.contextType
                          ? "border-feedback-error focus-visible:ring-feedback-error"
                          : "border-input"
                      )}
                    >
                      <option value="" disabled>
                        {t("placeholders.contextType")}
                      </option>
                      {CONTEXT_TYPES.map((ct) => (
                        <option key={ct} value={ct}>
                          {t(`contextTypes.${ct}`)}
                        </option>
                      ))}
                    </select>
                    {errors.contextType && (
                      <p
                        id="event-contextType-error"
                        role="alert"
                        className="text-xs font-medium text-feedback-error"
                      >
                        {errors.contextType}
                      </p>
                    )}
                  </div>
                </DiabeoFormSection>
              </CardContent>
            </Card>
          )}

          {/* ----------------------------------------------------------------
           * Section 3e — Occasional measurements
           * -------------------------------------------------------------- */}
          {showOccasional && (
            <Card>
              <CardContent className="pt-6">
                <DiabeoFormSection
                  title={t("sections.occasional")}
                  description={t("sections.occasionalHint")}
                >
                  <div className="grid grid-cols-2 gap-4">
                    <DiabeoTextField
                      id="event-weight"
                      label={t("fields.weight")}
                      type="number"
                      inputMode="decimal"
                      min={1}
                      max={300}
                      step="0.1"
                      placeholder="70.5"
                      value={form.weight}
                      onChange={(e) => setField("weight", e.target.value)}
                      error={errors.weight}
                      hint={t("hints.weight")}
                    />
                    <DiabeoTextField
                      id="event-hba1c"
                      label={t("fields.hba1c")}
                      type="number"
                      inputMode="decimal"
                      min={4.0}
                      max={14.0}
                      step="0.1"
                      placeholder="7.2"
                      value={form.hba1c}
                      onChange={(e) => setField("hba1c", e.target.value)}
                      error={errors.hba1c}
                      hint={t("hints.hba1c")}
                    />
                  </div>
                  <DiabeoTextField
                    id="event-ketones"
                    label={t("fields.ketones")}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={20}
                    step="0.1"
                    placeholder="0.5"
                    value={form.ketones}
                    onChange={(e) => setField("ketones", e.target.value)}
                    error={errors.ketones}
                    hint={t("hints.ketones")}
                  />
                  {/* Blood pressure — systolic + diastolic */}
                  <div className="grid grid-cols-2 gap-4">
                    <DiabeoTextField
                      id="event-systolicPressure"
                      label={t("fields.systolicPressure")}
                      type="number"
                      inputMode="numeric"
                      min={50}
                      max={300}
                      step="1"
                      placeholder="120"
                      value={form.systolicPressure}
                      onChange={(e) => setField("systolicPressure", e.target.value)}
                      error={errors.systolicPressure}
                      hint={t("hints.systolicPressure")}
                    />
                    <DiabeoTextField
                      id="event-diastolicPressure"
                      label={t("fields.diastolicPressure")}
                      type="number"
                      inputMode="numeric"
                      min={20}
                      max={200}
                      step="1"
                      placeholder="80"
                      value={form.diastolicPressure}
                      onChange={(e) => setField("diastolicPressure", e.target.value)}
                      error={errors.diastolicPressure}
                      hint={t("hints.diastolicPressure")}
                    />
                  </div>
                </DiabeoFormSection>
              </CardContent>
            </Card>
          )}

          {/* ----------------------------------------------------------------
           * Section 4 — Comment (always visible when type is selected)
           * -------------------------------------------------------------- */}
          {hasTypes && (
            <Card>
              <CardContent className="pt-6">
                <DiabeoFormSection title={t("sections.comment")}>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="event-comment">{t("fields.comment")}</Label>
                    <textarea
                      id="event-comment"
                      rows={3}
                      maxLength={1000}
                      aria-invalid={errors.comment ? true : undefined}
                      aria-describedby={
                        errors.comment
                          ? "event-comment-error"
                          : "event-comment-hint"
                      }
                      value={form.comment}
                      onChange={(e) => setField("comment", e.target.value)}
                      placeholder={t("placeholders.comment")}
                      className={cn(
                        "w-full resize-y rounded-md border bg-background px-3 py-2 text-sm",
                        "shadow-sm placeholder:text-muted-foreground",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-600",
                        "transition-colors",
                        errors.comment
                          ? "border-feedback-error focus-visible:ring-feedback-error"
                          : "border-input"
                      )}
                    />
                    {errors.comment ? (
                      <p
                        id="event-comment-error"
                        role="alert"
                        className="text-xs font-medium text-feedback-error"
                      >
                        {errors.comment}
                      </p>
                    ) : (
                      <p
                        id="event-comment-hint"
                        className="text-xs text-muted-foreground"
                      >
                        {t("hints.comment", {
                          remaining: 1000 - form.comment.length,
                        })}
                      </p>
                    )}
                  </div>
                </DiabeoFormSection>
              </CardContent>
            </Card>
          )}

          {/* ----------------------------------------------------------------
           * Section 5 — Action buttons
           * -------------------------------------------------------------- */}
          <div className="flex items-center justify-end gap-3">
            <DiabeoButton
              type="button"
              variant="diabeoTertiary"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              {tCommon("cancel")}
            </DiabeoButton>
            <DiabeoButton
              type="submit"
              variant="diabeoPrimary"
              loading={isSubmitting}
              disabled={!hasTypes}
              aria-disabled={!hasTypes}
            >
              {isSubmitting ? t("saving") : tCommon("save")}
            </DiabeoButton>
          </div>
        </form>
      </div>
    </>
  )
}
