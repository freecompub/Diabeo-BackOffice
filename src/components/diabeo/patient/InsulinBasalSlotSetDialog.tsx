"use client"

/**
 * US-2657 (grouped-only, ADR #23) — Fenêtre d'édition de GROUPE des créneaux BASAUX (pompe).
 *
 * Pendant basal de {@link InsulinSlotSetDialog} (ISF/ICR, US-2656) : même UX (table de créneaux,
 * frise de couverture 24 h, bannière de cohérence pilotant « Valider »), mais le modèle de créneau
 * diffère — temps `"HH:MM"` minute-précis (`<input type="time">`, pas un entier `[0,23]`) et débit
 * devant être **délivrable** (multiple de l'incrément pompe `PUMP_BASAL_INCREMENT`, pas seulement
 * dans les bornes). L'enregistrement remplace TOUT le jeu (`PUT`, DOCTOR direct) via le transport de
 * mutation injecté. La cohérence front est un **confort** ; le serveur (`assertValidPumpSlotSet`)
 * reste l'autorité — un rejet est réaffiché sans perte de saisie.
 *
 * C'est la SEULE voie d'édition basale : les écritures par-créneau (`POST`/`PATCH`/`DELETE` sur
 * `/api/insulin-therapy/basal-config/pump-slots`) ont été retirées serveur (US-2657) —
 * `InsulinDirectEditDialog` (édition directe par-créneau, US-2648b) a été retiré en conséquence.
 *
 * Masqué (`null`) si aucun transport n'est injecté (fail-closed) ; rendu là où la capability DOCTOR
 * `canEditDirect` l'autorise.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { Plus, Trash2, AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
import { usePatientRecordContext } from "@/components/diabeo/patient/PatientRecordContext"
import {
  describeBasalCoverage,
  validateBasalRows,
  canSubmitBasal,
  buildReplaceBasalRequest,
  buildProposeBasalRequest,
  mapSlotSetOutcome,
  type BasalSlotRow,
  type TimeRange,
  type ProposeAudience,
} from "@/components/diabeo/patient/insulin-slot-set-edit"

type InitialBasalSlot = { startTime: string; endTime: string; value: number }
type Feedback = { kind: "error" | "success"; text: string } | null

const fmtRanges = (ranges: TimeRange[]) =>
  ranges.map((r) => `${r.startTime}–${r.endTime}`).join(", ")

/**
 * @param mode `"direct"` (défaut) écrit la config ACTIVE (DOCTOR) ; `"propose"` crée une proposition
 *   d'ensemble pour revue médecin (NURSE / patient). Une baisse basale POMPE n'exige PAS d'accusé DKA
 *   (contrairement au stylo — cf. `InsulinStyloBasalDialog`).
 * @param audience `"pro"` (soignant) vs `"patient"` (own-id). Ignoré en mode `direct`.
 * @param structural `true` autorise la RESTRUCTURATION (changer les temps, ajouter/supprimer un créneau) ;
 *   `false` = **valeurs seules** (temps en lecture). Côté PATIENT, reflète la maturité (US-2663 : JUNIOR =
 *   valeurs seules ; INTERMEDIATE/CONFIRME = restructuration). La sûreté reste SERVEUR
 *   (`evaluatePatientGroupedGate` : enveloppe minute-par-minute — une baisse pompe exige INTERMEDIATE+).
 */
export function InsulinBasalSlotSetDialog({
  paramLabel,
  unit,
  initialSlots,
  bounds,
  mode = "direct",
  audience = "pro",
  structural = true,
}: {
  paramLabel: string
  unit: string
  initialSlots: InitialBasalSlot[]
  bounds: { min: number; max: number }
  mode?: "direct" | "propose"
  audience?: ProposeAudience
  structural?: boolean
}) {
  const t = useTranslations("patientDetail")
  const router = useRouter()
  const ctx = usePatientRecordContext()
  const mutate = ctx?.mutate
  const triggerRef = useRef<HTMLButtonElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const keyCounter = useRef(0)

  // Abort d'un PUT en vol si le composant est démonté (hygiène anti-setState-after-unmount).
  useEffect(() => () => abortRef.current?.abort(), [])

  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<BasalSlotRow[]>([])
  const [initialSnapshot, setInitialSnapshot] = useState("")
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  // Hooks AVANT tout return conditionnel (règles des hooks).
  const coverage = useMemo(() => describeBasalCoverage(rows), [rows])
  const validation = useMemo(() => validateBasalRows(rows, bounds), [rows, bounds])

  if (!mutate) return null

  const nextKey = () => `basal-slot-${keyCounter.current++}`
  const snapshot = (rs: BasalSlotRow[]) =>
    JSON.stringify(rs.map((r) => [r.startTime, r.endTime, r.value.replace(",", ".")]))

  const toRows = (slots: InitialBasalSlot[]): BasalSlotRow[] =>
    slots.map((s) => ({ key: nextKey(), startTime: s.startTime, endTime: s.endTime, value: String(s.value) }))

  const openDialog = () => {
    const rs = toRows(initialSlots)
    setRows(rs)
    setInitialSnapshot(snapshot(rs))
    setFeedback(null)
    setPending(false)
    setOpen(true)
  }

  const reset = () => {
    abortRef.current?.abort()
    setRows([])
    setFeedback(null)
    setPending(false)
  }

  const isDirty = snapshot(rows) !== initialSnapshot
  const submittable = canSubmitBasal(rows, bounds, isDirty) && !pending

  const updateRow = (key: string, patch: Partial<BasalSlotRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const addRow = () => {
    const key = nextKey()
    setRows((rs) => [...rs, { key, startTime: "00:00", endTime: "00:00", value: "" }])
    // Symétrie avec la suppression (WCAG 2.4.3) : focus sur le champ valeur du nouveau créneau.
    requestAnimationFrame(() => document.getElementById(`basal-value-${key}`)?.focus())
  }
  const deleteRow = (key: string) => {
    setRows((rs) => rs.filter((r) => r.key !== key))
    // Après suppression, ramener le focus sur « Ajouter » (élément stable) — évite de perdre le
    // focus vers le body (WCAG 2.4.3).
    requestAnimationFrame(() => addButtonRef.current?.focus())
  }

  // Message de cohérence (nommé) — pilote l'état de « Valider » et est annoncé (aria-live).
  const invalid =
    validation.invalidValueKeys.size > 0 || validation.invalidTimeKeys.size > 0 || validation.zeroDurationKeys.size > 0
  const coherenceMessage = coverage.hasOverlap
    ? t("slotSetOverlapBanner", { ranges: fmtRanges(coverage.overlaps) })
    : coverage.hasGap
      ? t("slotSetGapBanner", { ranges: fmtRanges(coverage.gaps) })
      : invalid
        ? t("slotSetInvalidBanner")
        : t("slotSetCoherentBanner")
  const coherenceKind: "ok" | "warn" = coverage.hasGap || coverage.hasOverlap || invalid ? "warn" : "ok"

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!submittable) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPending(true)
    setFeedback(null)
    try {
      const req =
        mode === "propose"
          ? buildProposeBasalRequest(rows, audience)
          : { ...buildReplaceBasalRequest(rows), method: "PUT" as const }
      const res = await mutate(req.endpoint, req.body, { method: req.method, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      const jb: { error?: string } = await res.json().catch(() => ({}))
      const outcome = mapSlotSetOutcome(res.status, jb.error)
      if (outcome.kind === "success") {
        setFeedback({ kind: "success", text: mode === "propose" ? t("slotSetProposeSuccess") : t("slotSetSuccess") })
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
      {/* Nom accessible UNIQUE (SC 2.5.3) : le paramètre distingue les boutons « Proposer/Modifier » de la page. */}
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        onClick={openDialog}
        aria-label={`${mode === "propose" ? t("slotSetProposeButton") : t("slotSetEditButton")} — ${paramLabel}`}
      >
        {mode === "propose" ? t("slotSetProposeButton") : t("slotSetEditButton")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent finalFocus={triggerRef} className="max-w-2xl">
          <form onSubmit={submit} aria-busy={pending} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {mode === "propose" ? t("slotSetProposeTitle", { param: paramLabel }) : t("slotSetTitle", { param: paramLabel })}
              </DialogTitle>
              <DialogDescription>
                {mode === "propose" ? t("slotSetProposeDescription") : t("slotSetDescription")}
              </DialogDescription>
            </DialogHeader>

            {/* Frise de couverture 24 h (décorative, résolution 30 min — la bannière porte le texte
                minute-précis). */}
            <div aria-hidden="true" className="flex h-3 overflow-hidden rounded-md border border-border">
              {coverage.cover.map((c, i) => (
                <div
                  key={i}
                  className={
                    "flex-1 " +
                    (c === 0
                      ? "bg-destructive/25"
                      : c >= 2
                        ? "bg-secondary/30"
                        : "bg-primary/20")
                  }
                />
              ))}
            </div>

            {/* Table des créneaux. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th scope="col" className="p-2 text-left font-medium">
                      {t("slotSetColStart")}
                    </th>
                    <th scope="col" className="p-2 text-left font-medium">
                      {t("slotSetColEnd")}
                    </th>
                    <th scope="col" className="p-2 text-left font-medium">
                      {t("slotSetColValue", { unit })}
                    </th>
                    {structural ? (
                      <th scope="col" className="p-2">
                        <span className="sr-only">{t("slotSetColActions")}</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, index) => {
                    const conflict = coverage.conflictKeys.has(r.key)
                    const badValue = validation.invalidValueKeys.has(r.key) || validation.invalidTimeKeys.has(r.key)
                    const rowN = t("slotSetRowN", { n: index + 1 })
                    const conflictId = `basal-slot-conflict-${r.key}`
                    const describedBy = conflict ? conflictId : undefined
                    return (
                      <tr
                        key={r.key}
                        className={conflict ? "border-l-4 border-destructive bg-destructive/10" : "border-l-4 border-transparent"}
                      >
                        <td className="p-2">
                          {structural ? (
                            <input
                              type="time"
                              value={r.startTime}
                              onChange={(e) => updateRow(r.key, { startTime: e.target.value })}
                              aria-label={`${t("slotSetColStart")} — ${rowN}`}
                              aria-describedby={describedBy}
                              className="w-28 rounded-md border border-input bg-background px-2 py-1 text-foreground"
                            />
                          ) : (
                            // Valeurs seules (patient) : le temps est en LECTURE (pas de restructuration serveur).
                            <span className="tabular-nums text-muted-foreground">{r.startTime}</span>
                          )}
                        </td>
                        <td className="p-2">
                          {structural ? (
                            <input
                              type="time"
                              value={r.endTime}
                              onChange={(e) => updateRow(r.key, { endTime: e.target.value })}
                              aria-label={`${t("slotSetColEnd")} — ${rowN}`}
                              aria-describedby={describedBy}
                              className="w-28 rounded-md border border-input bg-background px-2 py-1 text-foreground"
                            />
                          ) : (
                            <span className="tabular-nums text-muted-foreground">{r.endTime}</span>
                          )}
                        </td>
                        <td className="p-2">
                          <input
                            id={`basal-value-${r.key}`}
                            inputMode="decimal"
                            step={CLINICAL_BOUNDS.PUMP_BASAL_INCREMENT}
                            value={r.value}
                            onChange={(e) => updateRow(r.key, { value: e.target.value })}
                            aria-label={`${t("slotSetColValue", { unit })} — ${rowN}`}
                            aria-invalid={badValue}
                            // WCAG 3.3.1 : une valeur invalide renvoie à la bannière de cohérence (bornes/débit
                            // non délivrable), sinon au conflit horaire éventuel. Jamais `aria-invalid` muet.
                            aria-describedby={badValue ? "basal-slot-set-coherence" : describedBy}
                            className={
                              "w-24 rounded-md border bg-background px-2 py-1 text-foreground " +
                              (badValue ? "border-destructive" : "border-input")
                            }
                          />
                        </td>
                        {structural ? (
                          <td className="p-2 text-right">
                            {conflict ? (
                              <AlertTriangle className="mr-1 inline size-4 text-destructive" aria-hidden="true" />
                            ) : null}
                            {conflict ? (
                              <span id={conflictId} className="sr-only">
                                {t("slotSetRowInConflict")}
                              </span>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteRow(r.key)}
                              aria-label={t("slotSetDeleteRow", { start: r.startTime, end: r.endTime })}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {structural ? (
              <Button ref={addButtonRef} type="button" variant="outline" size="sm" onClick={addRow} className="w-full">
                <Plus className="mr-1 size-4" />
                {t("slotSetAddRow")}
              </Button>
            ) : null}

            {/* Bannière de cohérence — statut vivant, associée à « Valider ». */}
            <p
              id="basal-slot-set-coherence"
              role="status"
              aria-live="polite"
              className={
                "rounded-md px-3 py-2 text-sm " +
                (coherenceKind === "ok"
                  ? "bg-feedback-success-bg text-feedback-success"
                  : "bg-destructive/10 text-destructive")
              }
            >
              {coherenceMessage}
            </p>

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
              {/* `aria-disabled` (pas `disabled`) : le bouton reste focusable → le lecteur d'écran
                  annonce la raison du blocage via `aria-describedby` (bannière de cohérence). Le
                  handler `submit` no-op si `!submittable` (garde). */}
              <Button
                type="submit"
                aria-disabled={!submittable}
                aria-describedby="basal-slot-set-coherence"
                className={!submittable ? "cursor-not-allowed bg-muted text-muted-foreground hover:bg-muted" : undefined}
              >
                {pending ? t("slotSetSaving") : mode === "propose" ? t("slotSetProposeSubmit") : t("slotSetSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
