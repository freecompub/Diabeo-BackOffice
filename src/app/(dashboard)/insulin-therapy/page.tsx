"use client"

/**
 * Insulin Therapy Settings page — WEB-209
 *
 * Allows the authenticated patient (or clinical staff) to configure:
 * - Basic insulin parameters (type, target glucose, action duration)
 * - Insulin Sensitivity Factors (ISF) with 24h timeline visualization
 * - Carbohydrate Ratios (ICR) with optional meal label
 * - Advanced settings (IOB, extended bolus)
 *
 * Clinical bounds applied server-side. All API calls use credentials: "include".
 * Unsaved changes are protected via beforeunload and a confirmation dialog.
 *
 * Security: no plaintext health data logged.
 * i18n: "insulinTherapy" namespace (fr/en/ar).
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslations } from "next-intl"
import { Plus, Pencil, Trash2, AlertTriangle, Clock } from "lucide-react"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { DiabeoFormSection } from "@/components/diabeo/DiabeoFormSection"
import { DiabeoTextField } from "@/components/diabeo/DiabeoTextField"
import { DiabeoToggle } from "@/components/diabeo/DiabeoToggle"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { AlertBanner } from "@/components/diabeo/AlertBanner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
import { analyzeSlotCoverage } from "@/lib/insulin/slot-coverage"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IsfSlot {
  id?: number
  startHour: number
  endHour: number
  sensitivityFactorGl: number
}

interface IcrSlot {
  id?: number
  startHour: number
  endHour: number
  gramsPerUnit: number
  mealLabel?: string
}

interface InsulinSettings {
  bolusInsulinBrand: string
  basalInsulinBrand?: string
  insulinActionDuration: number
  targetGlucoseMgdl?: number
  considerIob: boolean
  extendedBolusEnabled: boolean
  extendedBolusPercent: number
  extendedBolusDurationMin: number
}

interface SlotDialogState {
  open: boolean
  mode: "add" | "edit"
  type: "isf" | "icr"
  index: number | null
}

const BOLUS_BRANDS = ["humalog", "novorapid", "apidra", "fiasp", "other"] as const
const BASAL_BRANDS = ["lantus", "levemir", "tresiba", "other"] as const

const API_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
}

// ---------------------------------------------------------------------------
// 24h Timeline visualisation
// ---------------------------------------------------------------------------

function HourTimeline({
  slots,
  colorClass,
  label,
}: {
  slots: Array<{ startHour: number; endHour: number }>
  colorClass: string
  label: string
}) {
  const t = useTranslations("insulinTherapy")
  const covered = new Array<boolean>(24).fill(false)
  for (const s of slots) {
    for (let h = s.startHour; h < s.endHour; h++) {
      covered[h] = true
    }
  }

  return (
    <div aria-label={label} className="flex w-full gap-px">
      {covered.map((active, hour) => (
        <div
          key={hour}
          title={t("hourAxisTick", { hour })}
          className={cn(
            "h-4 flex-1 rounded-sm transition-colors",
            active ? colorClass : "bg-gray-200"
          )}
          aria-label={`${hour}:00 — ${active ? t("hourCovered") : t("hourNotCovered")}`}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Slot row component
// ---------------------------------------------------------------------------

function SlotRow({
  label,
  value,
  valueUnit,
  onEdit,
  onDelete,
  editLabel,
  deleteLabel,
}: {
  label: string
  value: string
  valueUnit: string
  onEdit: () => void
  onDelete: () => void
  editLabel: string
  deleteLabel: string
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-teal-700">
          {value} <span className="text-xs font-normal text-muted-foreground">{valueUnit}</span>
        </span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel}
          className="rounded p-1 text-muted-foreground hover:bg-white hover:text-teal-600 focus-visible:outline-2 focus-visible:outline-teal-600"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={deleteLabel}
          className="rounded p-1 text-muted-foreground hover:bg-white hover:text-red-500 focus-visible:outline-2 focus-visible:outline-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InsulinTherapyPage() {
  const t = useTranslations("insulinTherapy")
  const tCommon = useTranslations("common")

  // ── State ──────────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const [settings, setSettings] = useState<InsulinSettings>({
    bolusInsulinBrand: "novorapid",
    basalInsulinBrand: "lantus",
    insulinActionDuration: 4,
    targetGlucoseMgdl: 100,
    considerIob: true,
    extendedBolusEnabled: false,
    extendedBolusPercent: 50,
    extendedBolusDurationMin: 60,
  })

  const [isfSlots, setIsfSlots] = useState<IsfSlot[]>([])
  const [icrSlots, setIcrSlots] = useState<IcrSlot[]>([])

  // Slot dialog
  const [slotDialog, setSlotDialog] = useState<SlotDialogState>({
    open: false,
    mode: "add",
    type: "isf",
    index: null,
  })
  const [slotStartHour, setSlotStartHour] = useState(0)
  const [slotEndHour, setSlotEndHour] = useState(8)
  const [slotValue, setSlotValue] = useState("")
  const [slotMealLabel, setSlotMealLabel] = useState("")
  const [slotError, setSlotError] = useState<string | null>(null)

  // Track original for dirty detection
  const originalRef = useRef<string>("")
  // US-2657 (grouped-only, ADR #23) — snapshots ISF/ICR séparés : le PUT groupé n'est envoyé
  // que pour le paramètre RÉELLEMENT modifié (évite un PUT vide/inutile sur un paramètre
  // non touché, ex. un patient sans ISF configuré qui ne fait que changer sa marque d'insuline).
  const originalIsfRef = useRef<string>("[]")
  const originalIcrRef = useRef<string>("[]")

  // ── Unsaved changes guard ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault()
      }
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [hasChanges])

  // ── Fetch data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const [settingsRes, isfRes, icrRes] = await Promise.all([
          fetch("/api/insulin-therapy/settings", {
            credentials: "include",
            headers: API_HEADERS,
          }),
          fetch("/api/insulin-therapy/sensitivity-factors", {
            credentials: "include",
            headers: API_HEADERS,
          }),
          fetch("/api/insulin-therapy/carb-ratios", {
            credentials: "include",
            headers: API_HEADERS,
          }),
        ])

        // H3: collect fetched values first so the snapshot reflects actual server state
        let fetchedSettings: InsulinSettings = {
          bolusInsulinBrand: "novorapid",
          basalInsulinBrand: "lantus",
          insulinActionDuration: 4,
          targetGlucoseMgdl: 100,
          considerIob: true,
          extendedBolusEnabled: false,
          extendedBolusPercent: 50,
          extendedBolusDurationMin: 60,
        }
        let fetchedIsf: IsfSlot[] = []
        let fetchedIcr: IcrSlot[] = []

        if (settingsRes.ok) {
          const data = await settingsRes.json() as Partial<InsulinSettings>
          fetchedSettings = { ...fetchedSettings, ...data }
          setSettings(fetchedSettings)
        }
        if (isfRes.ok) {
          fetchedIsf = await isfRes.json() as IsfSlot[]
          setIsfSlots(fetchedIsf)
        }
        if (icrRes.ok) {
          fetchedIcr = await icrRes.json() as IcrSlot[]
          setIcrSlots(fetchedIcr)
        }

        // H3 fix: snapshot is taken AFTER state is set, using the fetched values
        originalRef.current = JSON.stringify({ settings: fetchedSettings, isfSlots: fetchedIsf, icrSlots: fetchedIcr })
        originalIsfRef.current = JSON.stringify(fetchedIsf)
        originalIcrRef.current = JSON.stringify(fetchedIcr)
      } catch {
        setError(t("errorLoading"))
      } finally {
        setIsLoading(false)
      }
    }
    void fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mark dirty whenever settings/slots change after initial load
  useEffect(() => {
    if (!isLoading) {
      const current = JSON.stringify({ settings, isfSlots, icrSlots })
      setHasChanges(current !== originalRef.current)
    }
  }, [settings, isfSlots, icrSlots, isLoading])

  // ── Helpers ────────────────────────────────────────────────────────────────
  const updateSettings = useCallback(<K extends keyof InsulinSettings>(
    key: K,
    value: InsulinSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  const formatSlotHours = (start: number, end: number) =>
    `${String(start).padStart(2, "0")}:00 – ${String(end).padStart(2, "0")}:00`

  // ── Save ───────────────────────────────────────────────────────────────────
  /**
   * US-2657 (grouped-only, ADR #23) — l'édition ISF/ICR se fait **exclusivement en bloc** :
   * plus de `POST`/`PATCH`/`DELETE` par-créneau (routes retirées serveur). `handleSaveSlot`/
   * `deleteSlot` mutent uniquement l'état LOCAL (`isfSlots`/`icrSlots`) ; ici, à l'enregistrement,
   * UN SEUL `PUT` par paramètre envoie le **jeu complet** (remplace tout côté serveur) — mais
   * seulement si ce paramètre a réellement changé depuis le chargement (`originalIsfRef`/
   * `originalIcrRef`), pour éviter un `PUT` vide (rejeté `emptySlotSet`, 409) sur un patient sans
   * ISF/ICR configuré qui ne fait que modifier un autre champ (ex. marque d'insuline).
   */
  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    try {
      const isfChanged = JSON.stringify(isfSlots) !== originalIsfRef.current
      const icrChanged = JSON.stringify(icrSlots) !== originalIcrRef.current

      // US-2657 (grouped-only) : le PUT groupé exige un jeu NON vide couvrant 24 h sans trou ni chevauchement
      // (sinon `emptySlotSet`/`slotGap`/`slotOverlap` côté serveur). On gate CÔTÉ CLIENT sur les paramètres
      // modifiés, AVANT tout appel réseau → message clair + pas de save partiel (réglages sans les créneaux).
      const invalidSet = (slots: { startHour: number; endHour: number }[]): boolean => {
        if (slots.length === 0) return true
        const cov = analyzeSlotCoverage(slots.map((s) => ({ start: s.startHour * 60, end: s.endHour * 60 })))
        return cov.hasGap || cov.hasOverlap
      }
      if ((isfChanged && invalidSet(isfSlots)) || (icrChanged && invalidSet(icrSlots))) {
        setError(t("slotCoverageError"))
        setIsSaving(false)
        return
      }

      // H2 fix: send ALL settings fields, not just brand/duration
      const res = await fetch("/api/insulin-therapy/settings", {
        method: "PUT",
        credentials: "include",
        headers: API_HEADERS,
        body: JSON.stringify({
          bolusInsulinBrand: settings.bolusInsulinBrand,
          basalInsulinBrand: settings.basalInsulinBrand,
          insulinActionDuration: settings.insulinActionDuration,
          targetGlucoseMgdl: settings.targetGlucoseMgdl,
          considerIob: settings.considerIob,
          extendedBolusEnabled: settings.extendedBolusEnabled,
          extendedBolusPercent: settings.extendedBolusPercent,
          extendedBolusDurationMin: settings.extendedBolusDurationMin,
        }),
      })
      if (!res.ok) throw new Error("saveFailed")

      const requests: Promise<Response>[] = []
      if (isfChanged) {
        requests.push(
          fetch("/api/insulin-therapy/sensitivity-factors", {
            method: "PUT",
            credentials: "include",
            headers: API_HEADERS,
            body: JSON.stringify({
              slots: isfSlots.map((s) => ({
                startHour: s.startHour,
                endHour: s.endHour,
                sensitivityFactorGl: s.sensitivityFactorGl,
              })),
            }),
          }),
        )
      }
      if (icrChanged) {
        requests.push(
          fetch("/api/insulin-therapy/carb-ratios", {
            method: "PUT",
            credentials: "include",
            headers: API_HEADERS,
            body: JSON.stringify({
              slots: icrSlots.map((s) => ({
                startHour: s.startHour,
                endHour: s.endHour,
                gramsPerUnit: s.gramsPerUnit,
                ...(s.mealLabel?.trim() ? { mealLabel: s.mealLabel.trim() } : {}),
              })),
            }),
          }),
        )
      }
      const results = await Promise.all(requests)
      if (results.some((r) => !r.ok)) throw new Error("saveFailed")

      originalRef.current = JSON.stringify({ settings, isfSlots, icrSlots })
      originalIsfRef.current = JSON.stringify(isfSlots)
      originalIcrRef.current = JSON.stringify(icrSlots)
      setHasChanges(false)
    } catch {
      setError(t("errorSaving"))
    } finally {
      setIsSaving(false)
    }
  }

  // ── Reset to defaults ──────────────────────────────────────────────────────
  const handleReset = () => {
    setSettings({
      bolusInsulinBrand: "novorapid",
      basalInsulinBrand: "lantus",
      insulinActionDuration: 4,
      targetGlucoseMgdl: 100,
      considerIob: true,
      extendedBolusEnabled: false,
      extendedBolusPercent: 50,
      extendedBolusDurationMin: 60,
    })
    setIsfSlots([])
    setIcrSlots([])
    setShowResetConfirm(false)
    setHasChanges(true)
  }

  // ── Slot dialog helpers ────────────────────────────────────────────────────
  const openAddSlot = (type: "isf" | "icr") => {
    setSlotDialog({ open: true, mode: "add", type, index: null })
    setSlotStartHour(0)
    setSlotEndHour(8)
    setSlotValue("")
    setSlotMealLabel("")
    setSlotError(null)
  }

  const openEditSlot = (type: "isf" | "icr", index: number) => {
    const slot = type === "isf" ? isfSlots[index] : icrSlots[index]
    if (!slot) return
    setSlotDialog({ open: true, mode: "edit", type, index })
    setSlotStartHour(slot.startHour)
    setSlotEndHour(slot.endHour)
    setSlotValue(
      type === "isf"
        ? String((slot as IsfSlot).sensitivityFactorGl)
        : String((slot as IcrSlot).gramsPerUnit)
    )
    setSlotMealLabel(type === "icr" ? ((slot as IcrSlot).mealLabel ?? "") : "")
    setSlotError(null)
  }

  const validateSlotValue = (val: string, type: "isf" | "icr"): boolean => {
    const n = parseFloat(val)
    if (isNaN(n)) return false
    // Bornes = source de vérité clinique (clinical-bounds.ts), pas de copie UI
    // (évite le drift : l'UI rejetait des valeurs cliniquement valides, US-2117 suite).
    if (type === "isf") return n >= CLINICAL_BOUNDS.ISF_GL_MIN && n <= CLINICAL_BOUNDS.ISF_GL_MAX
    return n >= CLINICAL_BOUNDS.ICR_MIN && n <= CLINICAL_BOUNDS.ICR_MAX
  }

  /**
   * US-2657 (grouped-only, ADR #23) — n'écrit QUE l'état local (`isfSlots`/`icrSlots`) : plus de
   * `POST` par-créneau (route retirée serveur). La persistance réelle se fait en UN `PUT` par
   * paramètre au clic « Enregistrer » (`handleSave`, jeu complet). L'`id` existant est préservé
   * en édition (spread `...slot`) même s'il n'est pas renvoyé au serveur (le `PUT` ignore les id
   * entrants — il remplace tout le jeu).
   */
  const handleSaveSlot = () => {
    setSlotError(null)
    // US-2657 (grouped-only) : un créneau peut enjamber minuit (`startHour > endHour`, ex. 22→6, `endHour = 0`
    // = minuit). Seule la durée nulle (`start === end`) est invalide ; la couverture 24 h no-gap/no-overlap est
    // vérifiée globalement à l'enregistrement (`handleSave`), comme le fait le PUT groupé serveur.
    if (slotStartHour === slotEndHour) {
      setSlotError(t("slotHourError"))
      return
    }
    if (!validateSlotValue(slotValue, slotDialog.type)) {
      setSlotError(
        slotDialog.type === "isf" ? t("isfValueError") : t("icrValueError")
      )
      return
    }

    const numVal = parseFloat(slotValue)

    if (slotDialog.type === "isf") {
      if (slotDialog.mode === "add") {
        setIsfSlots((prev) => [...prev, { startHour: slotStartHour, endHour: slotEndHour, sensitivityFactorGl: numVal }])
      } else if (slotDialog.index !== null) {
        setIsfSlots((prev) =>
          prev.map((s, i) =>
            i === slotDialog.index ? { ...s, startHour: slotStartHour, endHour: slotEndHour, sensitivityFactorGl: numVal } : s,
          ),
        )
      }
    } else {
      const mealLabel = slotMealLabel.trim() || undefined
      if (slotDialog.mode === "add") {
        setIcrSlots((prev) => [...prev, { startHour: slotStartHour, endHour: slotEndHour, gramsPerUnit: numVal, mealLabel }])
      } else if (slotDialog.index !== null) {
        setIcrSlots((prev) =>
          prev.map((s, i) =>
            i === slotDialog.index ? { ...s, startHour: slotStartHour, endHour: slotEndHour, gramsPerUnit: numVal, mealLabel } : s,
          ),
        )
      }
    }

    setSlotDialog((prev) => ({ ...prev, open: false }))
  }

  const deleteSlot = (type: "isf" | "icr", index: number) => {
    if (type === "isf") {
      setIsfSlots((prev) => prev.filter((_, i) => i !== index))
    } else {
      setIcrSlots((prev) => prev.filter((_, i) => i !== index))
    }
    // Ensure dirty flag is raised even when no other field was touched
    setHasChanges(true)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <>
        <DashboardHeader title={t("title")} subtitle={t("subtitle")} />
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" aria-label={tCommon("loading")} />
        </div>
      </>
    )
  }

  return (
    <>
      <DashboardHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="space-y-6 p-6">
        {/* Error banner */}
        {error && (
          <AlertBanner
            severity="warning"
            title={error}
            dismissible
            onDismiss={() => setError(null)}
          />
        )}

        {/* Unsaved changes banner */}
        {hasChanges && (
          <AlertBanner
            severity="info"
            title={t("unsavedChanges")}
            description={t("unsavedChangesDescription")}
          />
        )}

        {/* ── Basic Parameters ─────────────────────────────────────────── */}
        <DiabeoCard variant="elevated" padding="lg">
          <DiabeoFormSection
            title={t("basicParameters")}
            description={t("basicParametersDescription")}
          >
            {/* Bolus insulin brand */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bolus-brand">{t("bolusInsulinBrand")}</Label>
              <Select
                value={settings.bolusInsulinBrand}
                onValueChange={(v) => { if (v !== null) updateSettings("bolusInsulinBrand", v) }}
              >
                <SelectTrigger id="bolus-brand" aria-label={t("bolusInsulinBrand")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOLUS_BRANDS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {t(`brand.${b}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Basal insulin brand */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="basal-brand">{t("basalInsulinBrand")}</Label>
              <Select
                value={settings.basalInsulinBrand ?? "lantus"}
                onValueChange={(v) => { if (v !== null) updateSettings("basalInsulinBrand", v) }}
              >
                <SelectTrigger id="basal-brand" aria-label={t("basalInsulinBrand")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BASAL_BRANDS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {t(`brand.${b}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target glucose */}
            <DiabeoTextField
              label={t("targetGlucose")}
              type="number"
              min={60}
              max={250}
              value={settings.targetGlucoseMgdl ?? 100}
              onChange={(e) => {
                // C2: guard against NaN and enforce clinical bounds [60, 250] mg/dL
                const val = e.target.value === "" ? 0 : parseInt(e.target.value, 10)
                if (Number.isNaN(val)) return
                const clamped = Math.min(250, Math.max(60, val))
                updateSettings("targetGlucoseMgdl", clamped)
              }}
              hint={t("targetGlucoseHint")}
            />

            {/* Insulin action duration — en HEURES (contrat API + clinical-bounds
                INSULIN_ACTION_MIN/MAX = 3.5–5.0 h). A2 : l'UI envoyait des minutes
                à une API attendant des heures → toute sauvegarde échouait (400). */}
            <DiabeoTextField
              label={t("insulinActionDuration")}
              type="number"
              min={3.5}
              max={5}
              step={0.5}
              value={settings.insulinActionDuration}
              onChange={(e) => {
                // C2: guard against NaN and enforce bounds [3.5, 5.0] hours.
                const val = e.target.value === "" ? 0 : parseFloat(e.target.value)
                if (Number.isNaN(val)) return
                const clamped = Math.min(5, Math.max(3.5, val))
                updateSettings("insulinActionDuration", clamped)
              }}
              hint={t("insulinActionDurationHint")}
            />
          </DiabeoFormSection>
        </DiabeoCard>

        {/* ── ISF Section ──────────────────────────────────────────────── */}
        <DiabeoCard variant="elevated" padding="lg">
          <DiabeoFormSection
            title={t("isf.title")}
            description={t("isf.description")}
          >
            {/* Timeline */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{t("timeline24h")}</p>
              <HourTimeline
                slots={isfSlots}
                colorClass="bg-teal-500"
                label={t("isf.timelineLabel")}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{t("hourAxisTick", { hour: 0 })}</span>
                <span>{t("hourAxisTick", { hour: 6 })}</span>
                <span>{t("hourAxisTick", { hour: 12 })}</span>
                <span>{t("hourAxisTick", { hour: 18 })}</span>
                <span>{t("hourAxisTick", { hour: 24 })}</span>
              </div>
            </div>

            {/* Slot list */}
            {isfSlots.length === 0 ? (
              <DiabeoEmptyState
                variant="noData"
                title={t("isf.noSlots")}
                message={t("isf.noSlotsMessage")}
                icon={<Clock className="h-10 w-10" aria-hidden="true" />}
              />
            ) : (
              <div className="space-y-2">
                {isfSlots.map((slot, i) => (
                  <SlotRow
                    key={i}
                    label={formatSlotHours(slot.startHour, slot.endHour)}
                    value={slot.sensitivityFactorGl.toFixed(2)}
                    valueUnit="g/L/U"
                    onEdit={() => openEditSlot("isf", i)}
                    onDelete={() => deleteSlot("isf", i)}
                    editLabel={t("editSlot")}
                    deleteLabel={t("deleteSlot")}
                  />
                ))}
              </div>
            )}

            <DiabeoButton
              variant="diabeoTertiary"
              size="sm"
              icon={<Plus />}
              onClick={() => openAddSlot("isf")}
            >
              {t("isf.addSlot")}
            </DiabeoButton>
          </DiabeoFormSection>
        </DiabeoCard>

        {/* ── ICR Section ──────────────────────────────────────────────── */}
        <DiabeoCard variant="elevated" padding="lg">
          <DiabeoFormSection
            title={t("icr.title")}
            description={t("icr.description")}
          >
            {/* Timeline */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{t("timeline24h")}</p>
              <HourTimeline
                slots={icrSlots}
                colorClass="bg-coral-400"
                label={t("icr.timelineLabel")}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{t("hourAxisTick", { hour: 0 })}</span>
                <span>{t("hourAxisTick", { hour: 6 })}</span>
                <span>{t("hourAxisTick", { hour: 12 })}</span>
                <span>{t("hourAxisTick", { hour: 18 })}</span>
                <span>{t("hourAxisTick", { hour: 24 })}</span>
              </div>
            </div>

            {/* Slot list */}
            {icrSlots.length === 0 ? (
              <DiabeoEmptyState
                variant="noData"
                title={t("icr.noSlots")}
                message={t("icr.noSlotsMessage")}
                icon={<Clock className="h-10 w-10" aria-hidden="true" />}
              />
            ) : (
              <div className="space-y-2">
                {icrSlots.map((slot, i) => (
                  <SlotRow
                    key={i}
                    label={`${formatSlotHours(slot.startHour, slot.endHour)}${slot.mealLabel ? ` — ${slot.mealLabel}` : ""}`}
                    value={slot.gramsPerUnit.toFixed(1)}
                    valueUnit="g/U"
                    onEdit={() => openEditSlot("icr", i)}
                    onDelete={() => deleteSlot("icr", i)}
                    editLabel={t("editSlot")}
                    deleteLabel={t("deleteSlot")}
                  />
                ))}
              </div>
            )}

            <DiabeoButton
              variant="diabeoTertiary"
              size="sm"
              icon={<Plus />}
              onClick={() => openAddSlot("icr")}
            >
              {t("icr.addSlot")}
            </DiabeoButton>
          </DiabeoFormSection>
        </DiabeoCard>

        {/* ── Advanced Settings ─────────────────────────────────────────── */}
        <DiabeoCard variant="elevated" padding="lg">
          <DiabeoFormSection
            title={t("advanced.title")}
            description={t("advanced.description")}
          >
            {/* Consider IOB */}
            <DiabeoToggle
              label={t("advanced.considerIob")}
              subtitle={t("advanced.considerIobSubtitle")}
              checked={settings.considerIob}
              onCheckedChange={(v) => updateSettings("considerIob", v)}
            />

            {/* Extended bolus */}
            <DiabeoToggle
              label={t("advanced.extendedBolus")}
              subtitle={t("advanced.extendedBolusSubtitle")}
              checked={settings.extendedBolusEnabled}
              onCheckedChange={(v) => updateSettings("extendedBolusEnabled", v)}
            />

            {settings.extendedBolusEnabled && (
              <div className="ms-4 space-y-4 border-s-2 border-teal-200 ps-4">
                {/* Extended bolus percent */}
                <div className="flex flex-col gap-2">
                  <Label>
                    {t("advanced.extendedBolusPercent")}
                    <span className="ms-2 font-semibold text-teal-700">
                      {settings.extendedBolusPercent}%
                    </span>
                  </Label>
                  <Slider
                    min={10}
                    max={90}
                    step={5}
                    value={[settings.extendedBolusPercent]}
                    onValueChange={(vals: number | readonly number[]) => {
                      const v = Array.isArray(vals) ? (vals as readonly number[])[0] : (vals as number)
                      updateSettings("extendedBolusPercent", v ?? settings.extendedBolusPercent)
                    }}
                    aria-label={t("advanced.extendedBolusPercent")}
                    aria-valuemin={10}
                    aria-valuemax={90}
                    aria-valuenow={settings.extendedBolusPercent}
                    aria-valuetext={`${settings.extendedBolusPercent}%`}
                    className="w-full"
                  />
                </div>

                {/* Extended bolus duration */}
                <DiabeoTextField
                  label={t("advanced.extendedBolusDuration")}
                  type="number"
                  min={15}
                  max={480}
                  value={settings.extendedBolusDurationMin}
                  onChange={(e) => {
                    // Guard against NaN and enforce clinical bounds [15, 480] minutes
                    const val = e.target.value === "" ? 0 : parseInt(e.target.value, 10)
                    if (Number.isNaN(val)) return
                    const clamped = Math.max(15, Math.min(480, val))
                    updateSettings("extendedBolusDurationMin", clamped)
                  }}
                  hint={t("advanced.extendedBolusDurationHint")}
                />
              </div>
            )}
          </DiabeoFormSection>
        </DiabeoCard>

        {/* ── Action bar ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <DiabeoButton
            variant="diabeoDestructive"
            icon={<AlertTriangle />}
            onClick={() => setShowResetConfirm(true)}
          >
            {t("resetToDefaults")}
          </DiabeoButton>

          <DiabeoButton
            variant="diabeoPrimary"
            disabled={!hasChanges}
            loading={isSaving}
            onClick={() => void handleSave()}
          >
            {tCommon("save")}
          </DiabeoButton>
        </div>
      </div>

      {/* ── Slot add/edit dialog ──────────────────────────────────────────── */}
      <Dialog
        open={slotDialog.open}
        onOpenChange={(open) =>
          setSlotDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {slotDialog.mode === "add"
                ? slotDialog.type === "isf"
                  ? t("isf.addSlot")
                  : t("icr.addSlot")
                : t("editSlot")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {slotError && (
              <AlertBanner severity="warning" title={slotError} />
            )}

            {/* Hour range */}
            <div className="grid grid-cols-2 gap-3">
              <DiabeoTextField
                label={t("slotStartHour")}
                type="number"
                min={0}
                max={23}
                value={slotStartHour}
                onChange={(e) => setSlotStartHour(parseInt(e.target.value, 10))}
              />
              <DiabeoTextField
                label={t("slotEndHour")}
                type="number"
                min={0}
                max={23}
                value={slotEndHour}
                onChange={(e) => setSlotEndHour(parseInt(e.target.value, 10))}
                hint={t("slotMidnightHint")}
              />
            </div>

            {/* Value */}
            <DiabeoTextField
              label={
                slotDialog.type === "isf"
                  ? t("isf.valueLabel")
                  : t("icr.valueLabel")
              }
              type="number"
              // ISF affiché à 2 décimales (0,01) ; ICR à 1 décimale (0,1).
              step={slotDialog.type === "isf" ? "0.01" : "0.1"}
              value={slotValue}
              onChange={(e) => setSlotValue(e.target.value)}
              hint={
                slotDialog.type === "isf"
                  ? t("isf.valueHint")
                  : t("icr.valueHint")
              }
            />

            {/* Meal label (ICR only) */}
            {slotDialog.type === "icr" && (
              <DiabeoTextField
                label={t("icr.mealLabel")}
                value={slotMealLabel}
                onChange={(e) => setSlotMealLabel(e.target.value)}
                hint={t("icr.mealLabelHint")}
              />
            )}
          </div>

          <DialogFooter>
            <DiabeoButton
              variant="diabeoTertiary"
              onClick={() => setSlotDialog((prev) => ({ ...prev, open: false }))}
            >
              {tCommon("cancel")}
            </DiabeoButton>
            <DiabeoButton
              variant="diabeoPrimary"
              onClick={handleSaveSlot}
            >
              {tCommon("confirm")}
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset confirm dialog ──────────────────────────────────────────── */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("resetConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("resetConfirmDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DiabeoButton
              variant="diabeoTertiary"
              onClick={() => setShowResetConfirm(false)}
            >
              {tCommon("cancel")}
            </DiabeoButton>
            <DiabeoButton
              variant="diabeoDestructive"
              onClick={handleReset}
            >
              {t("resetConfirm")}
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
