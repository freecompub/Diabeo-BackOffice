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
import { useLocale } from "next-intl"
import {
  AlertCircle,
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
  USER_STATUS_LABELS_FR,
  getRoleLabel,
  getRoleVariant,
  getUserStatusLabel,
  getUserStatusVariant,
  getUserDisplayName,
} from "@/lib/types/user-admin"
import { extractApiError, type ParsedApiError } from "@/lib/ui/api-error"

type AsyncState = "idle" | "loading" | "saving" | "success" | "error"

type PendingAction =
  | { type: "role"; newRole: Role }
  | { type: "status"; newStatus: UserStatus }
  | null

export function UserDetailClient({ userId }: { userId: number }) {
  const locale = useLocale() as Locale
  const [user, setUser] = useState<AdminUserDTOClient | null>(null)
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionState, setActionState] = useState<AsyncState>("idle")
  const [actionError, setActionError] = useState<ParsedApiError | null>(null)
  const [pending, setPending] = useState<PendingAction>(null)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    setUser(null)
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
    if (!pending) return
    setActionState("saving")
    setActionError(null)
    const body = pending.type === "role"
      ? { role: pending.newRole }
      : { status: pending.newStatus }
    setPending(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
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
        Chargement…
      </div>
    )
  }

  if (state === "error" || !user) {
    return (
      <div
        role="alert"
        tabIndex={-1}
        ref={(el) => { el?.focus() }}
        className="rounded-md border border-destructive/20 bg-destructive/10 p-3"
      >
        <p className="font-medium text-destructive flex items-center gap-2">
          <AlertCircle className="size-4" aria-hidden="true" />
          Erreur de chargement
        </p>
        {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Retour à la liste
        </Link>
      </div>
    )
  }

  const otherRoles: Role[] = (["ADMIN", "DOCTOR", "NURSE", "VIEWER"] as Role[]).filter((r) => r !== user.role)
  const otherStatuses: UserStatus[] = (["active", "suspended", "archived"] as UserStatus[]).filter((s) => s !== user.status)

  return (
    <>
      <nav aria-label="Fil d'Ariane">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Retour à la liste
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
              MFA activé
            </Badge>
          )}
        </div>
      </header>

      {/* Détails */}
      <section className="rounded-md border p-4 space-y-3" aria-labelledby="detail-section">
        <h2 id="detail-section" className="text-lg font-semibold">Détails</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Field label="Email">{user.email ?? "—"}</Field>
          <Field label="Prénom">{user.firstname ?? "—"}</Field>
          <Field label="Nom">{user.lastname ?? "—"}</Field>
          <Field label="Langue">{user.language ?? "—"}</Field>
          <Field label="Créé le">{formatDate(user.createdAt, locale, { withTime: true })}</Field>
          {user.statusChangedAt && (
            <Field label="Statut modifié le">{formatDate(user.statusChangedAt, locale, { withTime: true })}</Field>
          )}
          <Field label="Mis à jour le">{formatDate(user.updatedAt, locale, { withTime: true })}</Field>
        </dl>
      </section>

      {/* Actions */}
      <section className="rounded-md border p-4 space-y-3" aria-labelledby="actions-section">
        <h2 id="actions-section" className="text-lg font-semibold">Actions</h2>
        <p className="text-xs text-muted-foreground">
          Modification du rôle ou du statut tracée dans l&apos;audit log immuable.
          Anti-lockout : impossible de retirer le dernier ADMIN (backend Serializable).
        </p>

        {/* Rôle */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Changer le rôle</h3>
          <div className="flex flex-wrap gap-2">
            {otherRoles.map((r) => (
              <DiabeoButton
                key={r}
                variant="diabeoTertiary"
                size="sm"
                onClick={() => setPending({ type: "role", newRole: r })}
                disabled={actionState === "saving"}
              >
                Promouvoir / Rétrograder en {ROLE_LABELS_FR[r]}
              </DiabeoButton>
            ))}
          </div>
        </div>

        {/* Status */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Changer le statut</h3>
          <div className="flex flex-wrap gap-2">
            {otherStatuses.map((s) => (
              <DiabeoButton
                key={s}
                variant={s === "archived" ? "diabeoDestructive" : "diabeoTertiary"}
                size="sm"
                onClick={() => setPending({ type: "status", newStatus: s })}
                disabled={actionState === "saving"}
              >
                {USER_STATUS_LABELS_FR[s]}
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
              Action effectuée.
            </p>
          </div>
        )}
      </section>

      {/* Dialog confirmation */}
      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.type === "role" && `Changer le rôle vers ${ROLE_LABELS_FR[pending.newRole]} ?`}
              {pending?.type === "status" && `Changer le statut vers ${USER_STATUS_LABELS_FR[pending.newStatus]} ?`}
            </DialogTitle>
            <DialogDescription>
              {pending?.type === "status" && pending.newStatus === "archived" && (
                <span className="block font-semibold text-destructive">
                  ⚠ L&apos;archivage révoque tous les tokens JWT — l&apos;utilisateur sera déconnecté immédiatement.
                </span>
              )}
              {pending?.type === "role" && pending.newRole === "ADMIN" && (
                <span className="block">
                  ⚠ Promotion vers ADMIN = accès complet plateforme.
                </span>
              )}
              <span className="block mt-2 text-xs">
                Action tracée dans l&apos;audit log immuable.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DiabeoButton variant="diabeoTertiary" onClick={() => setPending(null)}>
              Annuler
            </DiabeoButton>
            <DiabeoButton
              variant={pending?.type === "status" && pending.newStatus === "archived" ? "diabeoDestructive" : "diabeoPrimary"}
              onClick={() => void executeAction()}
            >
              <CheckCircle2 className="size-4 mr-1" aria-hidden="true" />
              Confirmer
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
