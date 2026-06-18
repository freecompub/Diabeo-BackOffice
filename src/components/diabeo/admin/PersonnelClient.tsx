"use client"

/**
 * PersonnelClient — UI SYSTEM_ADMIN (ADMIN V1) : gestion personnel **cross-tenant**
 * (offboarding / incident). Recherche d'un compte (nom EXACT — index HMAC, cf.
 * `user-management`), vue de ses appartenances/capacités, et révocation immédiate
 * d'une appartenance.
 *
 * Backends US-2613 : `GET /api/admin/users?search=` (recherche), `GET
 * /api/admin/platform/personnel/[id]` (capacités), `POST .../revoke` (révocation).
 * **Aucune donnée de santé** : PII admin + capacités/scope uniquement.
 */

import { useCallback, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Search } from "lucide-react"
import type { Role } from "@prisma/client"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
import { extractApiError } from "@/lib/ui/api-error"

type UserResult = { id: number; firstname: string | null; lastname: string | null; email: string | null; role: Role }

type Membership = {
  serviceId: number
  serviceName: string
  tenantId: number | null
  clinicalRole: Role | null
  canManage: boolean
  isPrincipalAdmin: boolean
}
type Personnel = {
  user: { id: number; firstname: string | null; lastname: string | null; email: string | null; role: Role; status: string }
  memberships: Membership[]
}

export function PersonnelClient() {
  const t = useTranslations("platformAdmin")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<UserResult[] | null>(null)
  const [personnel, setPersonnel] = useState<Personnel | null>(null)
  const [searching, setSearching] = useState(false)
  const [busyServiceId, setBusyServiceId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const loadErrorMessage = t("loadError")
  const mountedRef = useRef(true)

  const userName = (u: { firstname: string | null; lastname: string | null; id: number }) =>
    [u.firstname, u.lastname].filter(Boolean).join(" ") || `#${u.id}`

  const search = useCallback(async () => {
    if (query.trim().length < 2) return
    setSearching(true)
    setErrorMessage(null)
    setFeedback(null)
    setPersonnel(null)
    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(query.trim())}&limit=20`, { credentials: "include" })
      if (!mountedRef.current) return
      if (!res.ok) { setErrorMessage((await extractApiError(res)).message); return }
      const data = (await res.json()) as { items?: UserResult[] }
      if (mountedRef.current) setResults(data.items ?? [])
    } catch (err) {
      if (mountedRef.current) setErrorMessage(err instanceof Error ? err.message : loadErrorMessage)
    } finally {
      if (mountedRef.current) setSearching(false)
    }
  }, [query, loadErrorMessage])

  const loadPersonnel = useCallback(async (userId: number) => {
    setErrorMessage(null)
    setFeedback(null)
    try {
      const res = await fetch(`/api/admin/platform/personnel/${userId}`, { credentials: "include" })
      if (!mountedRef.current) return
      if (!res.ok) { setErrorMessage((await extractApiError(res)).message); return }
      const data = (await res.json()) as Personnel
      if (mountedRef.current) setPersonnel(data)
    } catch (err) {
      if (mountedRef.current) setErrorMessage(err instanceof Error ? err.message : loadErrorMessage)
    }
  }, [loadErrorMessage])

  const revoke = useCallback(async (userId: number, serviceId: number) => {
    setBusyServiceId(serviceId)
    setErrorMessage(null)
    setFeedback(null)
    try {
      const res = await fetch(`/api/admin/platform/personnel/${userId}/revoke`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ serviceId }),
      })
      if (!mountedRef.current) return
      if (!res.ok) { setErrorMessage((await extractApiError(res)).message); return }
      setFeedback(t("personnelRevokeDone"))
      setPersonnel((prev) => prev ? { ...prev, memberships: prev.memberships.filter((m) => m.serviceId !== serviceId) } : prev)
    } catch (err) {
      if (mountedRef.current) setErrorMessage(err instanceof Error ? err.message : loadErrorMessage)
    } finally {
      if (mountedRef.current) setBusyServiceId(null)
    }
  }, [t, loadErrorMessage])

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("personnelTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("personnelSubtitle")}</p>
      </header>

      {feedback && <p role="status" className="text-sm text-success-fg">{feedback}</p>}
      {errorMessage && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {/* Recherche */}
      <div className="flex flex-col gap-2">
        <label htmlFor="pers-search" className="text-sm font-medium">{t("personnelSearchLabel")}</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="pers-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void search() }}
            aria-describedby="pers-search-help"
            placeholder={t("personnelSearchPlaceholder")}
            className="min-w-64 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <DiabeoButton variant="diabeoPrimary" size="sm" onClick={() => void search()} disabled={searching || query.trim().length < 2}>
            <Search className="mr-1 size-4" aria-hidden="true" />
            {t("personnelSearch")}
          </DiabeoButton>
        </div>
        <p id="pers-search-help" className="text-xs text-muted-foreground">{t("personnelSearchHint")}</p>
      </div>

      {/* Résultats de recherche */}
      {results !== null && !personnel && (
        results.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("personnelNoResults")}</p>
        ) : (
          <ul className="space-y-2" aria-label={t("personnelResults")}>
            {results.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => void loadPersonnel(u.id)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border px-4 py-2 text-start text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span>
                    <span className="font-medium">{userName(u)}</span>
                    {u.email && <span className="block text-xs text-muted-foreground">{u.email}</span>}
                  </span>
                  <Badge variant="outline">{u.role}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {/* Détail personnel + appartenances */}
      {personnel && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{userName(personnel.user)}</h2>
              {personnel.user.email && <p className="text-xs text-muted-foreground">{personnel.user.email}</p>}
            </div>
            <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => setPersonnel(null)}>
              {t("personnelBackToResults")}
            </DiabeoButton>
          </div>

          {personnel.memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("personnelNoMemberships")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-start">{t("personnelColService")}</th>
                    <th scope="col" className="px-4 py-2 text-start">{t("personnelColClinical")}</th>
                    <th scope="col" className="px-4 py-2 text-start">{t("personnelColManagement")}</th>
                    <th scope="col" className="px-4 py-2 text-end">{t("psColActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {personnel.memberships.map((m) => (
                    <tr key={m.serviceId} className="border-t border-border">
                      <td className="px-4 py-2">
                        <span className="font-medium">{m.serviceName}</span>
                        {m.tenantId != null && (
                          <span className="block text-xs text-muted-foreground">{t("policyTenantTarget", { id: m.tenantId })}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">{m.clinicalRole ?? "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {m.isPrincipalAdmin && <Badge variant="secondary">{t("badgePrincipal")}</Badge>}
                          {m.canManage && !m.isPrincipalAdmin && <Badge variant="outline">{t("badgeManage")}</Badge>}
                          {!m.canManage && "—"}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-end">
                        <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void revoke(personnel.user.id, m.serviceId)} disabled={busyServiceId === m.serviceId}>
                          {t("personnelRevoke")}
                        </DiabeoButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
