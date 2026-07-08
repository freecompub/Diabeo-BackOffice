"use client"

/**
 * US-2657 (slice A2) — Contrôle du **niveau de maturité (autonomie)** du patient, dans l'onglet
 * Traitements de la fiche. Un DOCTOR (capability `canSetMaturity`) choisit le cran ; tout autre rôle
 * voit un **badge lecture seule**. Le changement passe par le transport de mutation injecté
 * (`PATCH /api/patients/maturity`, `patientId` ajouté par l'adaptateur, anti-énumération) après une
 * **confirmation** nommant la capacité accordée/retirée.
 *
 * Masqué (badge seul) si aucun transport n'est injecté (fail-closed). L'autorité reste la route
 * (`requireRole("DOCTOR")` exact) — ce contrôle ne fait que refléter/piloter l'UI.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import type { MaturityLevel } from "@prisma/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { usePatientRecordContext } from "@/components/diabeo/patient/PatientRecordContext"

const LEVELS: readonly MaturityLevel[] = ["JUNIOR", "INTERMEDIATE", "EXPERT"] as const
const LEVEL_KEY: Record<MaturityLevel, string> = {
  JUNIOR: "maturityJunior",
  INTERMEDIATE: "maturityIntermediate",
  EXPERT: "maturityExpert",
}
const RANK: Record<MaturityLevel, number> = { JUNIOR: 0, INTERMEDIATE: 1, EXPERT: 2 }

type Feedback = { kind: "error"; text: string } | null

export function MaturityLevelControl({
  maturityLevel,
  canSet,
}: {
  maturityLevel: MaturityLevel
  canSet: boolean
}) {
  const t = useTranslations("patientDetail")
  const router = useRouter()
  const ctx = usePatientRecordContext()
  const mutate = ctx?.mutate

  const [target, setTarget] = useState<MaturityLevel | null>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  // Lecture seule : rôle non autorisé (NURSE/VIEWER) ou pas de transport (fail-closed).
  if (!canSet || !mutate) {
    return (
      <p className="text-sm">
        <span className="text-muted-foreground">{t("maturityTitle")} : </span>
        <span className="font-medium">{t(LEVEL_KEY[maturityLevel])}</span>
      </p>
    )
  }

  // Message de confirmation : nomme la capacité accordée (montée) ou retirée (descente).
  const confirmMessage = (to: MaturityLevel): string => {
    if (RANK[to] > RANK[maturityLevel]) {
      return to === "EXPERT" ? t("maturityGrantExpert") : t("maturityGrantSlots")
    }
    return t("maturityDowngradeNote")
  }

  const apply = async () => {
    if (!target) return
    setPending(true)
    setFeedback(null)
    try {
      const res = await mutate("/api/patients/maturity", { level: target }, { method: "PATCH" })
      if (res.ok) {
        setTarget(null)
        void Promise.resolve().then(() => router.refresh())
      } else {
        setFeedback({ kind: "error", text: t("maturityError") })
      }
    } catch {
      setFeedback({ kind: "error", text: t("maturityError") })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t("maturityTitle")}</p>
      <div role="group" aria-label={t("maturityTitle")} className="inline-flex overflow-hidden rounded-md border border-border">
        {LEVELS.map((lvl) => {
          const current = lvl === maturityLevel
          return (
            <button
              key={lvl}
              type="button"
              aria-pressed={current}
              disabled={pending}
              onClick={() => {
                if (!current) {
                  setFeedback(null)
                  setTarget(lvl)
                }
              }}
              className={
                "px-3 py-1.5 text-sm font-medium " +
                (current ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-muted")
              }
            >
              {t(LEVEL_KEY[lvl])}
            </button>
          )
        })}
      </div>
      {feedback ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {feedback.text}
        </p>
      ) : null}

      <Dialog open={target !== null} onOpenChange={(o) => (!o ? setTarget(null) : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("maturityConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {target
                ? t("maturityConfirmChange", { from: t(LEVEL_KEY[maturityLevel]), to: t(LEVEL_KEY[target]) })
                : null}
            </DialogDescription>
          </DialogHeader>
          {target ? <p className="text-sm text-muted-foreground">{confirmMessage(target)}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTarget(null)} disabled={pending}>
              {t("maturityCancel")}
            </Button>
            <Button type="button" onClick={apply} disabled={pending}>
              {pending ? t("maturitySaving") : t("maturityConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
