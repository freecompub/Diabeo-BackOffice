"use client"

/**
 * UsersListClient — UI ADMIN list users (US-2148).
 *
 * Backend : `GET /api/admin/users` (paginé cursor). Pattern aligné iter 1-4.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useLocale } from "next-intl"
import {
  AlertCircle,
  ChevronRight,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCircle2,
} from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
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
import { extractApiError } from "@/lib/ui/api-error"

type AsyncState = "idle" | "loading" | "success" | "error"

export function UsersListClient() {
  const locale = useLocale() as Locale
  const [users, setUsers] = useState<AdminUserDTOClient[]>([])
  const [state, setState] = useState<AsyncState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [filterRole, setFilterRole] = useState<Role | "all">("all")
  const [filterStatus, setFilterStatus] = useState<UserStatus | "all">("all")
  const [query, setQuery] = useState("")
  const [hasMore, setHasMore] = useState(false)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const fetchSeqRef = useRef(0)

  const fetchUsers = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++fetchSeqRef.current
    setState("loading")
    setErrorMessage(null)
    try {
      const params = new URLSearchParams()
      if (filterRole !== "all") params.set("role", filterRole)
      if (filterStatus !== "all") params.set("status", filterStatus)
      params.set("limit", "100")
      const res = await fetch(`/api/admin/users?${params.toString()}`, {
        credentials: "include",
        signal: controller.signal,
      })
      if (seq !== fetchSeqRef.current || !mountedRef.current) return
      if (!res.ok) {
        setState("error")
        const parsed = await extractApiError(res)
        setErrorMessage(parsed.message)
        return
      }
      const data = (await res.json()) as { items?: AdminUserDTOClient[]; nextCursor?: number }
      if (seq !== fetchSeqRef.current || !mountedRef.current) return
      setUsers(data.items ?? [])
      setHasMore(data.nextCursor !== undefined && data.nextCursor !== null)
      setState("success")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (seq !== fetchSeqRef.current || !mountedRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [filterRole, filterStatus])

  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchUsers()
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchUsers])

  const filtered = query.trim().length > 0
    ? users.filter((u) => {
        const q = query.trim().toLowerCase()
        return (u.email ?? "").toLowerCase().includes(q)
          || (u.firstname ?? "").toLowerCase().includes(q)
          || (u.lastname ?? "").toLowerCase().includes(q)
      })
    : users

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher par nom / email…"
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
            aria-label="Rechercher un utilisateur"
          />
        </div>
        <label className="flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">Rôle :</span>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as Role | "all")}
            className="rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Filtrer par rôle"
          >
            <option value="all">Tous les rôles</option>
            {Object.entries(ROLE_LABELS_FR).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">Statut :</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as UserStatus | "all")}
            className="rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Filtrer par statut"
          >
            <option value="all">Tous les statuts</option>
            {Object.entries(USER_STATUS_LABELS_FR).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchUsers()}>
          <RefreshCw className="size-3.5 mr-1" aria-hidden="true" />
          Actualiser
        </DiabeoButton>
      </div>

      {state === "loading" && users.length === 0 && (
        <p className="text-sm text-muted-foreground" aria-live="polite">Chargement…</p>
      )}

      {state === "error" && users.length === 0 && (
        <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            Liste indisponible
          </p>
          {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchUsers()} className="mt-2">
            Réessayer
          </DiabeoButton>
        </div>
      )}

      {state === "success" && filtered.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center">
          <UserCircle2 className="size-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {query ? "Aucun utilisateur ne correspond à la recherche." : "Aucun utilisateur."}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <ul className="space-y-2" aria-label="Liste des utilisateurs">
          {filtered.map((user) => (
            <li key={user.id} className="rounded-md border">
              <Link
                href={`/admin/users/${user.id}`}
                className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
              >
                <UserCircle2 className="size-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{getUserDisplayName(user)}</span>
                    <Badge variant={getRoleVariant(user.role)} className="text-[10px]">
                      {getRoleLabel(user.role)}
                    </Badge>
                    <Badge variant={getUserStatusVariant(user.status)} className="text-[10px]">
                      {getUserStatusLabel(user.status)}
                    </Badge>
                    {user.mfaEnabled && (
                      <Badge variant="secondary" className="text-[10px]">
                        <ShieldCheck className="size-3 mr-0.5" aria-hidden="true" />
                        MFA
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {user.email ?? "—"} · Créé le {formatDate(user.createdAt, locale, { withTime: false })}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-1" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div role="note" className="rounded-md border border-orange-300 bg-orange-50 p-3 text-sm flex items-start gap-2">
          <AlertCircle className="size-4 text-orange-700 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-orange-800">
            Plus de 100 utilisateurs correspondent. Affiner les filtres pour réduire la liste.
            <span className="block text-xs opacity-80 mt-0.5">
              Pagination cursor V1.5 — affichage tronqué.
            </span>
          </p>
        </div>
      )}
    </>
  )
}
