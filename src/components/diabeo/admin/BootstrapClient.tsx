"use client"

/**
 * BootstrapClient — UI SYSTEM_ADMIN (ADMIN V1) : bootstrap du premier org-admin
 * d'un établissement.
 *
 * Backend US-2613 PR6a : `POST /api/admin/platform/bootstrap` (invite l'admin
 * principal Q1+Q2 ; refuse si un principal existe déjà). Liste des établissements
 * via `GET /api/admin/healthcare-services`. Aucune donnée de santé.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { UserPlus } from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { extractApiError } from "@/lib/ui/api-error"

type EstablishmentOption = { id: number; name: string }

export function BootstrapClient() {
  const t = useTranslations("platformAdmin")
  const [establishments, setEstablishments] = useState<EstablishmentOption[]>([])
  const [serviceId, setServiceId] = useState("")
  const [email, setEmail] = useState("")
  const [clinicalRole, setClinicalRole] = useState<"DOCTOR" | "NURSE">("DOCTOR")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listError, setListError] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  const loadEstablishments = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (mountedRef.current) setListError(false)
    try {
      const res = await fetch("/api/admin/healthcare-services?limit=100", {
        credentials: "include", signal: controller.signal,
      })
      if (!mountedRef.current) return
      if (!res.ok) { setListError(true); return }
      const data = (await res.json()) as { items?: EstablishmentOption[] }
      if (mountedRef.current) setEstablishments(data.items ?? [])
    } catch (err) {
      // Liste indisponible → on le signale (cul-de-sac sinon : select vide + bouton grisé).
      if (err instanceof Error && err.name === "AbortError") return
      if (mountedRef.current) setListError(true)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void loadEstablishments()
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [loadEstablishments])

  const submit = async () => {
    setBusy(true)
    setError(null)
    setFeedback(null)
    try {
      const res = await fetch("/api/admin/platform/bootstrap", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({
          serviceId: Number(serviceId),
          email,
          clinicalRole,
          ...(firstName.trim() && { firstName: firstName.trim() }),
          ...(lastName.trim() && { lastName: lastName.trim() }),
        }),
      })
      if (!mountedRef.current) return
      if (!res.ok) { setError((await extractApiError(res)).message); return }
      setFeedback(t("bootstrapDone"))
      setEmail(""); setFirstName(""); setLastName(""); setServiceId("")
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : t("loadError"))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const canSubmit = !busy && Number(serviceId) > 0 && /.+@.+\..+/.test(email)

  return (
    <section className="flex max-w-xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("bootstrapTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("bootstrapSubtitle")}</p>
      </header>

      {feedback && <p role="status" className="text-sm text-feedback-success">{feedback}</p>}
      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {listError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span>{t("establishmentsUnavailable")}</span>
          <button
            type="button"
            onClick={() => void loadEstablishments()}
            className="inline-flex min-h-11 items-center rounded-md border border-destructive/40 px-3 py-2 font-medium hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          >
            {t("retry")}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="bs-service" className="text-sm font-medium">{t("bootstrapEstablishment")}</label>
          <select
            id="bs-service"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            aria-required="true"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="">{t("assignSelect")}</option>
            {establishments.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="bs-email" className="text-sm font-medium">{t("bootstrapEmail")}</label>
          <input
            id="bs-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-required="true"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="bs-role" className="text-sm font-medium">{t("bootstrapRole")}</label>
          <select
            id="bs-role"
            value={clinicalRole}
            onChange={(e) => setClinicalRole(e.target.value as "DOCTOR" | "NURSE")}
            className="w-48 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="DOCTOR">{t("roleDoctor")}</option>
            <option value="NURSE">{t("roleNurse")}</option>
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="bs-first" className="text-sm font-medium">{t("bootstrapFirstName")}</label>
            <input
              id="bs-first"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bs-last" className="text-sm font-medium">{t("bootstrapLastName")}</label>
            <input
              id="bs-last"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{t("bootstrapNote")}</p>

        <div>
          <DiabeoButton variant="diabeoPrimary" size="sm" onClick={() => void submit()} disabled={!canSubmit}>
            <UserPlus className="mr-1 size-4" aria-hidden="true" />
            {t("bootstrapSubmit")}
          </DiabeoButton>
        </div>
      </div>
    </section>
  )
}
