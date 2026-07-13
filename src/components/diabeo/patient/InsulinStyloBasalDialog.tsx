"use client"

/**
 * US-2663 (S4) — Fenêtre de PROPOSITION groupée de la basale STYLO (MDI, doses en U TOTALES).
 *
 * Pendant STYLO de {@link InsulinBasalSlotSetDialog} (pompe) pour la voie manuelle groupée : le modèle
 * de créneau n'est PAS temporel mais discriminé par la dose ciblée — `daily` (schéma « single ») ou
 * `morning` + `evening` (schéma « split »), en U totales (jamais U/h). Pas de couverture 24 h ni de
 * frise : une dose lente couvre la journée par construction.
 *
 * **Accusé jour-de-maladie / acidocétose (DKA) — case conditionnelle** : en audience **patient**, dès
 * qu'au moins une dose est **baissée** (valeur saisie < dose active), le patient DOIT cocher l'accusé
 * avant de pouvoir soumettre. Réduire une insuline lente un jour de maladie expose à l'acidocétose ;
 * l'accusé est un garde-fou clinique (US-2659, généralisé au jeu — D3 : UN accusé couvre TOUTES les
 * baisses stylo du jeu). Le serveur reste l'autorité : sans accusé il renvoie `dkaAcknowledgmentRequired`.
 * Les soignants (audience `pro`) ne sont PAS gatés (cliniciens qualifiés) — pas de case.
 *
 * Voie d'écriture : PROPOSITION uniquement (jamais d'application directe, ADR #13) — `POST
 * /api/slot-set-proposals` (pro) ou `PUT /api/patient/insulin-slot-set` (patient own-id) via le
 * transport de mutation injecté. Masqué (`null`) si aucun transport n'est injecté (fail-closed).
 */
import { useEffect, useMemo, useRef, useState } from "react"
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
import { usePatientRecordContext } from "@/components/diabeo/patient/PatientRecordContext"
import {
  validateStyloRows,
  canSubmitStylo,
  hasStyloDecrease,
  buildProposeStyloRequest,
  mapSlotSetOutcome,
  type StyloDoseRow,
  type StyloKind,
  type ProposeAudience,
} from "@/components/diabeo/patient/insulin-slot-set-edit"

type InitialStyloDose = { kind: StyloKind; value: number }
type Feedback = { kind: "error" | "success"; text: string } | null

/** Clé i18n du libellé de chaque dose stylo (namespace `patientDetail`). */
const KIND_LABEL_KEY: Record<StyloKind, string> = {
  daily: "slotSetStyloDaily",
  morning: "slotSetStyloMorning",
  evening: "slotSetStyloEvening",
}

/**
 * @param audience `"pro"` (soignant, non gaté) vs `"patient"` (own-id, gaté DKA sur baisse).
 * @param initialSlots Doses stylo ACTIVES (single = `daily` ; split = `morning`+`evening`, U totales).
 * @param bounds Bornes cliniques de dose (U totales) — confort UI ; le serveur reste l'autorité.
 */
export function InsulinStyloBasalDialog({
  paramLabel,
  unit,
  initialSlots,
  bounds,
  audience = "patient",
}: {
  paramLabel: string
  unit: string
  initialSlots: InitialStyloDose[]
  bounds: { min: number; max: number }
  audience?: ProposeAudience
}) {
  const t = useTranslations("patientDetail")
  const router = useRouter()
  const ctx = usePatientRecordContext()
  const mutate = ctx?.mutate
  const triggerRef = useRef<HTMLButtonElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const keyCounter = useRef(0)

  // Abort d'une soumission en vol si le composant est démonté (hygiène anti-setState-after-unmount).
  useEffect(() => () => abortRef.current?.abort(), [])

  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<StyloDoseRow[]>([])
  const [initialSnapshot, setInitialSnapshot] = useState("")
  const [dkaAck, setDkaAck] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  // Hooks AVANT tout return conditionnel (règles des hooks).
  const validation = useMemo(() => validateStyloRows(rows, bounds), [rows, bounds])
  // Baisse détectée + audience patient → accusé DKA requis (miroir front de `evaluatePatientGroupedGate`).
  const dkaRequired = useMemo(() => audience === "patient" && hasStyloDecrease(rows), [audience, rows])

  if (!mutate) return null

  const nextKey = () => `stylo-${keyCounter.current++}`
  const snapshot = (rs: StyloDoseRow[]) => JSON.stringify(rs.map((r) => [r.kind, r.value.replace(",", ".")]))

  const toRows = (slots: InitialStyloDose[]): StyloDoseRow[] =>
    slots.map((s) => ({ key: nextKey(), kind: s.kind, value: String(s.value), initialValue: s.value }))

  const openDialog = () => {
    const rs = toRows(initialSlots)
    setRows(rs)
    setInitialSnapshot(snapshot(rs))
    setDkaAck(false)
    setFeedback(null)
    setPending(false)
    setOpen(true)
  }

  const reset = () => {
    abortRef.current?.abort()
    setRows([])
    setDkaAck(false)
    setFeedback(null)
    setPending(false)
  }

  const isDirty = snapshot(rows) !== initialSnapshot
  // Soumission active : lignes valides + modifiées + (si accusé DKA requis) accusé coché.
  const submittable = canSubmitStylo(rows, bounds, isDirty) && (!dkaRequired || dkaAck) && !pending

  const updateRow = (key: string, value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, value } : r)))

  const invalidMessage = validation.invalidValueKeys.size > 0 ? t("slotSetStyloInvalidBanner", { min: bounds.min, max: bounds.max, unit }) : ""

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!submittable) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPending(true)
    setFeedback(null)
    try {
      // `sickDayAcknowledged` transmis ssi requis ET coché (le serveur re-vérifie via la garde patient).
      const req = buildProposeStyloRequest(rows, audience, dkaRequired && dkaAck ? true : undefined)
      const res = await mutate(req.endpoint, req.body, { method: req.method, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      const jb: { error?: string } = await res.json().catch(() => ({}))
      const outcome = mapSlotSetOutcome(res.status, jb.error)
      if (outcome.kind === "success") {
        setFeedback({ kind: "success", text: t("slotSetProposeSuccess") })
        void Promise.resolve().then(() => router.refresh())
      } else {
        setFeedback({ kind: "error", text: t(outcome.messageKey) })
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setFeedback({ kind: "error", text: t("slotSetErrorGeneric") })
    } finally {
      if (!ctrl.signal.aborted) setPending(false)
    }
  }

  return (
    <>
      <Button ref={triggerRef} variant="outline" size="sm" onClick={openDialog}>
        {t("slotSetProposeButton")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent finalFocus={triggerRef} className="max-w-lg">
          <form onSubmit={submit} aria-busy={pending} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("slotSetProposeTitle", { param: paramLabel })}</DialogTitle>
              <DialogDescription>{t("slotSetProposeDescription")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {rows.map((r, index) => {
                const badValue = validation.invalidValueKeys.has(r.key)
                const inputId = `stylo-dose-${r.key}`
                const rowN = t("slotSetRowN", { n: index + 1 })
                return (
                  <div key={r.key} className="flex items-center justify-between gap-3">
                    <label htmlFor={inputId} className="text-sm text-muted-foreground">
                      {t(KIND_LABEL_KEY[r.kind])}
                    </label>
                    <span className="flex items-center gap-2">
                      <input
                        id={inputId}
                        inputMode="decimal"
                        value={r.value}
                        onChange={(e) => updateRow(r.key, e.target.value)}
                        aria-label={`${t(KIND_LABEL_KEY[r.kind])} — ${rowN}`}
                        aria-invalid={badValue}
                        className={
                          "w-24 rounded-md border bg-background px-2 py-1 text-foreground " +
                          (badValue ? "border-destructive" : "border-input")
                        }
                      />
                      <span className="text-sm text-muted-foreground">{unit}</span>
                    </span>
                  </div>
                )
              })}
            </div>

            {invalidMessage ? (
              <p id="stylo-invalid" role="status" aria-live="polite" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {invalidMessage}
              </p>
            ) : null}

            {/* Accusé jour-de-maladie / acidocétose (DKA) — visible SEULEMENT si une baisse stylo est
                proposée par le patient. Bloque la soumission tant qu'il n'est pas coché (le serveur
                re-vérifie via `dkaAcknowledgmentRequired`). */}
            {dkaRequired ? (
              <div className="rounded-md border border-warning-border bg-warning-bg px-3 py-2">
                <label htmlFor="stylo-dka-ack" className="flex items-start gap-2 text-sm text-warning-fg">
                  <input
                    id="stylo-dka-ack"
                    type="checkbox"
                    checked={dkaAck}
                    onChange={(e) => setDkaAck(e.target.checked)}
                    aria-describedby="stylo-dka-hint"
                    aria-required={true}
                    aria-invalid={!dkaAck}
                    className="mt-0.5 size-4 shrink-0 rounded-sm border-input accent-primary"
                  />
                  <span>
                    {t("slotSetDkaLabel")}
                    <span id="stylo-dka-hint" className="mt-1 block text-xs text-muted-foreground">
                      {t("slotSetDkaHint")}
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            {/* Motif de blocage annoncé aux lecteurs d'écran (WCAG 3.3.1/4.1.3) : le submit `aria-disabled`
                pointe dessus via `aria-describedby`, pour ne pas rester muet sur la RAISON (accusé DKA non coché). */}
            {dkaRequired && !dkaAck ? (
              <p id="stylo-dka-block" role="alert" className="text-sm text-destructive">
                {t("slotSetDkaRequiredBlocker")}
              </p>
            ) : null}

            {feedback ? (
              <p
                role={feedback.kind === "error" ? "alert" : "status"}
                aria-live={feedback.kind === "error" ? "assertive" : "polite"}
                aria-atomic="true"
                className={
                  "rounded-md px-3 py-2 text-sm " +
                  (feedback.kind === "error"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-feedback-success-bg text-feedback-success")
                }
              >
                {feedback.text}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t("slotSetCancel")}
              </Button>
              {/* `aria-disabled` (pas `disabled`) : le bouton reste focusable → le lecteur d'écran peut
                  annoncer la raison du blocage. `aria-describedby` pointe sur le motif ACTIF (accusé DKA
                  manquant en priorité, sinon dose invalide). Le handler `submit` no-op si `!submittable`. */}
              <Button
                type="submit"
                aria-disabled={!submittable}
                aria-describedby={
                  submittable ? undefined : dkaRequired && !dkaAck ? "stylo-dka-block" : invalidMessage ? "stylo-invalid" : undefined
                }
                className={!submittable ? "cursor-not-allowed bg-muted text-muted-foreground hover:bg-muted" : undefined}
              >
                {pending ? t("slotSetSaving") : t("slotSetProposeSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
