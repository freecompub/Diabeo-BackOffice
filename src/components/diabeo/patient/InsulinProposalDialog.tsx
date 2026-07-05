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
import { useId, useState } from "react"
import { useTranslations } from "next-intl"
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
import { buildProposalBody, mapProposalOutcome, type ProposableParameter } from "@/components/diabeo/patient/insulin-proposal"

type Feedback = { kind: "error" | "success"; text: string } | null

export function InsulinProposalDialog({
  parameterType,
  paramLabel,
  slot,
  unit,
  onSubmitted,
}: {
  parameterType: ProposableParameter
  /** Libellé traduit du paramètre (ex. « Facteur de sensibilité (ISF) »). */
  paramLabel: string
  slot: { range: string; value: number; startHour: number; endHour: number }
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
  const feedbackId = useId()

  // Fail-closed : sans transport de mutation injecté, pas de proposition possible.
  const mutate = ctx?.mutate
  if (!mutate) return null

  const reset = () => {
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
    setPending(true)
    setFeedback(null)
    try {
      const res = await mutate(
        "/api/adjustment-proposals",
        buildProposalBody({
          parameterType,
          proposedValue: proposed,
          startHour: slot.startHour,
          endHour: slot.endHour,
          comment: comment.trim() || undefined,
        }),
      )
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
    } catch {
      setFeedback({ kind: "error", text: t("proposalErrorGeneric") })
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("proposeButton")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent>
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
            hint={unit}
            aria-describedby={feedback ? feedbackId : undefined}
          />
          <DiabeoTextField
            label={t("proposalComment")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />

          <p
            id={feedbackId}
            role={feedback?.kind === "error" ? "alert" : "status"}
            aria-live={feedback?.kind === "error" ? "assertive" : "polite"}
            className={`min-h-5 text-sm ${feedback?.kind === "error" ? "text-destructive" : "text-feedback-success"}`}
          >
            {feedback?.text ?? ""}
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
