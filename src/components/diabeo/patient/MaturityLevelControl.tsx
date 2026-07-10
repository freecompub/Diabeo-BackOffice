"use client"

/**
 * US-2657 (slice A2) — Contrôle du **niveau de maturité (autonomie)** du patient, dans l'onglet
 * Traitements de la fiche. Un DOCTOR (capability `canSetMaturity`) choisit le cran via un `<select>`
 * natif (single-select accessible : clavier, lecteur d'écran, pas de « couleur seule ») ; tout autre
 * rôle voit un **badge lecture seule**. Le changement passe par le transport de mutation injecté
 * (`PATCH /api/patients/maturity`, `patientId` ajouté par l'adaptateur, anti-énumération) après une
 * **confirmation** nommant la capacité accordée/retirée.
 *
 * Le `<select>` reste **contrôlé sur le cran courant** jusqu'à confirmation (choisir une valeur ouvre
 * le dialogue mais ne change rien tant que « Confirmer » n'est pas cliqué → annuler = no-op visuel).
 * Après succès, mise à jour **optimiste** du cran affiché (le fetch capability est monté une fois et
 * ne se rafraîchit pas via `router.refresh()`). Masqué (badge seul) sans transport (fail-closed).
 */
import { useEffect, useState } from "react"
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
import { maturityChangeMessageKey } from "@/components/diabeo/patient/maturity-change"

const LEVELS: readonly MaturityLevel[] = ["JUNIOR", "INTERMEDIATE", "CONFIRME"] as const
const LEVEL_KEY: Record<MaturityLevel, string> = {
  JUNIOR: "maturityJunior",
  INTERMEDIATE: "maturityIntermediate",
  CONFIRME: "maturityConfirme",
}

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

  // Cran affiché : état local (mise à jour optimiste après succès ; le fetch capability ne se
  // rafraîchit pas seul). Synchronisé si la prop change (rafraîchissement externe).
  const [level, setLevel] = useState<MaturityLevel>(maturityLevel)
  useEffect(() => setLevel(maturityLevel), [maturityLevel])

  const [target, setTarget] = useState<MaturityLevel | null>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [announce, setAnnounce] = useState("")

  // Lecture seule : rôle non autorisé (NURSE/VIEWER) ou pas de transport (fail-closed).
  if (!canSet || !mutate) {
    return (
      <p className="text-sm">
        <span className="text-muted-foreground">{t("maturityTitle")} : </span>
        <span className="font-medium">{t(LEVEL_KEY[level])}</span>
      </p>
    )
  }

  const apply = async () => {
    if (!target) return
    setPending(true)
    setFeedback(null)
    try {
      const res = await mutate("/api/patients/maturity", { level: target }, { method: "PATCH" })
      if (res.ok) {
        setLevel(target) // mise à jour optimiste du cran affiché
        setAnnounce(t("maturitySuccess", { level: t(LEVEL_KEY[target]) }))
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
      <label htmlFor="maturity-select" className="block text-sm text-muted-foreground">
        {t("maturityTitle")}
      </label>
      <select
        id="maturity-select"
        value={level}
        disabled={pending}
        onChange={(e) => {
          const picked = e.target.value as MaturityLevel
          if (picked !== level) {
            setFeedback(null)
            setTarget(picked)
          }
        }}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
      >
        {LEVELS.map((lvl) => (
          <option key={lvl} value={lvl}>
            {t(LEVEL_KEY[lvl])}
          </option>
        ))}
      </select>

      {/* Annonce de succès (lecteur d'écran) — le rafraîchissement RSC ne réénonce rien. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {feedback ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {feedback.text}
        </p>
      ) : null}

      <Dialog open={target !== null} onOpenChange={(o) => (!o ? setTarget(null) : null)}>
        <DialogContent aria-busy={pending}>
          <DialogHeader>
            <DialogTitle>{t("maturityConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {target ? t("maturityConfirmChange", { from: t(LEVEL_KEY[level]), to: t(LEVEL_KEY[target]) }) : null}
            </DialogDescription>
          </DialogHeader>
          {target ? <p className="text-sm text-muted-foreground">{t(maturityChangeMessageKey(level, target))}</p> : null}
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
