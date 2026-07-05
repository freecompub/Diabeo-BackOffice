"use client"

/**
 * US-2648b — Dialog d'édition DIRECTE (DOCTOR) de la valeur d'un créneau ISF/ICR/basal.
 *
 * Contrairement à la proposition, l'écriture est APPLIQUÉE immédiatement (PATCH
 * `/api/insulin-therapy/*`, DOCTOR only) via le transport de mutation injecté (méthode
 * `PATCH`, l'adaptateur ajoute l'identité). Après succès, `router.refresh()` re-projette
 * la fiche (Server Component) pour refléter la nouvelle valeur. Bornes + incrément basal
 * imposés SERVEUR ; l'indice montre la plage. A11y alignée sur le dialog de proposition.
 *
 * Masqué (`null`) si aucun transport de mutation n'est injecté (fail-closed). Ne s'affiche
 * que là où la capability l'autorise (`canEditDirect`).
 */
import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { DiabeoTextField } from "@/components/diabeo/DiabeoTextField"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
import { usePatientRecordContext } from "@/components/diabeo/patient/PatientRecordContext"
import { PARAM_BOUNDS, type ProposableParameter } from "@/components/diabeo/patient/insulin-proposal"
import { directEditRequest, mapDirectEditOutcome } from "@/components/diabeo/patient/insulin-direct-edit"

type Feedback = { kind: "error" | "success"; text: string } | null

export function InsulinDirectEditDialog({
  parameterType,
  paramLabel,
  slot,
  unit,
}: {
  parameterType: ProposableParameter
  paramLabel: string
  /** Créneau à éditer : `id` (cible PATCH) + plage + valeur courante. */
  slot: { id: string; range: string; value: number }
  unit: string
}) {
  const t = useTranslations("patientDetail")
  const router = useRouter()
  const ctx = usePatientRecordContext()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bounds = PARAM_BOUNDS[parameterType]

  const mutate = ctx?.mutate
  if (!mutate) return null

  const reset = () => {
    abortRef.current?.abort()
    setValue("")
    setFeedback(null)
    setPending(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = Number(value.replace(",", "."))
    if (!Number.isFinite(v) || value.trim() === "") {
      setFeedback({ kind: "error", text: t("directEditErrorValidation") })
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPending(true)
    setFeedback(null)
    try {
      const { endpoint, body } = directEditRequest(parameterType, slot.id, v)
      const res = await mutate(endpoint, body, { method: "PATCH", signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      const jb: { error?: string } = await res.json().catch(() => ({}))
      const outcome = mapDirectEditOutcome(res.status, jb.error)
      if (outcome.kind === "success") {
        setValue("") // vide le champ (parité proposition) → pas de re-PATCH de valeur périmée
        setFeedback({ kind: "success", text: t("directEditSuccess") })
        // Différé d'un microtask : laisse la région live annoncer le succès dans ce cycle de
        // rendu AVANT que le refresh re-projette la fiche (évite de couper l'annonce SR, WCAG 4.1.3).
        void Promise.resolve().then(() => router.refresh())
      } else {
        setFeedback({ kind: "error", text: t(outcome.messageKey) })
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setFeedback({ kind: "error", text: t("directEditErrorGeneric") })
    } finally {
      if (!ctrl.signal.aborted) setPending(false)
    }
  }

  return (
    <>
      <Button ref={triggerRef} variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("editButton")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent finalFocus={triggerRef}>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("directEditTitle")}</DialogTitle>
              <DialogDescription>
                {paramLabel} · {slot.range} · {t("proposalCurrentValue")} {slot.value} {unit}
              </DialogDescription>
            </DialogHeader>

            <DiabeoTextField
              label={t("directEditNewValue")}
              type="number"
              inputMode="decimal"
              step={parameterType === "basalRate" ? String(CLINICAL_BOUNDS.PUMP_BASAL_INCREMENT) : "any"}
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              hint={`${bounds.min}–${bounds.max} ${unit}`}
              aria-invalid={feedback?.kind === "error" || undefined}
            />

            <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-destructive">
              {feedback?.kind === "error" ? feedback.text : ""}
            </p>
            <p role="status" aria-live="polite" className="text-sm text-feedback-success">
              {feedback?.kind === "success" ? feedback.text : ""}
            </p>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("proposalCancel")}
              </Button>
              <Button type="submit" disabled={pending} aria-busy={pending}>
                {t("directEditSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
