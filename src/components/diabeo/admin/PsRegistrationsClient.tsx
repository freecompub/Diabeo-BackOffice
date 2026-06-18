"use client"

/**
 * PsRegistrationsClient — UI SYSTEM_ADMIN (ADMIN V1) : validation manuelle des
 * preuves d'enregistrement PS en attente. Backend US-2613 PR6a :
 * `GET /api/admin/ps-registrations`, `PATCH /api/admin/ps-registrations/[id]`.
 *
 * ⚠️ V1 — vérification minimale (valider/refuser). Identité du praticien = PII
 * admin déchiffrée côté serveur ; **aucune donnée de santé**.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { extractApiError } from "@/lib/ui/api-error"

type AsyncState = "loading" | "ready" | "error"

type PsRegistration = {
  id: number
  userId: number
  firstname: string | null
  lastname: string | null
  email: string | null
  country: string
  scheme: string
  number: string | null
  method: string
}

export function PsRegistrationsClient() {
  const t = useTranslations("platformAdmin")
  const [rows, setRows] = useState<PsRegistration[]>([])
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const loadErrorMessage = t("loadError")
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState("loading")
    setErrorMessage(null)
    try {
      const res = await fetch("/api/admin/ps-registrations", { credentials: "include", signal: controller.signal })
      if (!mountedRef.current) return
      if (!res.ok) { setErrorMessage((await extractApiError(res)).message); setState("error"); return }
      const data = (await res.json()) as { items?: PsRegistration[] }
      if (!mountedRef.current) return
      setRows(data.items ?? [])
      setState("ready")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (!mountedRef.current) return
      setErrorMessage(err instanceof Error ? err.message : loadErrorMessage)
      setState("error")
    }
  }, [loadErrorMessage])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [load])

  const decide = useCallback(async (id: number, decision: "verified" | "rejected") => {
    setBusyId(id)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/admin/ps-registrations/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ decision }),
      })
      if (!mountedRef.current) return
      if (!res.ok) { setErrorMessage((await extractApiError(res)).message); return }
      // Retirer la ligne traitée (elle n'est plus « en attente »).
      setRows((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      if (mountedRef.current) setErrorMessage(err instanceof Error ? err.message : loadErrorMessage)
    } finally {
      if (mountedRef.current) setBusyId(null)
    }
  }, [loadErrorMessage])

  const fullName = (r: PsRegistration) =>
    [r.firstname, r.lastname].filter(Boolean).join(" ") || `#${r.userId}`

  return (
    <section className="flex flex-col gap-6" aria-busy={state === "loading"}>
      <header>
        <h1 className="text-2xl font-semibold">{t("psTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("psSubtitle")}</p>
      </header>

      {errorMessage && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {state === "loading" && <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>}

      {state === "ready" && rows.length === 0 && (
        <DiabeoEmptyState variant="noData" title={t("psEmptyTitle")} message={t("psEmptyMessage")} />
      )}

      {state === "ready" && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-start">{t("psColMember")}</th>
                <th scope="col" className="px-4 py-2 text-start">{t("psColCountry")}</th>
                <th scope="col" className="px-4 py-2 text-start">{t("psColScheme")}</th>
                <th scope="col" className="px-4 py-2 text-start">{t("psColNumber")}</th>
                <th scope="col" className="px-4 py-2 text-end">{t("psColActions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <span className="font-medium">{fullName(r)}</span>
                    {r.email && <span className="block text-xs text-muted-foreground">{r.email}</span>}
                  </td>
                  <td className="px-4 py-2">{r.country}</td>
                  <td className="px-4 py-2">{r.scheme}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.number ?? "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <DiabeoButton variant="diabeoPrimary" size="sm" onClick={() => void decide(r.id, "verified")} disabled={busyId === r.id}>
                        {t("psValidate")}
                      </DiabeoButton>
                      <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void decide(r.id, "rejected")} disabled={busyId === r.id}>
                        {t("psReject")}
                      </DiabeoButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
