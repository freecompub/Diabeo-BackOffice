"use client"

/**
 * US-2648b — Dialog de **proposition d'ajustement** d'un créneau ISF/ICR (NURSE/patient).
 *
 * Ouvre un formulaire (nouvelle valeur + commentaire optionnel) et soumet via le
 * transport de mutation INJECTÉ (`POST /api/adjustment-proposals`, l'adaptateur ajoute
 * l'identité — anti-énumération). La proposition part en validation médecin (jamais
 * appliquée directement, ADR #13). Les issues (doublon, hors bornes, garde-fou patient…)
 * sont annoncées via une région `aria-live`.
 *
 * Masqué (retourne `null`) si aucun transport de mutation n'est injecté (contexte lecture
 * seule) — fail-closed. Le RBAC réel est imposé par la route (US-2648a) ; ce composant ne
 * s'affiche que là où la capability l'autorise (`canPropose`).
 */
import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
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
import { usePatientRecordContext } from "@/components/diabeo/patient/PatientRecordContext"
import {
  buildProposalBody,
  mapProposalOutcome,
  type ProposableParameter,
  type ProposalTarget,
} from "@/components/diabeo/patient/insulin-proposal"

type Feedback = { kind: "error" | "success"; text: string } | null

/** Bornes cliniques par paramètre proposable (source unique `CLINICAL_BOUNDS`) — affichées
 *  en indice pour éviter les allers-retours de typo (revue clinique). Serveur = autorité. */
const PARAM_BOUNDS: Record<ProposableParameter, { min: number; max: number }> = {
  insulinSensitivityFactor: { min: CLINICAL_BOUNDS.ISF_GL_MIN, max: CLINICAL_BOUNDS.ISF_GL_MAX },
  insulinToCarbRatio: { min: CLINICAL_BOUNDS.ICR_MIN, max: CLINICAL_BOUNDS.ICR_MAX },
  basalRate: { min: CLINICAL_BOUNDS.BASAL_MIN, max: CLINICAL_BOUNDS.BASAL_MAX },
}

export function InsulinProposalDialog({
  parameterType,
  paramLabel,
  slot,
  target,
  unit,
  onSubmitted,
}: {
  parameterType: ProposableParameter
  /** Libellé traduit du paramètre (ex. « Facteur de sensibilité (ISF) »). */
  paramLabel: string
  /** Créneau à afficher (plage + valeur courante). */
  slot: { range: string; value: number }
  /** Cible adressable de la proposition (créneau horaire ISF/ICR ou créneau pompe basal). */
  target: ProposalTarget
  unit: string
  /** Appelé après une proposition acceptée (ex. rafraîchir une liste). */
  onSubmitted?: () => void
}) {
  const t = useTranslations("patientDetail")
  const ctx = usePatientRecordContext()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [comment, setComment] = useState("")
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bounds = PARAM_BOUNDS[parameterType]

  // Fail-closed : sans transport de mutation injecté, pas de proposition possible.
  const mutate = ctx?.mutate
  if (!mutate) return null

  const reset = () => {
    abortRef.current?.abort() // annule une soumission en vol à la fermeture (anti-course)
    setValue("")
    setComment("")
    setFeedback(null)
    setPending(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const proposed = Number(value.replace(",", "."))
    if (!Number.isFinite(proposed) || value.trim() === "") {
      setFeedback({ kind: "error", text: t("proposalErrorValidation") })
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPending(true)
    setFeedback(null)
    try {
      const res = await mutate(
        "/api/adjustment-proposals",
        buildProposalBody({
          parameterType,
          proposedValue: proposed,
          target,
          comment: comment.trim() || undefined,
        }),
        { signal: ctrl.signal },
      )
      if (ctrl.signal.aborted) return
      const body: { error?: string } = await res.json().catch(() => ({}))
      const outcome = mapProposalOutcome(res.status, body.error)
      if (outcome.kind === "success") {
        setValue("")
        setComment("")
        setFeedback({ kind: "success", text: t("proposalSuccess") })
        onSubmitted?.()
      } else {
        setFeedback({ kind: "error", text: t(outcome.messageKey) })
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setFeedback({ kind: "error", text: t("proposalErrorGeneric") })
    } finally {
      if (!ctrl.signal.aborted) setPending(false)
    }
  }

  return (
    <>
      <Button ref={triggerRef} variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("proposeButton")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        {/* WCAG 2.4.3 — `finalFocus` (prop du Popup) rend le focus au bouton déclencheur
            à la fermeture : le trigger n'est pas un DialogTrigger, Base UI ne le retrouve
            pas seul. */}
        <DialogContent finalFocus={triggerRef}>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("proposalTitle")}</DialogTitle>
            <DialogDescription>
              {paramLabel} · {slot.range} · {t("proposalCurrentValue")} {slot.value} {unit}
            </DialogDescription>
          </DialogHeader>

          <DiabeoTextField
            label={t("proposalNewValue")}
            type="number"
            inputMode="decimal"
            step="any"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            // Indice de plage clinique (borne min–max + unité) — évite les typos ;
            // le serveur reste l'autorité (US-2649a). WCAG 3.3.1 : aria-invalid en erreur.
            hint={`${bounds.min}–${bounds.max} ${unit}`}
            aria-invalid={feedback?.kind === "error" || undefined}
          />
          <DiabeoTextField
            label={t("proposalComment")}
            value={comment}
            maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
          />

          {/* WCAG 4.1.3 — deux régions live STABLES (toujours montées), pas de bascule
              de role/aria-live sur un même nœud : erreur = assertive, succès = polite. */}
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
              {t("proposalSubmit")}
            </Button>
          </DialogFooter>
        </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
