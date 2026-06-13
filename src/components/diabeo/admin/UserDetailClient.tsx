"use client"

/**
 * UserDetailClient — UI ADMIN détail utilisateur + actions PATCH (US-2148).
 *
 * Backend :
 *   - GET `/api/admin/users/[id]` → AdminUserView
 *   - PATCH `/api/admin/users/[id]` { role? } OU { status? } (anti-lockout
 *     Serializable + JWT revocation atomique côté backend PR #409)
 *
 * Actions :
 *   - Changer rôle (ADMIN/DOCTOR/NURSE/VIEWER) — Dialog confirmation
 *   - Changer status (active/suspended/archived) — Dialog confirmation
 *
 * Pattern aligné iter 1-4 round 1 fixes.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  UserCircle2,
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
import { formatDate } from "@/lib/intl/formatters"
import type { Locale } from "@/i18n/config"
import {
  type AdminUserDTOClient,
  type Role,
  type UserStatus,
  ROLE_LABELS_FR,
  ROLES_ORDERED,
  USER_STATUS_LABELS_FR,
  USER_STATUSES_ORDERED,
  getRoleLabel,
  getRoleVariant,
  getUserStatusLabel,
  getUserStatusVariant,
  getUserDisplayName,
} from "@/lib/types/user-admin"
import { extractApiError, type ParsedApiError } from "@/lib/ui/api-error"
import { AdminPhiBanner } from "./AdminPhiBanner"
import { Acronym } from "@/components/diabeo/Acronym"

type AsyncState = "idle" | "loading" | "saving" | "success" | "error"

type PendingAction =
  | { type: "role"; newRole: Role }
  | { type: "status"; newStatus: UserStatus }
  | null

export function UserDetailClient({ userId }: { userId: number }) {
  const locale = useLocale() as Locale
  const t = useTranslations("admin.userDetail")
  const [user, setUser] = useState<AdminUserDTOClient | null>(null)
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionState, setActionState] = useState<AsyncState>("idle")
  const [actionError, setActionError] = useState<ParsedApiError | null>(null)
  const [pending, setPending] = useState<PendingAction>(null)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Fix L1 round 1 — useRef + useEffect pour focus error state (vs inline
  // `ref={(el) => el?.focus()}` qui re-focus à chaque re-render → focus volé).
  const errorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state === "error") errorRef.current?.focus()
  }, [state])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const fetchUser = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    // Fix M7 round 1 review PR #461 — reset conditionnel (vs blank flash après
    // refetch action PATCH). On garde l'UI affichée si user déjà en mémoire,
    // jusqu'au prochain success/error. Pattern via setter functional (stale-safe).
    setUser((prev) => prev) // no-op : on conserve l'ancien snapshot.
    setState("loading")
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        credentials: "include",
        signal: controller.signal,
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        setState("error")
        const parsed = await extractApiError(res)
        setErrorMessage(parsed.message)
        return
      }
      const data = (await res.json()) as { user?: AdminUserDTOClient } | AdminUserDTOClient
      if (!mountedRef.current) return
      // Backend peut renvoyer { user } ou directement le DTO — accept both.
      const u = "user" in data ? data.user : (data as AdminUserDTOClient)
      if (u) setUser(u)
      setState("success")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (!mountedRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [userId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchUser()
  }, [fetchUser])

  const executeAction = useCallback(async () => {
    // Fix L2 round 1 — capture pending dans var locale AVANT reset state
    // (sinon perte du contexte action si erreur affichée plus tard).
    const action = pending
    if (!action) return
    setActionState("saving")
    setActionError(null)
    const body = action.type === "role"
      ? { role: action.newRole }
      : { status: action.newStatus }
    setPending(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          // Fix L6 round 1 (HSA L2) — Idempotency-Key pour dedup audit
          // backend si double-click. Random UUID v4 unique par action.
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        setActionState("error")
        const parsed = await extractApiError(res)
        setActionError(parsed)
        return
      }
      setActionState("success")
      await fetchUser()
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setActionState("idle")
      }, 3000)
    } catch (err) {
      if (!mountedRef.current) return
      setActionState("error")
      setActionError({
        message: err instanceof Error ? err.message : "Erreur réseau",
      })
    }
  }, [userId, pending, fetchUser])

  if (state === "loading" && !user) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        {t("loading")}
      </div>
    )
  }

  if (state === "error" || !user) {
    return (
      <div
        role="alert"
        tabIndex={-1}
        ref={errorRef}
        className="rounded-md border border-destructive/20 bg-destructive/10 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
      >
        <p className="font-medium text-destructive flex items-center gap-2">
          <AlertCircle className="size-4" aria-hidden="true" />
          {t("loadError")}
        </p>
        {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("backToList")}
        </Link>
      </div>
    )
  }

  // Fix H4 round 1 — utilise ROLES_ORDERED + USER_STATUSES_ORDERED (hiérarchique stable).
  const otherRoles: Role[] = ROLES_ORDERED.filter((r) => r !== user.role)
  const otherStatuses: UserStatus[] = USER_STATUSES_ORDERED.filter((s) => s !== user.status)
  // Fix H2 round 1 (HSA) — gate dur sur promotion ADMIN si MFA non activée.
  // HDS ANS référentiel : comptes à privilèges DOIVENT avoir MFA.
  const canPromoteToAdmin = user.mfaEnabled

  return (
    <>
      {/* Fix M4 round 1 (HSA M3) — bandeau PHI rappel utilisation strictement admin. */}
      <AdminPhiBanner />
      <nav aria-label="Fil d'Ariane">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("backToList")}
        </Link>
      </nav>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <UserCircle2 className="size-6" aria-hidden="true" />
          {getUserDisplayName(user)}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={getRoleVariant(user.role)}>{getRoleLabel(user.role)}</Badge>
          <Badge variant={getUserStatusVariant(user.status)}>{getUserStatusLabel(user.status)}</Badge>
          {user.mfaEnabled && (
            <Badge variant="secondary">
              <ShieldCheck className="size-3 mr-0.5" aria-hidden="true" />
              <Acronym code="MFA" /> {t("mfaActivated")}
            </Badge>
          )}
        </div>
      </header>

      {/* Détails */}
      <section className="rounded-md border p-4 space-y-3" aria-labelledby="detail-section">
        <h2 id="detail-section" className="text-lg font-semibold">{t("detailsTitle")}</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Field label="Email">{user.email ?? "—"}</Field>
          <Field label="Prénom">{user.firstname ?? "—"}</Field>
          <Field label="Nom">{user.lastname ?? "—"}</Field>
          <Field label="Langue">{user.language ?? "—"}</Field>
          <Field label="Créé le">{formatDate(user.createdAt, locale, { withTime: true })}</Field>
          {user.statusChangedAt && (
            <Field label="Statut modifié le">{formatDate(user.statusChangedAt, locale, { withTime: true })}</Field>
          )}
          {/* Fix H6 round 1 — null-guard updatedAt cohérent statusChangedAt. */}
          {user.updatedAt && (
            <Field label="Mis à jour le">{formatDate(user.updatedAt, locale, { withTime: true })}</Field>
          )}
        </dl>
      </section>

      {/* Actions */}
      <section className="rounded-md border p-4 space-y-3" aria-labelledby="actions-section">
        <h2 id="actions-section" className="text-lg font-semibold">{t("actionsTitle")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("actionsNote")}
        </p>

        {/* Rôle */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium" id="role-section-heading">{t("changeRole")}</h3>
          {/* Fix H2 round 1 (HSA) — warning visible MFA required ADMIN. */}
          {!canPromoteToAdmin && (
            <p
              id="admin-mfa-warning"
              role="note"
              className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded p-2 flex items-start gap-1"
            >
              <AlertTriangle className="size-3.5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{t("adminMfaWarning")}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="role-section-heading">
            {otherRoles.map((r) => {
              const isAdminPromote = r === "ADMIN"
              const disabled = actionState === "saving" || (isAdminPromote && !canPromoteToAdmin)
              return (
                <DiabeoButton
                  key={r}
                  variant="diabeoTertiary"
                  size="sm"
                  onClick={() => setPending({ type: "role", newRole: r })}
                  disabled={disabled}
                  // Fix M1 + L5 round 1 — libellé explicite + aria-describedby warning.
                  aria-describedby={isAdminPromote && !canPromoteToAdmin ? "admin-mfa-warning" : undefined}
                >
                  {t("setRole", { from: ROLE_LABELS_FR[user.role], to: ROLE_LABELS_FR[r] })}
                </DiabeoButton>
              )
            })}
          </div>
        </div>

        {/* Status */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium" id="status-section-heading">{t("changeStatus")}</h3>
          {/* Fix M1 round 1 — aria-describedby pointe vers warning archivage. */}
          <p id="archive-warning" className="sr-only">
            {t("archiveWarning")}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="status-section-heading">
            {otherStatuses.map((s) => (
              <DiabeoButton
                key={s}
                variant={s === "archived" ? "diabeoDestructive" : "diabeoTertiary"}
                size="sm"
                onClick={() => setPending({ type: "status", newStatus: s })}
                disabled={actionState === "saving"}
                aria-describedby={s === "archived" ? "archive-warning" : undefined}
              >
                {t("setStatus", { from: USER_STATUS_LABELS_FR[user.status], to: USER_STATUS_LABELS_FR[s] })}
              </DiabeoButton>
            ))}
          </div>
        </div>

        {actionState === "error" && actionError && (
          <p role="alert" className="text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            {actionError.message}
          </p>
        )}

        {actionState === "success" && (
          <div role="status" aria-live="polite" className="rounded-md border border-primary/20 bg-primary/5 p-2 text-sm">
            <p className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {t("actionDone")}
            </p>
          </div>
        )}
      </section>

      {/* Dialog confirmation */}
      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.type === "role" && t("confirmRoleTitle", { role: ROLE_LABELS_FR[pending.newRole] })}
              {pending?.type === "status" && t("confirmStatusTitle", { status: USER_STATUS_LABELS_FR[pending.newStatus] })}
            </DialogTitle>
            <DialogDescription>
              {pending?.type === "status" && pending.newStatus === "archived" && (
                // Fix H3 round 1 (A11y HIGH 1) — wrap emoji ⚠ avec aria-label
                // (vs raw emoji que SR rendent inconsistant entre lecteurs).
                <span className="block font-semibold text-destructive">
                  <span aria-label="Attention" role="img" className="mr-1">⚠</span>
                  {t("archiveConfirmWarning")}
                </span>
              )}
              {pending?.type === "role" && pending.newRole === "ADMIN" && (
                <span className="block">
                  <span aria-label="Attention" role="img" className="mr-1">⚠</span>
                  {t("adminPromoteWarning")}
                </span>
              )}
              <span className="block mt-2 text-xs">
                {t("auditNote")}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DiabeoButton variant="diabeoTertiary" onClick={() => setPending(null)}>
              {t("cancel")}
            </DiabeoButton>
            <DiabeoButton
              variant={pending?.type === "status" && pending.newStatus === "archived" ? "diabeoDestructive" : "diabeoPrimary"}
              onClick={() => void executeAction()}
            >
              <CheckCircle2 className="size-4 mr-1" aria-hidden="true" />
              {t("confirm")}
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}
