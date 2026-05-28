"use client"

/**
 * CabinetDetailClient — UI ADMIN detail cabinet (US-2117/2118 settings +
 * US-2506 SMS config V1 mock).
 *
 * 2 sections :
 *   - "Paramètres cabinet" — fetch GET `/api/cabinet/[id]/settings` +
 *     PUT pour update (manager-level fields : contact, adresse, capacity,
 *     spécialités, flags noVideos/noFood). Champs régaliens (siret, type)
 *     en read-only.
 *   - "Configuration SMS V1 mock" — GET/PUT `/api/cabinet/[id]/sms-config`
 *     (smsEnabled toggle + smsCreditBalance integer). Provider="mock" V1
 *     (US-2506bis V3 = Twilio/OVH réel).
 *
 * Pattern aligné iter 1+2 PR #457/#458 round 1 fixes :
 *   - AbortController + mountedRef + cleanup
 *   - Dialog shadcn pour confirmations
 *   - i18n via useLocale + formatDate
 *   - DiabeoButton variants
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
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

// ---------------------------------------------------------------------------
// Types DTO (cohérent backend cabinet-settings.service + sms.service)
// ---------------------------------------------------------------------------

interface CabinetSettingsDTO {
  id: number
  name: string
  establishment: string | null
  phone: string | null
  email: string | null
  website: string | null
  addressLine1: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  country: string | null
  openingHours: unknown
  specialties: string[]
  capacity: number | null
  noVideos: boolean
  noFood: boolean
  managerId: number | null
  siret: string | null
  tvaIntra: string | null
  type: string
}

interface SmsConfigDTO {
  smsEnabled: boolean
  smsCreditBalance: number
}

type AsyncState = "idle" | "loading" | "saving" | "success" | "error"

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export function CabinetDetailClient({ cabinetId }: { cabinetId: number }) {
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
        setErrorMessage(
          settingsRes.status === 404
            ? "Cabinet introuvable"
            : `HTTP ${!settingsRes.ok ? settingsRes.status : smsRes.status}`,
        )
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
        Chargement…
      </div>
    )
  }

  if (state === "error" || !settings || !sms) {
    return (
      <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3">
        <p className="font-medium text-destructive flex items-center gap-2">
          <AlertCircle className="size-4" aria-hidden="true" />
          Erreur de chargement
        </p>
        {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
        <Link
          href="/admin/cabinets"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Retour à la liste
        </Link>
      </div>
    )
  }

  return (
    <>
      <Link
        href="/admin/cabinets"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Retour à la liste
      </Link>

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
          {settings.siret && <Badge variant="secondary">SIRET {settings.siret}</Badge>}
          {settings.managerId === null && (
            <Badge variant="destructive">Pas de manager</Badge>
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<CabinetSettingsDTO>>({})
  const [saveState, setSaveState] = useState<AsyncState>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
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

  const handleSave = useCallback(async () => {
    setSaveState("saving")
    setSaveError(null)
    try {
      const res = await fetch(`/api/cabinet/${cabinetId}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(draft),
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        setSaveState("error")
        setSaveError(`HTTP ${res.status}`)
        return
      }
      setSaveState("success")
      setEditing(false)
      onSaved()
    } catch (err) {
      if (!mountedRef.current) return
      setSaveState("error")
      setSaveError(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [cabinetId, draft, onSaved])

  return (
    <section className="rounded-md border p-4 space-y-3" aria-labelledby="settings-section">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 id="settings-section" className="text-lg font-semibold">
          Paramètres cabinet
        </h2>
        {!editing && (
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={startEdit}>
            Modifier
          </DiabeoButton>
        )}
      </div>

      {!editing ? (
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Field label="Téléphone">{initial.phone ?? "—"}</Field>
          <Field label="Email">{initial.email ?? "—"}</Field>
          <Field label="Site web">{initial.website ?? "—"}</Field>
          <Field label="Capacité">{initial.capacity ?? "—"}</Field>
          <Field label="Adresse ligne 1">{initial.addressLine1 ?? "—"}</Field>
          <Field label="Adresse ligne 2">{initial.addressLine2 ?? "—"}</Field>
          <Field label="Code postal">{initial.postalCode ?? "—"}</Field>
          <Field label="Ville">{initial.city ?? "—"}</Field>
          <Field label="Pays">{initial.country ?? "—"}</Field>
          <Field label="Spécialités">
            {initial.specialties.length > 0 ? initial.specialties.join(", ") : "—"}
          </Field>
          <Field label="Pas de vidéo">{initial.noVideos ? "Oui" : "Non"}</Field>
          <Field label="Pas de repas">{initial.noFood ? "Oui" : "Non"}</Field>
        </dl>
      ) : (
        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <TextInput
            label="Téléphone"
            value={draft.phone ?? ""}
            onChange={(v) => setDraft({ ...draft, phone: v || null })}
            maxLength={30}
          />
          <TextInput
            label="Email"
            type="email"
            value={draft.email ?? ""}
            onChange={(v) => setDraft({ ...draft, email: v || null })}
            maxLength={255}
          />
          <TextInput
            label="Site web"
            value={draft.website ?? ""}
            onChange={(v) => setDraft({ ...draft, website: v || null })}
            maxLength={500}
          />
          <NumberInput
            label="Capacité"
            value={draft.capacity ?? null}
            onChange={(v) => setDraft({ ...draft, capacity: v })}
            min={0}
            max={10_000}
          />
          <TextInput
            label="Adresse ligne 1"
            value={draft.addressLine1 ?? ""}
            onChange={(v) => setDraft({ ...draft, addressLine1: v || null })}
            maxLength={255}
            wide
          />
          <TextInput
            label="Adresse ligne 2"
            value={draft.addressLine2 ?? ""}
            onChange={(v) => setDraft({ ...draft, addressLine2: v || null })}
            maxLength={255}
            wide
          />
          <TextInput
            label="Code postal"
            value={draft.postalCode ?? ""}
            onChange={(v) => setDraft({ ...draft, postalCode: v || null })}
            maxLength={10}
          />
          <TextInput
            label="Ville"
            value={draft.city ?? ""}
            onChange={(v) => setDraft({ ...draft, city: v || null })}
            maxLength={100}
          />
          <TextInput
            label="Spécialités (séparées par virgule)"
            value={(draft.specialties ?? []).join(", ")}
            onChange={(v) =>
              setDraft({
                ...draft,
                specialties: v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20),
              })
            }
            maxLength={500}
            wide
          />
          <BoolInput
            label="Pas de vidéo"
            value={draft.noVideos ?? false}
            onChange={(v) => setDraft({ ...draft, noVideos: v })}
          />
          <BoolInput
            label="Pas de repas"
            value={draft.noFood ?? false}
            onChange={(v) => setDraft({ ...draft, noFood: v })}
          />

          {saveState === "error" && saveError && (
            <p role="alert" className="md:col-span-2 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="size-4" aria-hidden="true" />
              Erreur : {saveError}
            </p>
          )}

          <div className="md:col-span-2 flex justify-end gap-2 pt-2 border-t">
            <DiabeoButton variant="diabeoTertiary" onClick={() => setEditing(false)}>
              Annuler
            </DiabeoButton>
            <DiabeoButton onClick={() => void handleSave()} disabled={saveState === "saving"}>
              <Save className="size-4 mr-1" aria-hidden="true" />
              {saveState === "saving" ? "Enregistrement…" : "Enregistrer"}
            </DiabeoButton>
          </div>
        </div>
      )}
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
  const [editing, setEditing] = useState(false)
  const [draftEnabled, setDraftEnabled] = useState(initial.smsEnabled)
  const [draftCredits, setDraftCredits] = useState(initial.smsCreditBalance)
  const [saveState, setSaveState] = useState<AsyncState>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
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
        setSaveError(`HTTP ${res.status}`)
        return
      }
      setSaveState("success")
      setEditing(false)
      onSaved()
    } catch (err) {
      if (!mountedRef.current) return
      setSaveState("error")
      setSaveError(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [cabinetId, draftEnabled, draftCredits, initial.smsEnabled, initial.smsCreditBalance, onSaved])

  return (
    <section className="rounded-md border p-4 space-y-3" aria-labelledby="sms-section">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 id="sms-section" className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="size-5" aria-hidden="true" />
          Configuration SMS
          <Badge variant="outline" className="text-[10px]">V1 mock</Badge>
        </h2>
        {!editing && (
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={startEdit}>
            Modifier
          </DiabeoButton>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        V1 mock : aucun SMS réel envoyé (provider=&quot;mock&quot;). Real Twilio/OVH = US-2506bis V3.
        Le crédit décrémente quand même côté audit pour simuler le coût.
      </p>

      {!editing ? (
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Field label="SMS activé">
            <Badge variant={initial.smsEnabled ? "default" : "secondary"}>
              {initial.smsEnabled ? "OUI" : "NON"}
            </Badge>
          </Field>
          <Field label="Crédits SMS restants">
            <span className={initial.smsCreditBalance < 10 ? "text-orange-700 font-medium" : ""}>
              {initial.smsCreditBalance}
              {initial.smsCreditBalance < 10 && initial.smsEnabled && " ⚠ Faible"}
            </span>
          </Field>
        </dl>
      ) : (
        <div className="space-y-3">
          <BoolInput
            label="Activer SMS pour ce cabinet"
            value={draftEnabled}
            onChange={setDraftEnabled}
          />
          <NumberInput
            label="Crédits SMS"
            value={draftCredits}
            onChange={(v) => setDraftCredits(v ?? 0)}
            min={0}
            max={1_000_000}
          />

          {saveState === "error" && saveError && (
            <p role="alert" className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="size-4" aria-hidden="true" />
              Erreur : {saveError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <DiabeoButton variant="diabeoTertiary" onClick={() => setEditing(false)}>
              Annuler
            </DiabeoButton>
            <DiabeoButton
              onClick={() => setShowConfirm(true)}
              disabled={!hasChanges || saveState === "saving"}
            >
              <Save className="size-4 mr-1" aria-hidden="true" />
              {saveState === "saving" ? "Enregistrement…" : "Enregistrer"}
            </DiabeoButton>
          </div>
        </div>
      )}

      {/* Confirmation Dialog shadcn (focus trap + ESC + restore). */}
      <Dialog open={showConfirm} onOpenChange={(open) => { if (!open) setShowConfirm(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mettre à jour la configuration SMS ?</DialogTitle>
            <DialogDescription>
              {draftEnabled !== initial.smsEnabled && (
                <span className="block">
                  • SMS : <strong>{initial.smsEnabled ? "activé" : "désactivé"} → {draftEnabled ? "activé" : "désactivé"}</strong>
                </span>
              )}
              {draftCredits !== initial.smsCreditBalance && (
                <span className="block">
                  • Crédits : <strong>{initial.smsCreditBalance} → {draftCredits}</strong>
                </span>
              )}
              <span className="block mt-2 text-xs">
                Action tracée dans l&apos;audit log immuable.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DiabeoButton variant="diabeoTertiary" onClick={() => setShowConfirm(false)}>
              Annuler
            </DiabeoButton>
            <DiabeoButton onClick={() => void executeSave()}>
              <CheckCircle2 className="size-4 mr-1" aria-hidden="true" />
              Confirmer
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function TextInput({
  label,
  type = "text",
  value,
  onChange,
  maxLength,
  wide = false,
}: {
  label: string
  type?: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  wide?: boolean
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${wide ? "md:col-span-2" : ""}`}>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        className="rounded-md border bg-background px-3 py-2"
      />
    </label>
  )
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <input
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
        className="rounded-md border bg-background px-3 py-2"
      />
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
