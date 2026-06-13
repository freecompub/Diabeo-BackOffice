"use client"

/**
 * CabinetDetailClient — UI ADMIN detail cabinet (US-2117/2118 settings +
 * US-2506 SMS config V1 mock).
 *
 * Fixes round 1 review PR #459 (~22 findings — Option C totale) :
 *   - H1 : `extractApiError` mapping codes erreur + détails per-field
 *   - H2 : types extraits `src/lib/types/cabinet-admin.ts`
 *   - H3 : reset state `setSettings(null) + setSms(null)` au début fetchAll
 *   - H4 : color contrast warning crédit + aria-label emoji
 *   - C1+H2 : aria-invalid + aria-describedby form inputs
 *   - M1 : truncate spécialités 60 chars côté UI (cohérent Zod backend)
 *   - M2 : `setDraft(prev => ...)` stale-safe vs spread direct
 *   - M3 : success banner role="status" auto-dismiss 3s
 *   - M4 : char count display TextInput
 *   - M7 : Dialog close button aria-label i18n FR
 *   - M8 : PUT diff body (changes only vs full draft)
 *   - L4 : `SMS_CREDITS_MAX` const partagée
 *   - L5 : confirmation Dialog Settings save (cohérence avec SMS)
 *   - A11y L1 : emoji ⚠ wrap span aria-label
 *   - A11y L2 : `<nav aria-label="Breadcrumb">` retour liste
 */

import { useCallback, useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Save,
} from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  type CabinetSettingsDTOClient as CabinetSettingsDTO,
  type SmsConfigDTOClient as SmsConfigDTO,
  SMS_CREDITS_MAX,
  CABINET_FIELD_LIMITS,
} from "@/lib/types/cabinet-admin"
import { extractApiError, type ParsedApiError } from "@/lib/ui/api-error"

type AsyncState = "idle" | "loading" | "saving" | "success" | "error"

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export function CabinetDetailClient({ cabinetId }: { cabinetId: number }) {
  const t = useTranslations("cabinetDetail")
  const [settings, setSettings] = useState<CabinetSettingsDTO | null>(null)
  const [sms, setSms] = useState<SmsConfigDTO | null>(null)
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  const fetchAll = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    // Fix H3 round 1 review PR #459 — reset state pour éviter données stales
    // si seconde route échoue partiellement au refresh.
    setSettings(null)
    setSms(null)
    setState("loading")
    setErrorMessage(null)
    try {
      const [settingsRes, smsRes] = await Promise.all([
        fetch(`/api/cabinet/${cabinetId}/settings`, {
          credentials: "include",
          signal: controller.signal,
        }),
        fetch(`/api/cabinet/${cabinetId}/sms-config`, {
          credentials: "include",
          signal: controller.signal,
        }),
      ])
      if (!mountedRef.current) return
      if (!settingsRes.ok || !smsRes.ok) {
        setState("error")
        // Fix H1 round 1 — extract error code friendly (vs HTTP générique).
        const failedRes = !settingsRes.ok ? settingsRes : smsRes
        const parsed = await extractApiError(failedRes)
        setErrorMessage(parsed.message)
        return
      }
      const settingsData = (await settingsRes.json()) as { settings?: CabinetSettingsDTO }
      const smsData = (await smsRes.json()) as SmsConfigDTO
      if (!mountedRef.current) return
      if (settingsData.settings) setSettings(settingsData.settings)
      setSms(smsData)
      setState("success")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (!mountedRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [cabinetId])

  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll()
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchAll])

  if (state === "loading" && !settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="size-4 animate-spin motion-safe:animate-spin" aria-hidden="true" />
        {t("loading")}
      </div>
    )
  }

  if (state === "error" || !settings || !sms) {
    return (
      <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3">
        <p className="font-medium text-destructive flex items-center gap-2">
          <AlertCircle className="size-4" aria-hidden="true" />
          {t("loadError")}
        </p>
        {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
        <Link
          href="/admin/cabinets"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("backToList")}
        </Link>
      </div>
    )
  }

  return (
    <>
      {/* Fix A11y L2 round 1 — wrap dans <nav> breadcrumb landmark. */}
      <nav aria-label={t("breadcrumbNav")}>
        <Link
          href="/admin/cabinets"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("backToList")}
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Building2 className="size-6" aria-hidden="true" />
          {settings.name}
        </h1>
        {settings.establishment && (
          <p className="text-sm text-muted-foreground">{settings.establishment}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <Badge variant="outline">{settings.type}</Badge>
          {settings.siret && <Badge variant="secondary">{t("siretBadge", { siret: settings.siret })}</Badge>}
          {settings.managerId === null && (
            <Badge variant="destructive">{t("noManager")}</Badge>
          )}
        </div>
      </header>

      <SettingsSection
        cabinetId={cabinetId}
        initial={settings}
        onSaved={() => void fetchAll()}
      />

      <SmsConfigSection
        cabinetId={cabinetId}
        initial={sms}
        onSaved={() => void fetchAll()}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// SettingsSection — manager-level fields editable
// ---------------------------------------------------------------------------

function SettingsSection({
  cabinetId,
  initial,
  onSaved,
}: {
  cabinetId: number
  initial: CabinetSettingsDTO
  onSaved: () => void
}) {
  const t = useTranslations("cabinetDetail")
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<CabinetSettingsDTO>>({})
  const [saveState, setSaveState] = useState<AsyncState>("idle")
  const [saveError, setSaveError] = useState<ParsedApiError | null>(null)
  // Fix L5 round 1 — confirmation Dialog (cohérence avec SmsConfigSection).
  const [showConfirm, setShowConfirm] = useState(false)
  const mountedRef = useRef(true)
  // Fix M3 round 1 — success banner auto-dismiss timer tracked.
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
    }
  }, [])

  const startEdit = () => {
    setDraft({
      phone: initial.phone,
      email: initial.email,
      website: initial.website,
      addressLine1: initial.addressLine1,
      addressLine2: initial.addressLine2,
      postalCode: initial.postalCode,
      city: initial.city,
      capacity: initial.capacity,
      noVideos: initial.noVideos,
      noFood: initial.noFood,
      specialties: initial.specialties,
    })
    setSaveError(null)
    setEditing(true)
  }

  /**
   * Fix M8 round 1 — compute diff body (vs full draft) pour PATCH semantics.
   * Backend audit log enregistre uniquement les changements effectifs.
   * Comparaison shallow par field — `specialties` array compared via JSON.
   */
  const computeChanges = useCallback((): Partial<CabinetSettingsDTO> => {
    const changes: Partial<CabinetSettingsDTO> = {}
    const compareKey = <K extends keyof CabinetSettingsDTO>(key: K): void => {
      if (draft[key] === undefined) return
      const draftVal = draft[key]
      const initialVal = initial[key]
      // Compare arrays via JSON.stringify (specialties).
      const same = Array.isArray(draftVal) && Array.isArray(initialVal)
        ? JSON.stringify(draftVal) === JSON.stringify(initialVal)
        : draftVal === initialVal
      if (!same) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(changes as any)[key] = draftVal
      }
    }
    compareKey("phone")
    compareKey("email")
    compareKey("website")
    compareKey("addressLine1")
    compareKey("addressLine2")
    compareKey("postalCode")
    compareKey("city")
    compareKey("capacity")
    compareKey("noVideos")
    compareKey("noFood")
    compareKey("specialties")
    return changes
  }, [draft, initial])

  const hasChanges = Object.keys(computeChanges()).length > 0

  const executeSave = useCallback(async () => {
    setShowConfirm(false)
    setSaveState("saving")
    setSaveError(null)
    try {
      // Fix M8 round 1 — send only changed fields.
      const body = computeChanges()
      const res = await fetch(`/api/cabinet/${cabinetId}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(body),
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        setSaveState("error")
        // Fix H1 round 1 — error code mapping friendly + field-level details.
        const parsed = await extractApiError(res)
        setSaveError(parsed)
        return
      }
      setSaveState("success")
      setEditing(false)
      onSaved()
      // Fix M3 round 1 — success banner auto-dismiss after 3s.
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setSaveState("idle")
      }, 3000)
    } catch (err) {
      if (!mountedRef.current) return
      setSaveState("error")
      setSaveError({
        message: err instanceof Error ? err.message : "Erreur réseau",
      })
    }
  }, [cabinetId, computeChanges, onSaved])

  return (
    <section className="rounded-md border p-4 space-y-3" aria-labelledby="settings-section">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 id="settings-section" className="text-lg font-semibold">
          {t("settingsTitle")}
        </h2>
        {!editing && (
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={startEdit}>
            {t("edit")}
          </DiabeoButton>
        )}
      </div>

      {!editing ? (
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Field label={t("fieldPhone")}>{initial.phone ?? "—"}</Field>
          <Field label={t("fieldEmail")}>{initial.email ?? "—"}</Field>
          <Field label={t("fieldWebsite")}>{initial.website ?? "—"}</Field>
          <Field label={t("fieldCapacity")}>{initial.capacity ?? "—"}</Field>
          <Field label={t("fieldAddressLine1")}>{initial.addressLine1 ?? "—"}</Field>
          <Field label={t("fieldAddressLine2")}>{initial.addressLine2 ?? "—"}</Field>
          <Field label={t("fieldPostalCode")}>{initial.postalCode ?? "—"}</Field>
          <Field label={t("fieldCity")}>{initial.city ?? "—"}</Field>
          <Field label={t("fieldCountry")}>{initial.country ?? "—"}</Field>
          <Field label={t("fieldSpecialties")}>
            {initial.specialties.length > 0 ? initial.specialties.join(", ") : "—"}
          </Field>
          <Field label={t("fieldNoVideos")}>{initial.noVideos ? t("yes") : t("no")}</Field>
          <Field label={t("fieldNoFood")}>{initial.noFood ? t("yes") : t("no")}</Field>
        </dl>
      ) : (
        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          {/* Fix M2 round 1 — `setDraft(prev => ...)` stale-safe (vs spread direct).
              Fix C1+H2 round 1 — `errorField` propagé pour aria-invalid (H1 details). */}
          <TextInput
            label={t("fieldPhone")}
            field="phone"
            value={draft.phone ?? ""}
            onChange={(v) => setDraft((prev) => ({ ...prev, phone: v || null }))}
            maxLength={CABINET_FIELD_LIMITS.PHONE_MAX}
            errorDetails={saveError?.details}
          />
          <TextInput
            label={t("fieldEmail")}
            field="email"
            type="email"
            value={draft.email ?? ""}
            onChange={(v) => setDraft((prev) => ({ ...prev, email: v || null }))}
            maxLength={CABINET_FIELD_LIMITS.EMAIL_MAX}
            errorDetails={saveError?.details}
          />
          <TextInput
            label={t("fieldWebsite")}
            field="website"
            value={draft.website ?? ""}
            onChange={(v) => setDraft((prev) => ({ ...prev, website: v || null }))}
            maxLength={CABINET_FIELD_LIMITS.WEBSITE_MAX}
            errorDetails={saveError?.details}
          />
          <NumberInput
            label={t("fieldCapacity")}
            field="capacity"
            value={draft.capacity ?? null}
            onChange={(v) => setDraft((prev) => ({ ...prev, capacity: v }))}
            min={0}
            max={CABINET_FIELD_LIMITS.CAPACITY_MAX}
            errorDetails={saveError?.details}
          />
          <TextInput
            label={t("fieldAddressLine1")}
            field="addressLine1"
            value={draft.addressLine1 ?? ""}
            onChange={(v) => setDraft((prev) => ({ ...prev, addressLine1: v || null }))}
            maxLength={CABINET_FIELD_LIMITS.ADDRESS_MAX}
            errorDetails={saveError?.details}
            wide
          />
          <TextInput
            label={t("fieldAddressLine2")}
            field="addressLine2"
            value={draft.addressLine2 ?? ""}
            onChange={(v) => setDraft((prev) => ({ ...prev, addressLine2: v || null }))}
            maxLength={CABINET_FIELD_LIMITS.ADDRESS_MAX}
            errorDetails={saveError?.details}
            wide
          />
          <TextInput
            label={t("fieldPostalCode")}
            field="postalCode"
            value={draft.postalCode ?? ""}
            onChange={(v) => setDraft((prev) => ({ ...prev, postalCode: v || null }))}
            maxLength={CABINET_FIELD_LIMITS.POSTAL_CODE_MAX}
            errorDetails={saveError?.details}
          />
          <TextInput
            label={t("fieldCity")}
            field="city"
            value={draft.city ?? ""}
            onChange={(v) => setDraft((prev) => ({ ...prev, city: v || null }))}
            maxLength={CABINET_FIELD_LIMITS.CITY_MAX}
            errorDetails={saveError?.details}
          />
          <TextInput
            label={t("fieldSpecialtiesInput")}
            field="specialties"
            value={(draft.specialties ?? []).join(", ")}
            onChange={(v) =>
              // Fix M1 round 1 — truncate per-spécialité 60 chars (cohérent Zod backend).
              setDraft((prev) => ({
                ...prev,
                specialties: v
                  .split(",")
                  .map((s) => s.trim().slice(0, CABINET_FIELD_LIMITS.SPECIALTY_LEN_MAX))
                  .filter(Boolean)
                  .slice(0, CABINET_FIELD_LIMITS.SPECIALTIES_COUNT_MAX),
              }))
            }
            maxLength={500}
            errorDetails={saveError?.details}
            wide
            helpText={t("specialtiesHelpText", {
              maxCount: CABINET_FIELD_LIMITS.SPECIALTIES_COUNT_MAX,
              maxLen: CABINET_FIELD_LIMITS.SPECIALTY_LEN_MAX,
            })}
          />
          <BoolInput
            label={t("fieldNoVideos")}
            value={draft.noVideos ?? false}
            onChange={(v) => setDraft((prev) => ({ ...prev, noVideos: v }))}
          />
          <BoolInput
            label={t("fieldNoFood")}
            value={draft.noFood ?? false}
            onChange={(v) => setDraft((prev) => ({ ...prev, noFood: v }))}
          />

          {saveState === "error" && saveError && (
            <p role="alert" className="md:col-span-2 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="size-4" aria-hidden="true" />
              {saveError.message}
            </p>
          )}

          <div className="md:col-span-2 flex justify-end gap-2 pt-2 border-t">
            <DiabeoButton variant="diabeoTertiary" onClick={() => setEditing(false)}>
              {t("cancel")}
            </DiabeoButton>
            <DiabeoButton
              onClick={() => setShowConfirm(true)}
              disabled={saveState === "saving" || !hasChanges}
            >
              <Save className="size-4 mr-1" aria-hidden="true" />
              {saveState === "saving" ? t("saving") : t("save")}
            </DiabeoButton>
          </div>
        </div>
      )}

      {/* Fix M3 round 1 — success banner auto-dismiss 3s. */}
      {!editing && saveState === "success" && (
        <div role="status" aria-live="polite" className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
          <p className="flex items-center gap-2 text-primary">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {t("settingsSaveSuccess")}
          </p>
        </div>
      )}

      {/* Fix L5 round 1 — confirmation Dialog Settings save (cohérence SMS). */}
      <Dialog open={showConfirm} onOpenChange={(open) => { if (!open) setShowConfirm(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settingsConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("settingsConfirmDesc", { count: Object.keys(computeChanges()).length })}
              {" "}
              {t("auditTraceNote")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DiabeoButton variant="diabeoTertiary" onClick={() => setShowConfirm(false)}>
              {t("cancel")}
            </DiabeoButton>
            <DiabeoButton onClick={() => void executeSave()}>
              <CheckCircle2 className="size-4 mr-1" aria-hidden="true" />
              {t("confirm")}
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ---------------------------------------------------------------------------
// SmsConfigSection — toggle + crédits
// ---------------------------------------------------------------------------

function SmsConfigSection({
  cabinetId,
  initial,
  onSaved,
}: {
  cabinetId: number
  initial: SmsConfigDTO
  onSaved: () => void
}) {
  const t = useTranslations("cabinetDetail")
  const [editing, setEditing] = useState(false)
  const [draftEnabled, setDraftEnabled] = useState(initial.smsEnabled)
  const [draftCredits, setDraftCredits] = useState(initial.smsCreditBalance)
  const [saveState, setSaveState] = useState<AsyncState>("idle")
  // Fix H1 round 1 — ParsedApiError pour mapping codes + détails (vs string).
  const [saveError, setSaveError] = useState<ParsedApiError | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const mountedRef = useRef(true)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
    }
  }, [])

  const startEdit = () => {
    setDraftEnabled(initial.smsEnabled)
    setDraftCredits(initial.smsCreditBalance)
    setSaveError(null)
    setEditing(true)
  }

  const hasChanges = draftEnabled !== initial.smsEnabled || draftCredits !== initial.smsCreditBalance

  const executeSave = useCallback(async () => {
    setShowConfirm(false)
    setSaveState("saving")
    setSaveError(null)
    try {
      const body: { smsEnabled?: boolean; smsCreditBalance?: number } = {}
      if (draftEnabled !== initial.smsEnabled) body.smsEnabled = draftEnabled
      if (draftCredits !== initial.smsCreditBalance) body.smsCreditBalance = draftCredits
      const res = await fetch(`/api/cabinet/${cabinetId}/sms-config`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(body),
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        setSaveState("error")
        // Fix H1 round 1 — error code mapping friendly.
        const parsed = await extractApiError(res)
        setSaveError(parsed)
        return
      }
      setSaveState("success")
      setEditing(false)
      onSaved()
      // Fix M3 round 1 — success banner auto-dismiss 3s.
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setSaveState("idle")
      }, 3000)
    } catch (err) {
      if (!mountedRef.current) return
      setSaveState("error")
      setSaveError({
        message: err instanceof Error ? err.message : "Erreur réseau",
      })
    }
  }, [cabinetId, draftEnabled, draftCredits, initial.smsEnabled, initial.smsCreditBalance, onSaved])

  return (
    <section className="rounded-md border p-4 space-y-3" aria-labelledby="sms-section">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 id="sms-section" className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="size-5" aria-hidden="true" />
          {t("smsTitle")}
          <Badge variant="outline" className="text-[10px]">{t("smsMockBadge")}</Badge>
        </h2>
        {!editing && (
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={startEdit}>
            {t("edit")}
          </DiabeoButton>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {t("smsMockDesc")}
      </p>

      {!editing ? (
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Field label={t("fieldSmsEnabled")}>
            <Badge variant={initial.smsEnabled ? "default" : "secondary"}>
              {initial.smsEnabled ? t("smsOn") : t("smsOff")}
            </Badge>
          </Field>
          <Field label={t("fieldSmsCredits")}>
            {/* Fix H4 + A11y L1 round 1 — text-orange-800 augmente contraste ≥4.5:1.
                Wrap emoji ⚠ + label sr-only pour SR ("Alerte : crédit faible"). */}
            <span className={initial.smsCreditBalance < 10 && initial.smsEnabled ? "text-orange-800 font-medium" : ""}>
              {initial.smsCreditBalance}
              {initial.smsCreditBalance < 10 && initial.smsEnabled && (
                <span className="ml-1" aria-label={t("smsCreditLowAlert")}>
                  <span aria-hidden="true">{t("smsCreditLowLabel")}</span>
                </span>
              )}
            </span>
          </Field>
        </dl>
      ) : (
        <div className="space-y-3">
          <BoolInput
            label={t("fieldSmsActivate")}
            value={draftEnabled}
            onChange={setDraftEnabled}
          />
          <NumberInput
            label={t("fieldSmsCreditsInput")}
            field="smsCreditBalance"
            value={draftCredits}
            onChange={(v) => setDraftCredits(v ?? 0)}
            min={0}
            max={SMS_CREDITS_MAX}
            errorDetails={saveError?.details}
          />

          {saveState === "error" && saveError && (
            <p role="alert" className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="size-4" aria-hidden="true" />
              {saveError.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <DiabeoButton variant="diabeoTertiary" onClick={() => setEditing(false)}>
              {t("cancel")}
            </DiabeoButton>
            <DiabeoButton
              onClick={() => setShowConfirm(true)}
              disabled={!hasChanges || saveState === "saving"}
            >
              <Save className="size-4 mr-1" aria-hidden="true" />
              {saveState === "saving" ? t("saving") : t("save")}
            </DiabeoButton>
          </div>
        </div>
      )}

      {/* Confirmation Dialog shadcn (focus trap + ESC + restore). */}
      <Dialog open={showConfirm} onOpenChange={(open) => { if (!open) setShowConfirm(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("smsConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {draftEnabled !== initial.smsEnabled && (
                <span className="block">
                  {t.rich("smsConfirmEnabledChange", {
                    from: initial.smsEnabled ? t("smsOn") : t("smsOff"),
                    to: draftEnabled ? t("smsOn") : t("smsOff"),
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })}
                </span>
              )}
              {draftCredits !== initial.smsCreditBalance && (
                <span className="block">
                  {t.rich("smsConfirmCreditsChange", {
                    from: initial.smsCreditBalance,
                    to: draftCredits,
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })}
                </span>
              )}
              <span className="block mt-2 text-xs">
                {t("auditTraceNote")}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DiabeoButton variant="diabeoTertiary" onClick={() => setShowConfirm(false)}>
              {t("cancel")}
            </DiabeoButton>
            <DiabeoButton onClick={() => void executeSave()}>
              <CheckCircle2 className="size-4 mr-1" aria-hidden="true" />
              {t("confirm")}
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fix M3 round 1 — success banner SMS auto-dismiss 3s. */}
      {!editing && saveState === "success" && (
        <div role="status" aria-live="polite" className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
          <p className="flex items-center gap-2 text-primary">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {t("smsSaveSuccess")}
          </p>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Helpers UI
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

/**
 * Fix C1+H2+M4 round 1 review PR #459 — TextInput enrichi avec :
 *   - `field` + `errorDetails` → `aria-invalid` + `aria-describedby` (validation feedback)
 *   - `maxLength` + char count visible (`<small aria-live="polite">{N}/{MAX}</small>`)
 *   - `helpText` optionnel pour instructions inline (WCAG 3.3.2)
 */
function TextInput({
  label,
  field,
  type = "text",
  value,
  onChange,
  maxLength,
  wide = false,
  errorDetails,
  helpText,
}: {
  label: string
  field?: string
  type?: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  wide?: boolean
  errorDetails?: Record<string, string[] | undefined>
  helpText?: string
}) {
  const inputId = useId()
  const helpId = useId()
  const errorId = useId()
  const fieldErrors = field && errorDetails ? errorDetails[field] : undefined
  const hasError = Boolean(fieldErrors && fieldErrors.length > 0)
  const showCharCount = typeof maxLength === "number" && maxLength <= 500
  const describedBy = [
    helpText ? helpId : null,
    hasError ? errorId : null,
    showCharCount ? `${inputId}-count` : null,
  ].filter(Boolean).join(" ") || undefined

  return (
    <label htmlFor={inputId} className={`flex flex-col gap-1 text-sm ${wide ? "md:col-span-2" : ""}`}>
      <span>{label}</span>
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        className={`rounded-md border bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
          hasError ? "border-destructive" : ""
        }`}
      />
      {helpText && (
        <span id={helpId} className="text-xs text-muted-foreground">{helpText}</span>
      )}
      {showCharCount && (
        <small id={`${inputId}-count`} aria-live="polite" className="text-xs text-muted-foreground self-end">
          {value.length} / {maxLength}
        </small>
      )}
      {hasError && fieldErrors && (
        <span id={errorId} role="alert" className="text-xs text-destructive">
          {fieldErrors.join(", ")}
        </span>
      )}
    </label>
  )
}

function NumberInput({
  label,
  field,
  value,
  onChange,
  min,
  max,
  errorDetails,
}: {
  label: string
  field?: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  errorDetails?: Record<string, string[] | undefined>
}) {
  const inputId = useId()
  const errorId = useId()
  const fieldErrors = field && errorDetails ? errorDetails[field] : undefined
  const hasError = Boolean(fieldErrors && fieldErrors.length > 0)
  return (
    <label htmlFor={inputId} className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <input
        id={inputId}
        type="number"
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value
          if (v === "") {
            onChange(null)
          } else {
            const n = Number.parseInt(v, 10)
            if (Number.isFinite(n)) onChange(n)
          }
        }}
        min={min}
        max={max}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
        className={`rounded-md border bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
          hasError ? "border-destructive" : ""
        }`}
      />
      {hasError && fieldErrors && (
        <span id={errorId} role="alert" className="text-xs text-destructive">
          {fieldErrors.join(", ")}
        </span>
      )}
    </label>
  )
}

function BoolInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border"
      />
      <span>{label}</span>
    </label>
  )
}
