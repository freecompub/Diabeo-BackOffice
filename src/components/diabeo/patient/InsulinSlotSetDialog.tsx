"use client"

/**
 * US-2656 — Fenêtre d'édition de GROUPE de créneaux (« tous les créneaux » d'un paramètre ISF/ICR).
 *
 * Montre tout le jeu de créneaux, permet d'éditer valeur + tranche horaire, d'ajouter/supprimer une
 * ligne, et **valide l'ensemble** : « Valider » n'est actif que si la couverture 24 h est cohérente
 * (aucun trou, aucun chevauchement — `describeCoverage`, même source que le serveur US-2655) et toutes
 * les valeurs dans les bornes. L'enregistrement remplace TOUT le jeu (`PUT`, DOCTOR direct) via le
 * transport de mutation injecté (`patientId` ajouté par l'adaptateur, anti-énumération). La cohérence
 * front est un **confort** ; le serveur reste l'autorité (un rejet est réaffiché sans perte de saisie).
 *
 * Masqué (`null`) si aucun transport n'est injecté (fail-closed) ; rendu là où la capability DOCTOR
 * `canEditDirect` l'autorise. Slice 1 : chemin DOCTOR direct (le chemin proposition patient/infirmier +
 * gating maturité relève d'US-2657).
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
import { usePatientRecordContext } from "@/components/diabeo/patient/PatientRecordContext"
import {
  describeCoverage,
  validateRows,
  canSubmit,
  buildReplaceRequest,
  mapSlotSetOutcome,
  type SlotRow,
  type SlotSetParameter,
  type HourRange,
} from "@/components/diabeo/patient/insulin-slot-set-edit"

type InitialSlot = { startHour: number; endHour: number; value: number; mealLabel?: string }
type Feedback = { kind: "error" | "success"; text: string } | null

const fmtHour = (h: number) => `${String(h).padStart(2, "0")}h`
const fmtRanges = (ranges: HourRange[]) => ranges.map((r) => `${fmtHour(r.startHour)}–${fmtHour(r.endHour)}`).join(", ")

export function InsulinSlotSetDialog({
  param,
  paramLabel,
  unit,
  initialSlots,
  bounds,
}: {
  param: SlotSetParameter
  paramLabel: string
  unit: string
  initialSlots: InitialSlot[]
  bounds: { min: number; max: number }
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
  const [rows, setRows] = useState<SlotRow[]>([])
  const [initialSnapshot, setInitialSnapshot] = useState("")
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  // Hooks AVANT tout return conditionnel (règles des hooks).
  const coverage = useMemo(() => describeCoverage(rows), [rows])
  const validation = useMemo(() => validateRows(rows, bounds), [rows, bounds])

  if (!mutate) return null

  const nextKey = () => `slot-${keyCounter.current++}`
  const snapshot = (rs: SlotRow[]) =>
    JSON.stringify(rs.map((r) => [r.startHour, r.endHour, r.value.replace(",", ".")]))

  const toRows = (slots: InitialSlot[]): SlotRow[] =>
    slots.map((s) => ({
      key: nextKey(),
      startHour: s.startHour,
      endHour: s.endHour,
      value: String(s.value),
      mealLabel: s.mealLabel,
    }))

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
  const submittable = canSubmit(rows, bounds, isDirty) && !pending

  const updateRow = (key: string, patch: Partial<SlotRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const addRow = () =>
    setRows((rs) => [...rs, { key: nextKey(), startHour: 0, endHour: 0, value: "" }])
  const deleteRow = (key: string) => {
    setRows((rs) => rs.filter((r) => r.key !== key))
    // Après suppression, ramener le focus sur « Ajouter » (élément stable) — évite de perdre le
    // focus vers le body (WCAG 2.4.3).
    requestAnimationFrame(() => addButtonRef.current?.focus())
  }

  const clampHour = (raw: string): number => {
    const n = Math.trunc(Number(raw))
    return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : 0
  }

  // Message de cohérence (nommé) — pilote l'état de « Valider » et est annoncé (aria-live).
  const coherenceMessage = coverage.hasOverlap
    ? t("slotSetOverlapBanner", { ranges: fmtRanges(coverage.overlaps) })
    : coverage.hasGap
      ? t("slotSetGapBanner", { ranges: fmtRanges(coverage.gaps) })
      : validation.invalidValueKeys.size > 0 || validation.zeroDurationKeys.size > 0
        ? t("slotSetInvalidBanner")
        : t("slotSetCoherentBanner")
  const coherenceKind: "ok" | "warn" = coverage.hasGap || coverage.hasOverlap || validation.invalidValueKeys.size > 0 || validation.zeroDurationKeys.size > 0 ? "warn" : "ok"

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!submittable) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPending(true)
    setFeedback(null)
    try {
      const { endpoint, body } = buildReplaceRequest(param, rows)
      const res = await mutate(endpoint, body, { method: "PUT", signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      const jb: { error?: string } = await res.json().catch(() => ({}))
      const outcome = mapSlotSetOutcome(res.status, jb.error)
      if (outcome.kind === "success") {
        setFeedback({ kind: "success", text: t("slotSetSuccess") })
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
        {t("slotSetEditButton")}
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
              <DialogTitle>{t("slotSetTitle", { param: paramLabel })}</DialogTitle>
              <DialogDescription>{t("slotSetDescription")}</DialogDescription>
            </DialogHeader>

            {/* Frise de couverture 24 h (décorative — la bannière porte le texte). */}
            <div aria-hidden="true" className="flex h-3 overflow-hidden rounded-md border border-border">
              {coverage.cover.map((c, h) => (
                <div
                  key={h}
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
                    <th scope="col" className="p-2">
                      <span className="sr-only">{t("slotSetColActions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, index) => {
                    const conflict = coverage.conflictKeys.has(r.key)
                    const badValue = validation.invalidValueKeys.has(r.key)
                    const rowN = t("slotSetRowN", { n: index + 1 })
                    const conflictId = `slot-conflict-${r.key}`
                    const describedBy = conflict ? conflictId : undefined
                    return (
                      <tr
                        key={r.key}
                        className={conflict ? "border-l-4 border-destructive bg-destructive/10" : "border-l-4 border-transparent"}
                      >
                        <td className="p-2">
                          <input
                            type="number"
                            min={0}
                            max={23}
                            value={r.startHour}
                            onChange={(e) => updateRow(r.key, { startHour: clampHour(e.target.value) })}
                            aria-label={`${t("slotSetColStart")} — ${rowN}`}
                            aria-describedby={describedBy}
                            className="w-16 rounded-md border border-input bg-background px-2 py-1 text-foreground"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={0}
                            max={23}
                            value={r.endHour}
                            onChange={(e) => updateRow(r.key, { endHour: clampHour(e.target.value) })}
                            aria-label={`${t("slotSetColEnd")} — ${rowN}`}
                            aria-describedby={describedBy}
                            className="w-16 rounded-md border border-input bg-background px-2 py-1 text-foreground"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            inputMode="decimal"
                            value={r.value}
                            onChange={(e) => updateRow(r.key, { value: e.target.value })}
                            aria-label={`${t("slotSetColValue", { unit })} — ${rowN}`}
                            aria-invalid={badValue}
                            aria-describedby={describedBy}
                            className={
                              "w-24 rounded-md border bg-background px-2 py-1 text-foreground " +
                              (badValue ? "border-destructive" : "border-input")
                            }
                          />
                        </td>
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
                            aria-label={t("slotSetDeleteRow", { start: fmtHour(r.startHour), end: fmtHour(r.endHour) })}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <Button ref={addButtonRef} type="button" variant="outline" size="sm" onClick={addRow} className="w-full">
              <Plus className="mr-1 size-4" />
              {t("slotSetAddRow")}
            </Button>

            {/* Bannière de cohérence — statut vivant, associée à « Valider ». */}
            <p
              id="slot-set-coherence"
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
                aria-describedby="slot-set-coherence"
                className={!submittable ? "opacity-50" : undefined}
              >
                {pending ? t("slotSetSaving") : t("slotSetSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
