"use client"

/**
 * AppointmentDetailModal — modal détail RDV (clic sur événement Schedule-X).
 *
 * US-2500-UI iter 5 — sous-modes :
 *   - `view` (défaut) : affiche les détails du RDV (déchiffré côté backend),
 *     plus les boutons d'action selon statut + rôle
 *   - `cancel` : form pour annuler (radio actor + textarea reason)
 *   - `proposeAlt` : form pour proposer une nouvelle date/heure (DOCTOR only)
 *
 * **Architecture lifecycle (Fix FE-2-4 round 2 review PR #433)** :
 *   Le modal reste TOUJOURS monté dans le tree parent ; l'ouverture/fermeture
 *   est contrôlée via `open={openId !== null}` (Base UI Dialog en mode contrôlé).
 *   Le parent applique `key={openedApptId}` SUR LE MODAL pour reset le state
 *   interne (subMode, actionError, drafts) à chaque ouverture d'un RDV distinct.
 *   Avantages :
 *     - L'animation `data-closed:animate-out` de Base UI joue avant unmount
 *       (UX fluide vs ancien pattern mount-on-open qui snappait)
 *     - State interne garanti frais à chaque ouverture (anti-PHI résiduel,
 *       résout CR-1 + FE-12 round 1)
 *     - Pas de `useEffect([openId])` setState-in-effect (FE-5 round 1)
 *
 * **Sécurité** :
 *   - Le payload déchiffré (`motif`, `note`, `cancelReason`) n'existe que
 *     pendant l'ouverture du modal. À la fermeture, le hook `useAppointmentDetail`
 *     reset son state et abort le fetch en cours.
 *   - Audit READ ciblé est tiré côté backend dans `getById`.
 *   - Les actions cancel/propose-alternative déclenchent un audit UPDATE
 *     côté backend dans les services correspondants.
 *
 * **RBAC** :
 *   - `Annuler` : NURSE+ (le backend gate enforce, on cache le bouton sinon)
 *   - `Proposer alternative` : DOCTOR+ uniquement (gate côté backend strict).
 *     Pour NURSE, on cache le bouton (pas de "disabled" trompeur).
 *
 * **Status-gating** :
 *   - `cancelled` / `completed` / `no_show` → pas d'action possible (lecture seule)
 *   - `scheduled` / `pending_validation` / `confirmed` → cancel + proposeAlt
 *     (selon rôle)
 *
 * @see useAppointmentDetail
 * @see src/app/api/appointments/[id]/cancel/route.ts
 * @see src/app/api/appointments/[id]/propose-alternative/route.ts
 */

import { useCallback, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import type {
  AppointmentDetail,
  UseAppointmentDetailResult,
} from "./useAppointmentDetail"
import { useAcceptAlternative } from "./useAcceptAlternative"
import { useConfirmAppointment } from "./useConfirmAppointment"

/**
 * Type union strict pour le rôle (Fix M-5 round 1 review PR #433) — propagé
 * jusqu'aux helpers pour éviter qu'un futur dev passe un string arbitraire.
 */
export type UserRole = "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"

type SubMode = "view" | "cancel" | "proposeAlt" | "move" | "acceptAlt"

export interface AppointmentDetailModalProps {
  /** Résultat du hook `useAppointmentDetail(id)`. */
  state: UseAppointmentDetailResult
  /** id du RDV ouvert (null = modal fermé). */
  openId: number | null
  /** Callback fermeture (modal + parent state). */
  onClose: () => void
  /** Callback succès action (cancel ou proposeAlt) — parent refresh liste. */
  onActionSuccess: () => void
  /** Rôle utilisateur courant (pour gating bouton "Proposer alternative"). */
  userRole: UserRole
}

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  scheduled: "default",
  pending_validation: "outline",
  confirmed: "default",
  cancelled: "destructive",
  completed: "secondary",
  no_show: "destructive",
}

function isActionable(status: string): boolean {
  return status === "scheduled" || status === "pending_validation" || status === "confirmed"
}

function canProposeAlternative(role: UserRole): boolean {
  return role === "ADMIN" || role === "DOCTOR"
}

export function AppointmentDetailModal({
  state,
  openId,
  onClose,
  onActionSuccess,
  userRole,
}: AppointmentDetailModalProps) {
  const t = useTranslations("appointments")

  const [subMode, setSubMode] = useState<SubMode>("view")
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // Fix FE-2-5 round 2 review PR #433 — nonce pour ré-annonce screen reader
  // si l'utilisateur retry et reçoit le même message d'erreur.
  // `key={errorNonce}` force le remount du `<p role="alert">` → NVDA/JAWS
  // re-vocalisent même message identique.
  const [errorNonce, setErrorNonce] = useState(0)

  const { detail, loading, error } = state

  const handleClose = useCallback(() => {
    if (actionLoading) return // garde anti-fermeture pendant action
    onClose()
  }, [actionLoading, onClose])

  // Fix CR-2 L-2-2 round 2 review PR #433 — functional setter pour identity
  // stable (pas de dep `actionError` qui invaliderait useCallback à chaque toggle).
  const clearError = useCallback(() => {
    setActionError((prev) => (prev !== null ? null : prev))
  }, [])

  // Fix M-7/FE-12 round 1 — handlers stables pour back depuis sub-mode.
  const handleBackToView = useCallback(() => {
    if (actionLoading) return
    setSubMode("view")
    setActionError(null)
  }, [actionLoading])

  const submitCancel = useCallback(
    async (actor: "patient" | "doctor", reason: string) => {
      if (!detail || actionLoading) return // Fix H-1 garde guard contre double submit
      setActionLoading(true)
      setActionError(null)
      try {
        const res = await fetch(`/api/appointments/${detail.id}/cancel`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ actor, reason: reason.trim() || undefined }),
        })
        if (!res.ok) {
          if (res.status === 401 && typeof window !== "undefined") {
            window.location.href = "/login?expired=1"
            return
          }
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setActionError(body.error ?? `httpError:${res.status}`)
          setErrorNonce((n) => n + 1)
          return
        }
        onActionSuccess()
        onClose()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "networkError")
        setErrorNonce((n) => n + 1)
      } finally {
        setActionLoading(false)
      }
    },
    [detail, actionLoading, onActionSuccess, onClose],
  )

  const submitProposeAlt = useCallback(
    async (alternativeAtIso: string) => {
      if (!detail || actionLoading) return // Fix H-1
      setActionLoading(true)
      setActionError(null)
      try {
        const res = await fetch(`/api/appointments/${detail.id}/propose-alternative`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ alternativeAt: alternativeAtIso }),
        })
        if (!res.ok) {
          if (res.status === 401 && typeof window !== "undefined") {
            window.location.href = "/login?expired=1"
            return
          }
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setActionError(body.error ?? `httpError:${res.status}`)
          setErrorNonce((n) => n + 1)
          return
        }
        onActionSuccess()
        onClose()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "networkError")
        setErrorNonce((n) => n + 1)
      } finally {
        setActionLoading(false)
      }
    },
    [detail, actionLoading, onActionSuccess, onClose],
  )

  /**
   * Fix CR-1 + HSA-1 + FE-1 round 1 review PR #436 — Consomme `useAcceptAlternative`
   * hook au lieu de cloner la logique POST.
   *
   * Avantages :
   *   - whitelist HSA-3 du hook appliquée (normalize erreur backend → empêche
   *     leak PHI futur via `body.error` brut)
   *   - pattern cohérent iter 7 (`useUpdateAppointment` consommé par calendar)
   *   - test surface unique (le hook a son test suite)
   *   - mountedRef cleanup au unmount via le hook
   *
   * Fix FE-3 round 1 review PR #436 — sub-mode `acceptAlt` avec récap +
   * confirm (WCAG 3.3.4 Error Prevention en santé). Évite le click accidentel
   * "Accepter" pris pour "Détail". Le bouton ViewMode ouvre maintenant le
   * sub-mode `acceptAlt` (vs ancien POST direct one-click).
   */
  const acceptAltHook = useAcceptAlternative()
  // US-2500-UI iter 11 — hook confirm pour RDV pending_validation (US-2505
  // bookingMode=validation). DOCTOR+ valide explicitement.
  const confirmHook = useConfirmAppointment()
  // Fix M1 round 1 review PR #438 — extraire `submit` (stable via useCallback)
  // pour deps array stable. `acceptAltHook` / `confirmHook` objets changent
  // ref chaque render, cassant memoization.
  const acceptAltSubmit = acceptAltHook.submit
  const confirmSubmit = confirmHook.submit

  const submitAcceptAlternative = useCallback(async () => {
    if (!detail || actionLoading) return
    setActionLoading(true)
    setActionError(null)
    const result = await acceptAltSubmit(detail.id)
    if (result.ok) {
      onActionSuccess()
      onClose()
    } else {
      // Code normalisé via whitelist HSA-3 — render via i18n key, jamais brut.
      setActionError(result.code)
      setErrorNonce((n) => n + 1)
    }
    setActionLoading(false)
  }, [detail, actionLoading, acceptAltSubmit, onActionSuccess, onClose])

  /**
   * US-2500-UI iter 11 — Confirme un RDV en `pending_validation` (US-2505
   * bookingMode=validation). DOCTOR+ uniquement (backend gate). Pattern
   * cohérent submitAcceptAlternative : hook consommé (CR-1 round 1 PR #436),
   * whitelist HSA-3, retour structuré.
   */
  const submitConfirm = useCallback(async () => {
    if (!detail || actionLoading) return
    setActionLoading(true)
    setActionError(null)
    const result = await confirmSubmit(detail.id)
    if (result.ok) {
      onActionSuccess()
      onClose()
    } else {
      setActionError(result.code)
      setErrorNonce((n) => n + 1)
    }
    setActionLoading(false)
  }, [detail, actionLoading, confirmSubmit, onActionSuccess, onClose])

  /**
   * Fix FE-2 round 1 review PR #435 — Alternative a11y au drag&drop
   * (WCAG 2.5.7 Dragging Movements + 2.1.1 Keyboard).
   *
   * Le drag&drop n'est pas accessible clavier nativement. WCAG 2.5.7 niveau
   * AA exige un single-pointer alternative. Ce sub-mode "Déplacer" permet
   * à un SR user ou clavier-only de modifier date+heure d'un RDV via PUT
   * `/api/appointments/[id]` (même endpoint que le hook `useUpdateAppointment`
   * utilisé par le drag&drop dans le calendar).
   */
  const submitMove = useCallback(
    async (date: string, hour: string) => {
      if (!detail || actionLoading) return // Fix H-1 garde double submit
      setActionLoading(true)
      setActionError(null)
      try {
        const res = await fetch(`/api/appointments/${detail.id}`, {
          method: "PUT",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ date, hour }),
        })
        if (!res.ok) {
          if (res.status === 401 && typeof window !== "undefined") {
            window.location.href = "/login?expired=1"
            return
          }
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setActionError(body.error ?? `httpError:${res.status}`)
          setErrorNonce((n) => n + 1)
          return
        }
        onActionSuccess()
        onClose()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "networkError")
        setErrorNonce((n) => n + 1)
      } finally {
        setActionLoading(false)
      }
    },
    [detail, actionLoading, onActionSuccess, onClose],
  )

  return (
    <Dialog
      open={openId !== null}
      // Fix H-3 + FE-3 round 1 review PR #433 — Base UI Dialog en mode
      // **contrôlé** (`open=openId !== null`) : si on n'appelle pas `handleClose`
      // (qui contient le garde `actionLoading`), l'état contrôlé reste à `open`
      // et Base UI respecte ce contrat → pas de flash close ni focus perdu
      // pour Escape/clic backdrop.
      onOpenChange={(o) => { if (!o) handleClose() }}
    >
      <DialogContent className="sm:max-w-lg">
        {loading && !detail && (
          <div
            role="status"
            aria-busy="true"
            aria-live="polite"
            className="py-8 text-center text-sm text-muted-foreground"
          >
            {t("loading")}
          </div>
        )}

        {error && !detail && (
          <div role="alert" aria-live="assertive" className="py-8 text-center text-sm text-red-600">
            {t("detailLoadError")}
          </div>
        )}

        {detail && subMode === "view" && (
          <ViewMode
            detail={detail}
            userRole={userRole}
            onCancel={() => setSubMode("cancel")}
            onPropose={() => setSubMode("proposeAlt")}
            onMove={() => setSubMode("move")}
            // Fix FE-3 round 1 review PR #436 — onAccept ouvre le sub-mode
            // `acceptAlt` (récap + confirm) vs ancien POST one-click.
            onAccept={() => setSubMode("acceptAlt")}
            // US-2500-UI iter 11 — confirm bookingMode validation manuelle.
            // Pas de sub-mode dédié : action one-click claire ("Confirmer"
            // le RDV → status scheduled). Si futur dev veut un récap, suivre
            // pattern acceptAlt (sub-mode confirm récap).
            onConfirm={submitConfirm}
          />
        )}

        {detail && subMode === "cancel" && (
          <CancelForm
            loading={actionLoading}
            error={actionError}
            errorNonce={errorNonce}
            onSubmit={submitCancel}
            onBack={handleBackToView}
            onChangeClearsError={clearError}
            // Fix C3 round 1 review PR #438 — default actor dérivé du userRole.
            // Si VIEWER (patient self-service jamais utilisé ici aujourd'hui mais
            // defense-in-depth), default "patient" pour audit attribution correct.
            defaultActor={userRole === "VIEWER" ? "patient" : "doctor"}
          />
        )}

        {detail && subMode === "proposeAlt" && (
          <ProposeAlternativeForm
            detail={detail}
            loading={actionLoading}
            error={actionError}
            errorNonce={errorNonce}
            onSubmit={submitProposeAlt}
            onBack={handleBackToView}
            onChangeClearsError={clearError}
          />
        )}

        {detail && subMode === "move" && (
          <MoveForm
            detail={detail}
            loading={actionLoading}
            error={actionError}
            errorNonce={errorNonce}
            onSubmit={submitMove}
            onBack={handleBackToView}
            onChangeClearsError={clearError}
          />
        )}

        {/* Fix FE-3 round 1 review PR #436 — sub-mode acceptAlt avec récap
            visuel + confirm explicite. WCAG 3.3.4 Error Prevention en santé :
            l'infirmière voit la nouvelle date/heure cible avant POST. */}
        {detail && subMode === "acceptAlt" && (
          <AcceptAlternativeForm
            detail={detail}
            loading={actionLoading}
            error={actionError}
            errorNonce={errorNonce}
            onConfirm={submitAcceptAlternative}
            onBack={handleBackToView}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ─── Sous-composants ──────────────────────────────────────────── */

interface ViewModeProps {
  detail: AppointmentDetail
  userRole: UserRole
  onCancel: () => void
  onPropose: () => void
  /** Fix FE-2 round 1 review PR #435 — alternative a11y drag&drop (WCAG 2.5.7) */
  onMove: () => void
  /** US-2500-UI iter 9 — Accept l'alternative proposée (NURSE+). */
  onAccept: () => void
  /** US-2500-UI iter 11 — Confirm RDV pending_validation (DOCTOR+, US-2505). */
  onConfirm: () => void
}


/**
 * Fix M-4 + FE-4 round 1 + HSA-2-7 round 2 review PR #433 — Cache module-level
 * `Intl.DateTimeFormat` borné à 8 entrées (LRU naïf via `Map` qui réordonne).
 *
 * Aujourd'hui 3 locales (fr/en/ar) → 6 entrées max. Cap à 8 prévient le DoS
 * mémoire théorique si un futur dev passe des locales enrichies dynamiquement
 * (e.g. `fr-FR-x-vendor`, `en-US-u-ca-buddhist`, locale automatique IA).
 *
 * Note `"use client"` : ces Maps sont SAFE en SSR car le composant est
 * client-only. Si la directive disparaît un jour, voir HSA-2-10 (factoriser
 * en middleware ou helper isolated).
 */
const MAX_FORMATTER_CACHE = 8
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()
const timestampFormatterCache = new Map<string, Intl.DateTimeFormat>()

function getCachedFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const existing = cache.get(locale)
  if (existing) return existing
  if (cache.size >= MAX_FORMATTER_CACHE) {
    // LRU naïf : retire la 1re entrée (Map garde insertion order).
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) cache.delete(firstKey)
  }
  const f = new Intl.DateTimeFormat(locale, options)
  cache.set(locale, f)
  return f
}

function getDateFormatter(locale: string): Intl.DateTimeFormat {
  return getCachedFormatter(dateFormatterCache, locale, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC", // wall-clock — pas de conversion
  })
}

/**
 * Fix L-2 round 1 + HSA-2-3 round 2 review PR #433 — Formatter timestamp
 * **avec `timeZone: "UTC"`** pour cohérence avec le contrat wall-clock du
 * proposeAlternative (l'utilisateur saisit 14:00, on stocke 14:00Z, on
 * réaffiche 14:00 → pas de conversion fuseau qui décale visuellement).
 *
 * Conséquence : `proposedAlternativeAt` (Timestamp UTC) sera affiché à
 * l'heure UTC = heure wall-clock saisie. Cohérent tant que les utilisateurs
 * restent dans le fuseau du cabinet (V1 = pilote mono-fuseau Europe/Paris).
 *
 * V1.5 follow-up : intégrer `HealthcareService.timezone` quand ajouté au
 * schema (cf. issue tracker HSA-6).
 */
function getTimestampFormatter(locale: string): Intl.DateTimeFormat {
  return getCachedFormatter(timestampFormatterCache, locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })
}

/**
 * Formatte `date` (yyyy-mm-dd) + `hour` (hh:mm:ss | null) en wall-clock
 * lisible. Aucune conversion timezone (cf. adapter.ts §contrat timezone).
 */
function formatDateTime(date: string, hour: string | null, locale: string): string {
  const datePart = date.includes("T") ? date.split("T")[0] : date
  const [y, m, d] = datePart.split("-").map(Number)
  const dateLabel = getDateFormatter(locale).format(new Date(Date.UTC(y, m - 1, d)))
  if (!hour) return dateLabel
  const hourPart = hour.includes("T") ? hour.split("T")[1].slice(0, 5) : hour.slice(0, 5)
  return `${dateLabel} - ${hourPart}`
}

function ViewMode({ detail, userRole, onCancel, onPropose, onMove, onAccept, onConfirm }: ViewModeProps) {
  const t = useTranslations("appointments")
  // Fix FE-2-1 round 2 review PR #433 — `useLocale()` directement dans le
  // sous-composant (vs prop drilling depuis le parent). Pattern idiomatique
  // next-intl (le hook est gratuit, lecture context). Cohérent avec usage
  // de `useTranslations` qui est aussi appelé localement.
  const locale = useLocale()

  const actionable = isActionable(detail.status)
  const showPropose = actionable && canProposeAlternative(userRole)

  // US-2500-UI iter 11 — Bouton "Confirmer" visible si :
  //   - status === "pending_validation" (US-2505 bookingMode=validation)
  //   - userRole DOCTOR+ (backend gate, NURSE refuse 403)
  // Pattern cohérent canAcceptAlternative iter 9.
  const canConfirm =
    (userRole === "ADMIN" || userRole === "DOCTOR")
    && detail.status === "pending_validation"

  // US-2500-UI iter 9 — Bouton "Accepter alternative" visible si :
  //   - RDV en status `cancelled` (= original cancel pour proposer alt)
  //   - `proposedAlternativeAt` set (≠ null)
  //   - userRole NURSE+ (Fix HSA-2 round 1 review PR #436 — RBAC defense-in-depth
  //     cohérent pattern iter 5 `canProposeAlternative`. Backend gate via
  //     `appointmentRouteGate("NURSE")` mais UI doit refléter le RBAC pour
  //     éviter audit accessDenied US-2265 spam + signal d'intention exfiltrable
  //     à un VIEWER qui verrait le bouton sans pouvoir l'utiliser).
  //
  // Note : pas de check TTL 7j côté UI (React-Compiler refuse Date.now()
  // au render). Backend valide via `alternativeExpired` (422) au POST →
  // si TTL dépassé, user clique puis voit l'erreur dans le modal. UX
  // dégradée acceptable car cas rare (TTL = 7j).
  const canAcceptAlternative =
    userRole !== "VIEWER"
    && detail.status === "cancelled"
    && detail.proposedAlternativeAt !== null

  // Fix FE-2-3 round 2 — pas de `useMemo` redondant : `getTimestampFormatter`
  // utilise déjà la `Map` module-level → identité stable, lookup O(1).
  const tsFormatter = getTimestampFormatter(locale)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          {t(`type.${detail.type ?? "other"}`)}
          <Badge variant={STATUS_BADGE_VARIANT[detail.status] ?? "outline"}>
            {t(`status.${detail.status}`)}
          </Badge>
        </DialogTitle>
        <DialogDescription>
          {formatDateTime(detail.date, detail.hour, locale)}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 py-2 text-sm">
        <Field label={t("durationLabel")}>
          {detail.durationMinutes ?? 30} {t("minutesShort")}
        </Field>

        {detail.location && (
          <Field label={t("locationLabel")}>
            {t(`location.${detail.location}`)}
          </Field>
        )}

        {detail.motif && (
          <Field label={t("motifLabel")}>
            <span className="whitespace-pre-line">{detail.motif}</span>
          </Field>
        )}

        {detail.note && (
          <Field label={t("noteLabel")}>
            <span className="whitespace-pre-line">{detail.note}</span>
          </Field>
        )}

        {detail.status === "cancelled" && (
          <>
            <Field label={t("cancelledAtLabel")}>
              {detail.cancelledAt ? tsFormatter.format(new Date(detail.cancelledAt)) : "—"}
            </Field>
            {detail.cancelledBy && (
              <Field label={t("cancelledByLabel")}>
                {t(`cancelledBy.${detail.cancelledBy}`)}
              </Field>
            )}
            {detail.cancelReason && (
              <Field label={t("cancelReasonLabel")}>
                <span className="whitespace-pre-line">{detail.cancelReason}</span>
              </Field>
            )}
          </>
        )}

        {detail.proposedAlternativeAt && (
          <Field label={t("proposedAlternativeAtLabel")}>
            {tsFormatter.format(new Date(detail.proposedAlternativeAt))}
          </Field>
        )}

        <Field label={t("patientLabel")}>
          {/* Fix HSA-2 round 1 + HSA-2-4 round 2 review PR #433 — `rel="noopener
              noreferrer"` defense-in-depth contre :
              - leak Referer de l'URL d'origine `/appointments?memberId=X`
              - reverse tabnabbing si un futur dev ajoute `target="_blank"`
                (Safari < 14 / Firefox ESR healthcare ne posent pas `noopener`
                par défaut malgré la spec moderne). */}
          <a
            href={`/patients/${detail.patientId}`}
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            {t("patientViewLink", { id: detail.patientId })}
          </a>
        </Field>
      </div>

      {/* #476 §9 — `flex-wrap` : jusqu'à 4 CTAs (Annuler/Déplacer/Proposer +
          Confirmer ou Accepter) ne débordent plus du `DialogContent` (sm:max-w-lg)
          et passent sur 2 lignes au besoin. Le bouton "Fermer" redondant a été
          retiré : le `X` du header (DialogContent showCloseButton) ferme déjà
          (via onOpenChange → handleClose). Footer non rendu si aucune action
          (statuts terminaux) → pas de barre vide. */}
      {(actionable || showPropose || canAcceptAlternative || canConfirm) && (
        <DialogFooter className="flex-wrap">
          {actionable && (
            <Button variant="outline" onClick={onCancel}>
              {t("actionCancel")}
            </Button>
          )}
          {/* Fix FE-2 round 1 review PR #435 — alternative a11y au drag&drop
              (WCAG 2.5.7 Dragging Movements + 2.1.1 Keyboard). NURSE+ peut
              déplacer un RDV éditable via clavier sans toucher au drag&drop. */}
          {actionable && (
            <Button variant="outline" onClick={onMove}>
              {t("actionMove")}
            </Button>
          )}
          {showPropose && (
            <Button variant="outline" onClick={onPropose}>
              {t("actionProposeAlternative")}
            </Button>
          )}
          {/* US-2500-UI iter 9 — Bouton "Accepter alternative" si RDV est en
              attente d'acceptation (status=cancelled + proposedAlternativeAt
              set + TTL 7j non dépassé côté backend qui re-valide). */}
          {canAcceptAlternative && (
            <Button
              variant="default"
              onClick={onAccept}
              // Fix A11y M12 round 1 review PR #438 — aria-label discriminant
              // (modal a plusieurs CTAs ; "Accepter alternative pour RDV #N").
              aria-label={t("actionAcceptAlternativeAria", { id: detail.id })}
            >
              {t("actionAcceptAlternative")}
            </Button>
          )}
          {/* US-2500-UI iter 11 — Bouton "Confirmer" si RDV en pending_validation
              (US-2505 bookingMode=validation manuelle). DOCTOR+ gate via canConfirm.
              Variant=default (primary teal) — action engageante. */}
          {canConfirm && (
            <Button
              variant="default"
              onClick={onConfirm}
              // Fix A11y M12 round 1 review PR #438 — aria-label discriminant.
              aria-label={t("actionConfirmPendingAria", { id: detail.id })}
            >
              {t("actionConfirmPending")}
            </Button>
          )}
        </DialogFooter>
      )}
    </>
  )
}

interface CancelFormProps {
  loading: boolean
  error: string | null
  errorNonce: number
  onSubmit: (actor: "patient" | "doctor", reason: string) => void
  onBack: () => void
  onChangeClearsError: () => void
  /** Fix C3 round 1 review PR #438 — default dérivé du userRole. */
  defaultActor: "patient" | "doctor"
}

/**
 * Fix L-1 round 1 review PR #433 — Default `actor="doctor"` car la majorité
 * des annulations en cabinet sont initiées par le pro (secrétariat enregistre
 * l'annulation lors du créneau perdu, pas le patient qui appelle).
 *
 * Fix C3 round 1 review PR #438 — `defaultActor` prop pour dériver du
 * userRole (VIEWER → patient, sinon doctor). Defense-in-depth si la modal
 * est un jour montée côté patient self-service.
 */
function CancelForm({
  loading,
  error,
  errorNonce,
  onSubmit,
  onBack,
  onChangeClearsError,
  defaultActor,
}: CancelFormProps) {
  const t = useTranslations("appointments")
  const [actor, setActor] = useState<"patient" | "doctor">(defaultActor)
  const [reason, setReason] = useState("")

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("cancelTitle")}</DialogTitle>
        <DialogDescription>{t("cancelDescription")}</DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(actor, reason)
        }}
        className="grid gap-4 py-2"
      >
        <fieldset className="grid gap-2" disabled={loading}>
          <legend className="text-sm font-medium">{t("actorLegend")}</legend>
          {/* Fix L-5 + FE-15 round 1 + FE-2-7 round 2 review PR #433 — touch target
              ≥ 44px (WCAG 2.5.5) sur label englobant + `cursor-pointer` pour signal
              visuel zone cliquable. */}
          <label className="flex items-center gap-2 text-sm min-h-[44px] cursor-pointer">
            <input
              type="radio"
              name="actor"
              value="doctor"
              checked={actor === "doctor"}
              onChange={() => { setActor("doctor"); onChangeClearsError() }}
            />
            {t("actorDoctor")}
          </label>
          <label className="flex items-center gap-2 text-sm min-h-[44px] cursor-pointer">
            <input
              type="radio"
              name="actor"
              value="patient"
              checked={actor === "patient"}
              onChange={() => { setActor("patient"); onChangeClearsError() }}
            />
            {t("actorPatient")}
          </label>
        </fieldset>

        <div className="grid gap-2">
          <Label htmlFor="cancel-reason">{t("cancelReasonLabel")}</Label>
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => { setReason(e.target.value); onChangeClearsError() }}
            maxLength={500}
            rows={3}
            disabled={loading}
            className="border border-input rounded-md p-2 text-sm bg-background resize-none disabled:opacity-50"
            placeholder={t("cancelReasonPlaceholder")}
            aria-describedby="cancel-reason-help"
          />
          <p id="cancel-reason-help" className="text-xs text-muted-foreground">
            {reason.length} / 500
          </p>
        </div>

        {error && (
          // Fix FE-9 round 1 + FE-2-5 round 2 review PR #433 —
          // `key={`${error}-${errorNonce}`}` force re-mount du `<p>` même si
          // le message d'erreur est identique sur retry (NVDA/JAWS re-vocalisent).
          // `role="alert"` + `aria-live="assertive"` redondants intentionnels
          // pour couvrir bugs historiques screen readers.
          // HSA-3 : on render UNIQUEMENT la clé i18n `actionError` générique,
          // jamais `error` brut (defense-in-depth contre PHI/PII backend).
          <p
            key={`${error}-${errorNonce}`}
            role="alert"
            aria-live="assertive"
            className="text-sm text-red-600"
          >
            {t("actionError")}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onBack} disabled={loading}>
            {t("actionBack")}
          </Button>
          <Button type="submit" variant="destructive" disabled={loading}>
            {loading ? t("loading") : t("actionConfirmCancel")}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

interface ProposeAltFormProps {
  detail: AppointmentDetail
  loading: boolean
  error: string | null
  errorNonce: number
  onSubmit: (alternativeAtIso: string) => void
  onBack: () => void
  onChangeClearsError: () => void
}

function ProposeAlternativeForm({
  detail,
  loading,
  error,
  errorNonce,
  onSubmit,
  onBack,
  onChangeClearsError,
}: ProposeAltFormProps) {
  const t = useTranslations("appointments")
  // Pré-remplir avec la date+heure actuelle du RDV (l'utilisateur ajuste).
  const initialDate = detail.date.split("T")[0]
  const initialTime = detail.hour ? detail.hour.slice(0, 5) : "09:00"
  const [dateStr, setDateStr] = useState(initialDate)
  const [timeStr, setTimeStr] = useState(initialTime)

  // Fix H-4 round 1 review PR #433 — Borne min snapshot lazy au mount (vs
  // recomputed à chaque render). Sans ça, un re-render à minuit (polling
  // parent 60s) changerait `min` et invaliderait silencieusement la valeur
  // saisie. `useState(() => ...)` exécute la lambda une seule fois.
  const [today] = useState(() => new Date().toISOString().split("T")[0])

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("proposeAltTitle")}</DialogTitle>
        <DialogDescription>{t("proposeAltDescription")}</DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          /**
           * Fix HSA-2-3 round 2 review PR #433 — Contrat wall-clock explicite :
           * on suffixe `Z` pour que le backend `z.coerce.date()` interprète
           * **toujours en UTC** (déterministe, pas d'ambiguïté serveur-side
           * `new Date()` qui dépend de la TZ du process Node).
           *
           * Combiné avec `timeZone: "UTC"` dans le formatter d'affichage
           * (`getTimestampFormatter`), on a un contrat wall-clock cohérent :
           *   - saisie médecin "14:00" → envoi "2026-05-25T14:00:00Z"
           *   - stockage backend Timestamp = 2026-05-25T14:00:00Z
           *   - réaffichage frontend (UTC) → "14:00"
           *
           * Pas de décalage CEST. Cohérent tant que tous les utilisateurs
           * (médecin saisie, patient mobile, secrétariat) interprètent
           * l'heure stockée comme wall-clock du cabinet.
           *
           * V1.5 follow-up : `HealthcareService.timezone` au schema +
           * conversion vraie cabinet-local (cf. issue tracker HSA-6).
           */
          const iso = `${dateStr}T${timeStr}:00Z`
          onSubmit(iso)
        }}
        className="grid gap-4 py-2"
      >
        <div className="grid gap-2">
          <Label htmlFor="propose-date">{t("dateLabel")}</Label>
          <input
            type="date"
            id="propose-date"
            value={dateStr}
            min={today}
            onChange={(e) => { setDateStr(e.target.value); onChangeClearsError() }}
            required
            disabled={loading}
            className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="propose-time">{t("hourLabel")}</Label>
          <input
            type="time"
            id="propose-time"
            value={timeStr}
            onChange={(e) => { setTimeStr(e.target.value); onChangeClearsError() }}
            required
            disabled={loading}
            className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
          />
        </div>

        {error && (
          <p
            key={`${error}-${errorNonce}`}
            role="alert"
            aria-live="assertive"
            className="text-sm text-red-600"
          >
            {t("actionError")}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onBack} disabled={loading}>
            {t("actionBack")}
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? t("loading") : t("actionConfirmPropose")}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

interface FieldProps {
  label: string
  children: React.ReactNode
}

function Field({ label, children }: FieldProps) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

/* ─── MoveForm (Fix FE-2 round 1 PR #435 — a11y alternative drag&drop) ─── */

interface MoveFormProps {
  detail: AppointmentDetail
  loading: boolean
  error: string | null
  errorNonce: number
  onSubmit: (date: string, hour: string) => void
  onBack: () => void
  onChangeClearsError: () => void
}

/**
 * MoveForm — WCAG 2.5.7 Dragging Movements alternative.
 *
 * Form date+heure pour reschedule un RDV via PUT /api/appointments/[id].
 * Pattern UI cloné de `ProposeAlternativeForm` (clavier-accessible) mais
 * sémantique différente : MOVE = reschedule immédiat (vs PROPOSE = demande
 * que le patient doit accepter).
 *
 * **Sécurité** : pas de suffixe `Z` ici (vs proposeAlt) car le backend PUT
 * accepte `{date: "yyyy-mm-dd", hour: "HH:MM"}` séparé (cf. route.ts:18-19) —
 * pas d'ambiguïté timezone, wall-clock direct.
 */
function MoveForm({
  detail,
  loading,
  error,
  errorNonce,
  onSubmit,
  onBack,
  onChangeClearsError,
}: MoveFormProps) {
  const t = useTranslations("appointments")
  const initialDate = detail.date.split("T")[0]
  const initialTime = detail.hour ? detail.hour.slice(0, 5) : "09:00"
  const [dateStr, setDateStr] = useState(initialDate)
  const [timeStr, setTimeStr] = useState(initialTime)
  // Fix H-4 pattern iter 5/6 — borne min snapshot lazy au mount.
  const [today] = useState(() => new Date().toISOString().split("T")[0])

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("moveTitle")}</DialogTitle>
        <DialogDescription>{t("moveDescription")}</DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(dateStr, timeStr)
        }}
        className="grid gap-4 py-2"
      >
        <div className="grid gap-2">
          <Label htmlFor="move-date">{t("dateLabel")}</Label>
          <input
            type="date"
            id="move-date"
            value={dateStr}
            min={today}
            onChange={(e) => { setDateStr(e.target.value); onChangeClearsError() }}
            required
            aria-required="true"
            disabled={loading}
            className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="move-time">{t("hourLabel")}</Label>
          <input
            type="time"
            id="move-time"
            value={timeStr}
            onChange={(e) => { setTimeStr(e.target.value); onChangeClearsError() }}
            required
            aria-required="true"
            disabled={loading}
            className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
          />
        </div>

        {error && (
          <p
            key={`${error}-${errorNonce}`}
            role="alert"
            className="text-sm text-red-600"
          >
            {t("actionError")}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onBack} disabled={loading}>
            {t("actionBack")}
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? t("loading") : t("actionConfirmMove")}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

/* ─── AcceptAlternativeForm (Fix FE-3 round 1 PR #436 — WCAG 3.3.4 confirm) ─── */

interface AcceptAlternativeFormProps {
  detail: AppointmentDetail
  loading: boolean
  error: string | null
  errorNonce: number
  onConfirm: () => void
  onBack: () => void
}

/**
 * AcceptAlternativeForm — récap visuel + confirm explicite (WCAG 3.3.4
 * Error Prevention en santé).
 *
 * Affiche la nouvelle date+heure cible AVANT le POST pour que l'utilisateur
 * confirme visuellement avant action. Évite le click accidentel pris pour
 * "Voir détail". Cohérent pattern sub-mode iter 5/6/7 (`cancel`, `move`).
 *
 * Note : pas de form fields (juste 2 boutons Back/Confirm) — l'action est
 * one-click mais via 2 paliers (View → AcceptAlt → POST). Le récap utilise
 * le formatter timestamp wall-clock cohérent ProposeAlt (timeZone UTC).
 */
function AcceptAlternativeForm({
  detail,
  loading,
  error,
  errorNonce,
  onConfirm,
  onBack,
}: AcceptAlternativeFormProps) {
  const t = useTranslations("appointments")
  const locale = useLocale()
  const tsFormatter = getTimestampFormatter(locale)

  // `proposedAlternativeAt` est garanti non-null (gate ViewMode `canAcceptAlternative`).
  const alternativeLabel = detail.proposedAlternativeAt
    ? tsFormatter.format(new Date(detail.proposedAlternativeAt))
    : "—"

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("acceptAltTitle")}</DialogTitle>
        <DialogDescription>{t("acceptAltDescription")}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 py-4">
        <div className="rounded-md border border-emerald-500/40 bg-emerald-50 p-4 text-sm">
          <p className="text-xs font-medium text-emerald-900/70 uppercase tracking-wide mb-1">
            {t("acceptAltNewSlot")}
          </p>
          <p className="text-lg font-medium text-emerald-900">{alternativeLabel}</p>
        </div>
        <p className="text-xs text-muted-foreground">{t("acceptAltConfirmHint")}</p>
      </div>

      {error && (
        <p
          key={`${error}-${errorNonce}`}
          role="alert"
          className="text-sm text-red-600"
        >
          {t("actionError")}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onBack} disabled={loading}>
          {t("actionBack")}
        </Button>
        <Button type="button" variant="default" onClick={onConfirm} disabled={loading}>
          {loading ? t("loading") : t("actionConfirmAcceptAlt")}
        </Button>
      </DialogFooter>
    </>
  )
}
