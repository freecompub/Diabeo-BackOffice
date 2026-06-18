"use client"

/**
 * TenantDetailClient — UI SYSTEM_ADMIN (ADMIN V1) : détail d'un tenant.
 *
 * Backend US-2613 PR6a : `GET/PATCH /api/admin/tenants/[id]` (nom/pays + nb
 * services) et `POST /api/admin/tenants/[id]/services` (rattacher un établissement).
 * Aucune donnée de santé.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { ArrowLeft, Save } from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { extractApiError } from "@/lib/ui/api-error"

type AsyncState = "loading" | "ready" | "error"

type TenantDetail = { id: number; name: string; country: string | null; serviceCount: number }
type EstablishmentOption = { id: number; name: string }

export function TenantDetailClient({ tenantId }: { tenantId: number }) {
  const t = useTranslations("platformAdmin")
  const [tenant, setTenant] = useState<TenantDetail | null>(null)
  const [establishments, setEstablishments] = useState<EstablishmentOption[]>([])
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [country, setCountry] = useState("")
  const [selectedService, setSelectedService] = useState("")
  const [feedback, setFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  // Dépendance d'effet stable : capter le message (string stable) plutôt que `t`
  // (référence recréée à chaque render → refetch en boucle).
  const loadErrorMessage = t("loadError")

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState("loading")
    setErrorMessage(null)
    try {
      const [tenantRes, estRes] = await Promise.all([
        fetch(`/api/admin/tenants/${tenantId}`, { credentials: "include", signal: controller.signal }),
        fetch("/api/admin/healthcare-services?limit=100", { credentials: "include", signal: controller.signal }),
      ])
      if (!mountedRef.current) return
      if (!tenantRes.ok) {
        setErrorMessage((await extractApiError(tenantRes)).message)
        setState("error")
        return
      }
      const detail = (await tenantRes.json()) as TenantDetail
      const estData = estRes.ok ? ((await estRes.json()) as { items?: EstablishmentOption[] }) : { items: [] }
      if (!mountedRef.current) return
      setTenant(detail)
      setName(detail.name)
      setCountry(detail.country ?? "")
      setEstablishments(estData.items ?? [])
      setState("ready")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (!mountedRef.current) return
      setErrorMessage(err instanceof Error ? err.message : loadErrorMessage)
      setState("error")
    }
  }, [tenantId, loadErrorMessage])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [load])

  // Refetch silencieux du tenant (nom/pays/serviceCount) sans repasser en
  // `state="loading"` → ne démonte pas le formulaire, préserve l'annonce
  // `role="status"` (cf. review M2). Non bloquant en cas d'échec.
  const refreshTenant = async () => {
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}`, { credentials: "include" })
      if (!mountedRef.current || !res.ok) return
      const detail = (await res.json()) as TenantDetail
      if (mountedRef.current) setTenant(detail)
    } catch {
      // refresh best-effort — l'état affiché reste cohérent jusqu'au prochain chargement.
    }
  }

  const save = async () => {
    setBusy(true)
    setFeedback(null)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ name, country: country.trim() ? country.trim().toUpperCase() : null }),
      })
      if (!mountedRef.current) return
      if (!res.ok) { setErrorMessage((await extractApiError(res)).message); return }
      setFeedback(t("saved"))
    } catch (err) {
      if (mountedRef.current) setErrorMessage(err instanceof Error ? err.message : t("loadError"))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const assign = async () => {
    const serviceId = Number(selectedService)
    if (!Number.isInteger(serviceId) || serviceId <= 0) return
    setBusy(true)
    setFeedback(null)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/services`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ serviceId }),
      })
      if (!mountedRef.current) return
      if (!res.ok) { setErrorMessage((await extractApiError(res)).message); return }
      setSelectedService("")
      setFeedback(t("assignDone"))
      await refreshTenant()
    } catch (err) {
      if (mountedRef.current) setErrorMessage(err instanceof Error ? err.message : t("loadError"))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-6" aria-busy={state === "loading"}>
      <nav aria-label={t("breadcrumb")}>
        <Link
          href="/admin/tenants"
          className="inline-flex items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          {t("backToTenants")}
        </Link>
      </nav>

      {state === "loading" && <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>}

      {state === "error" && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {errorMessage ?? t("loadError")}
        </div>
      )}

      {state === "ready" && tenant && (
        <>
          <h1 className="text-2xl font-semibold">{tenant.name}</h1>

          {feedback && <p role="status" className="text-sm text-success-fg">{feedback}</p>}
          {errorMessage && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("tenantInfo")}</h2>
            <div className="flex flex-col gap-1">
              <label htmlFor="tenant-name" className="text-sm font-medium">{t("tenantName")}</label>
              <input
                id="tenant-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
            <div>
              <DiabeoButton variant="diabeoPrimary" size="sm" onClick={() => void save()} disabled={busy || name.trim().length < 2}>
                <Save className="mr-1 size-4" aria-hidden="true" />
                {t("save")}
              </DiabeoButton>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("tenantServices")} · {t("tenantServiceCount", { count: tenant.serviceCount })}
            </h2>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="assign-service" className="text-sm font-medium">{t("assignEstablishment")}</label>
                <select
                  id="assign-service"
                  value={selectedService}
                  onChange={(e) => setSelectedService(e.target.value)}
                  aria-describedby="assign-note-help"
                  className="min-w-64 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="">{t("assignSelect")}</option>
                  {establishments.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <DiabeoButton variant="diabeoSecondary" size="sm" onClick={() => void assign()} disabled={busy || !selectedService}>
                {t("assignSubmit")}
              </DiabeoButton>
            </div>
            <p id="assign-note-help" className="text-xs text-muted-foreground">{t("assignNote")}</p>
          </div>
        </>
      )}
    </section>
  )
}
