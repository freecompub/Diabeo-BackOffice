"use client"

/**
 * TenantsListClient — UI SYSTEM_ADMIN (ADMIN V1) : liste des tenants + création.
 *
 * Backend US-2613 PR6a : `GET /api/admin/tenants` (liste + nb services),
 * `POST /api/admin/tenants` (création). Pattern aligné CabinetsListClient /
 * MembersManagementClient (AbortController + Dialog + extractApiError).
 *
 * Aucune donnée de santé : un tenant ne porte que des métadonnées d'organisation.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Building, ChevronRight, Plus } from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { extractApiError } from "@/lib/ui/api-error"

type AsyncState = "loading" | "ready" | "error"

type TenantView = {
  id: number
  name: string
  country: string | null
  serviceCount: number
}

export function TenantsListClient() {
  const t = useTranslations("platformAdmin")
  const [tenants, setTenants] = useState<TenantView[]>([])
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  const fetchTenants = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState("loading")
    setErrorMessage(null)
    try {
      const res = await fetch("/api/admin/tenants", { credentials: "include", signal: controller.signal })
      if (!mountedRef.current) return
      if (!res.ok) {
        setErrorMessage((await extractApiError(res)).message)
        setState("error")
        return
      }
      const data = (await res.json()) as { items?: TenantView[] }
      if (!mountedRef.current) return
      setTenants(data.items ?? [])
      setState("ready")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (!mountedRef.current) return
      setErrorMessage(err instanceof Error ? err.message : t("loadError"))
      setState("error")
    }
  }, [t])

  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial (idiome admin list, cf. CabinetsListClient)
    void fetchTenants()
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [fetchTenants])

  return (
    <section className="flex flex-col gap-6" aria-busy={state === "loading"}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("tenantsTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("tenantsSubtitle")}</p>
        </div>
        <DiabeoButton variant="diabeoPrimary" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-4" aria-hidden="true" />
          {t("tenantCreate")}
        </DiabeoButton>
      </header>

      {state === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>
      )}

      {state === "error" && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorMessage ?? t("loadError")}
        </div>
      )}

      {state === "ready" && tenants.length === 0 && (
        <DiabeoEmptyState variant="noData" title={t("tenantsEmptyTitle")} message={t("tenantsEmptyMessage")} />
      )}

      {state === "ready" && tenants.length > 0 && (
        <ul className="space-y-2" aria-label={t("tenantsTitle")}>
          {tenants.map((tenant) => (
            <li key={tenant.id} className="rounded-lg border border-border">
              <Link
                href={`/admin/tenants/${tenant.id}`}
                className="flex min-h-11 items-center gap-3 p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Building className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{tenant.name}</span>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {(tenant.country ?? "—")} · {t("tenantServiceCount", { count: tenant.serviceCount })}
                  </p>
                </div>
                {tenant.country && <Badge variant="secondary">{tenant.country}</Badge>}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateTenantDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void fetchTenants()}
      />
    </section>
  )
}

function CreateTenantDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const t = useTranslations("platformAdmin")
  const [name, setName] = useState("")
  const [country, setCountry] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const reset = () => { setName(""); setCountry(""); setError(null) }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ name, country: country.trim() ? country.trim().toUpperCase() : null }),
      })
      if (!mountedRef.current) return
      if (!res.ok) { setError((await extractApiError(res)).message); return }
      reset()
      onOpenChange(false)
      onCreated()
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
          <DialogTitle>{t("tenantCreateTitle")}</DialogTitle>
          <DialogDescription>{t("tenantCreateDesc")}</DialogDescription>
        </DialogHeader>
        {error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="tenant-name" className="text-sm font-medium">{t("tenantName")}</label>
            <input
              id="tenant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-required="true"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="tenant-country" className="text-sm font-medium">{t("tenantCountry")}</label>
            <input
              id="tenant-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              maxLength={2}
              pattern="[A-Za-z]{2}"
              placeholder={t("tenantCountryPlaceholder")}
              className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </div>
        <DialogFooter>
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </DiabeoButton>
          <DiabeoButton variant="diabeoPrimary" size="sm" onClick={() => void submit()} disabled={busy || name.trim().length < 2}>
            {t("tenantCreateSubmit")}
          </DiabeoButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
