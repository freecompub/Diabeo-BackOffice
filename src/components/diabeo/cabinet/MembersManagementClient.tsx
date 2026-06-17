/**
 * US-2610 (PR4b) — Écran de gestion des membres d'un cabinet.
 *
 * Branché sur `/api/cabinet/[id]/members` (gated Q2 serveur). Permet de lister
 * les membres (capacités Q1 clinique / Q2 gestion), d'inviter un membre, de
 * basculer la capacité de gestion (Q2) et de retirer un membre. AUCUNE donnée
 * de santé ici (gestion = régime distinct). FR/EN/AR + RTL.
 */

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { RefreshCw, UserPlus } from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { extractApiError } from "@/lib/ui/api-error"

type MemberView = {
  userId: number
  firstname: string | null
  lastname: string | null
  email: string | null
  clinicalRole: "DOCTOR" | "NURSE" | null
  canManage: boolean
  isPrincipalAdmin: boolean
}

type AsyncState = "idle" | "loading" | "success" | "error"

export function MembersManagementClient({ cabinetId }: { cabinetId: number }) {
  const t = useTranslations("cabinetMembers")
  const [members, setMembers] = useState<MemberView[]>([])
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<number | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<MemberView | null>(null)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  const fetchMembers = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState("loading")
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/cabinet/${cabinetId}/members`, {
        credentials: "include",
        signal: controller.signal,
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        setState("error")
        setErrorMessage((await extractApiError(res)).message)
        return
      }
      const data = (await res.json()) as { members?: MemberView[] }
      if (!mountedRef.current) return
      setMembers(data.members ?? [])
      setState("success")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (!mountedRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : t("loadError"))
    }
  }, [cabinetId, t])

  useEffect(() => {
    mountedRef.current = true
    void fetchMembers()
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [fetchMembers])

  const toggleManage = useCallback(async (m: MemberView) => {
    setBusyUserId(m.userId)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/cabinet/${cabinetId}/members/${m.userId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ canManage: !m.canManage }),
      })
      if (!res.ok) { setErrorMessage((await extractApiError(res)).message); return }
      await fetchMembers()
    } catch (err) {
      // Erreur réseau (rejet) : surfacer un message plutôt que d'avaler l'échec.
      if (mountedRef.current) setErrorMessage(err instanceof Error ? err.message : t("loadError"))
    } finally {
      if (mountedRef.current) setBusyUserId(null)
    }
  }, [cabinetId, fetchMembers, t])

  const confirmRevoke = useCallback(async () => {
    if (!revokeTarget) return
    const userId = revokeTarget.userId
    setBusyUserId(userId)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/cabinet/${cabinetId}/members/${userId}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })
      if (!res.ok) { setErrorMessage((await extractApiError(res)).message); return }
      setRevokeTarget(null)
      await fetchMembers()
    } catch (err) {
      if (mountedRef.current) setErrorMessage(err instanceof Error ? err.message : t("loadError"))
    } finally {
      if (mountedRef.current) setBusyUserId(null)
    }
  }, [cabinetId, fetchMembers, revokeTarget, t])

  const displayName = (m: MemberView) =>
    [m.firstname, m.lastname].filter(Boolean).join(" ") || m.email || `#${m.userId}`

  return (
    <section className="flex flex-col gap-6" aria-labelledby="members-title" aria-busy={state === "loading"}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="members-title" className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchMembers()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t("refresh")}
          </DiabeoButton>
          <DiabeoButton variant="diabeoPrimary" size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {t("invite")}
          </DiabeoButton>
        </div>
      </header>

      {errorMessage && (
        <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      {state === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>
      )}

      {state === "success" && members.length === 0 && (
        <DiabeoEmptyState variant="noData" title={t("emptyTitle")} message={t("emptyMessage")} />
      )}

      {members.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("title")}</caption>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t("colName")}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t("colClinical")}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t("colManagement")}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="font-medium">{displayName(m)}</span>
                    {m.email && <span className="block text-xs text-muted-foreground">{m.email}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {m.clinicalRole === "DOCTOR" ? t("roleDoctor")
                      : m.clinicalRole === "NURSE" ? t("roleNurse")
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {m.isPrincipalAdmin && <Badge variant="secondary">{t("badgePrincipal")}</Badge>}
                      {m.canManage && !m.isPrincipalAdmin && <Badge variant="outline">{t("badgeManage")}</Badge>}
                      {!m.canManage && <span className="text-muted-foreground">—</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex justify-end gap-2">
                      {!m.isPrincipalAdmin && (
                        <DiabeoButton
                          variant="diabeoTertiary" size="sm"
                          disabled={busyUserId === m.userId}
                          onClick={() => void toggleManage(m)}
                        >
                          {m.canManage ? t("revokeManage") : t("grantManage")}
                        </DiabeoButton>
                      )}
                      <DiabeoButton
                        variant="diabeoDestructive" size="sm"
                        disabled={busyUserId === m.userId}
                        onClick={() => setRevokeTarget(m)}
                      >
                        {t("removeMember")}
                      </DiabeoButton>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InviteDialog
        cabinetId={cabinetId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => void fetchMembers()}
      />

      <Dialog open={revokeTarget !== null} onOpenChange={(o) => { if (!o) setRevokeTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("removeTitle")}</DialogTitle>
            <DialogDescription>
              {t("removeConfirm", { name: revokeTarget ? displayName(revokeTarget) : "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DiabeoButton variant="diabeoTertiary" onClick={() => setRevokeTarget(null)}>
              {t("cancel")}
            </DiabeoButton>
            <DiabeoButton
              variant="diabeoDestructive"
              disabled={busyUserId === revokeTarget?.userId}
              onClick={() => void confirmRevoke()}
            >
              {t("removeSubmit")}
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/* ── Dialogue d'invitation ───────────────────────────────────────── */
function InviteDialog({
  cabinetId, open, onOpenChange, onInvited,
}: {
  cabinetId: number
  open: boolean
  onOpenChange: (o: boolean) => void
  onInvited: () => void
}) {
  const t = useTranslations("cabinetMembers")
  const [email, setEmail] = useState("")
  const [clinicalRole, setClinicalRole] = useState<"DOCTOR" | "NURSE">("DOCTOR")
  const [canManage, setCanManage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const reset = () => { setEmail(""); setClinicalRole("DOCTOR"); setCanManage(false); setError(null) }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/cabinet/${cabinetId}/members`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ email, clinicalRole, canManage }),
      })
      if (!mountedRef.current) return
      if (!res.ok) { setError((await extractApiError(res)).message); return }
      reset()
      onOpenChange(false)
      onInvited()
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : t("loadError"))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("inviteTitle")}</DialogTitle>
          <DialogDescription>{t("inviteDesc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label htmlFor="invite-email" className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("inviteEmail")}</span>
            <input
              id="invite-email" type="email" required aria-required="true"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              autoComplete="off"
            />
          </label>
          <label htmlFor="invite-role" className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("inviteRole")}</span>
            <select
              id="invite-role" value={clinicalRole}
              onChange={(e) => setClinicalRole(e.target.value as "DOCTOR" | "NURSE")}
              className="rounded-md border border-border bg-background px-3 py-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <option value="DOCTOR">{t("roleDoctor")}</option>
              <option value="NURSE">{t("roleNurse")}</option>
            </select>
          </label>
          <label htmlFor="invite-can-manage" className="flex items-center gap-2 text-sm">
            <input
              id="invite-can-manage" type="checkbox"
              checked={canManage} onChange={(e) => setCanManage(e.target.checked)}
              className="focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            />
            <span>{t("inviteCanManage")}</span>
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DiabeoButton variant="diabeoTertiary" onClick={() => { reset(); onOpenChange(false) }}>
            {t("cancel")}
          </DiabeoButton>
          <DiabeoButton variant="diabeoPrimary" disabled={busy || !email} onClick={() => void submit()}>
            {t("inviteSubmit")}
          </DiabeoButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
