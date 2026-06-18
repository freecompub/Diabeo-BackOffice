"use client"

/**
 * VerificationPolicyClient — UI SYSTEM_ADMIN (ADMIN V1) : politiques de
 * vérification PS (porte Q1). Backend US-2613 PR6a : `GET/POST
 * /api/admin/verification-policies`.
 *
 * Fail-secure côté serveur (cible tenant XOR pays ; `provisional` borné +
 * interdit en prod sans flag) — l'UI reflète ces invariants et mappe les codes
 * d'erreur. Aucune donnée de santé (métadonnée d'accès uniquement).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { ShieldCheck } from "lucide-react"
import type { Locale } from "@/i18n/config"
import { formatDate } from "@/lib/intl/formatters"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { extractApiError } from "@/lib/ui/api-error"

type AsyncState = "loading" | "ready" | "error"
type TargetType = "tenant" | "country"
type Mode = "required" | "provisional"

type PolicyView = {
  id: number
  tenantId: number | null
  country: string | null
  mode: Mode
  expiresAt: string | null
  setAt: string
}

export function VerificationPolicyClient() {
  const t = useTranslations("platformAdmin")
  const locale = useLocale() as Locale
  const [policies, setPolicies] = useState<PolicyView[]>([])
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const loadErrorMessage = t("loadError")

  // Formulaire de pose.
  const [targetType, setTargetType] = useState<TargetType>("tenant")
  const [tenantId, setTenantId] = useState("")
  const [country, setCountry] = useState("")
  const [mode, setMode] = useState<Mode>("required")
  const [expiresAt, setExpiresAt] = useState("")
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState("loading")
    setErrorMessage(null)
    try {
      const res = await fetch("/api/admin/verification-policies", { credentials: "include", signal: controller.signal })
      if (!mountedRef.current) return
      if (!res.ok) { setErrorMessage((await extractApiError(res)).message); setState("error"); return }
      const data = (await res.json()) as { items?: PolicyView[] }
      if (!mountedRef.current) return
      setPolicies(data.items ?? [])
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

  const submit = async () => {
    setBusy(true)
    setErrorMessage(null)
    setFeedback(null)
    try {
      const body: Record<string, unknown> = { mode }
      if (targetType === "tenant") body.tenantId = Number(tenantId)
      else body.country = country.trim().toUpperCase()
      if (mode === "provisional") body.expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null

      const res = await fetch("/api/admin/verification-policies", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify(body),
      })
      if (!mountedRef.current) return
      if (!res.ok) { setErrorMessage((await extractApiError(res)).message); return }
      setFeedback(t("policySetDone"))
      setTenantId(""); setCountry(""); setExpiresAt("")
      await load()
    } catch (err) {
      if (mountedRef.current) setErrorMessage(err instanceof Error ? err.message : loadErrorMessage)
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const canSubmit = !busy
    && (targetType === "tenant" ? Number(tenantId) > 0 : /^[A-Za-z]{2}$/.test(country.trim()))
    && (mode === "required" || expiresAt !== "")

  return (
    <section className="flex flex-col gap-6" aria-busy={state === "loading"}>
      <header>
        <h1 className="text-2xl font-semibold">{t("policiesTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("policiesSubtitle")}</p>
      </header>

      {feedback && <p role="status" className="text-sm text-success-fg">{feedback}</p>}
      {errorMessage && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {/* Formulaire de pose */}
      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("policySetTitle")}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="vp-target" className="text-sm font-medium">{t("policyTargetType")}</label>
            <select
              id="vp-target"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as TargetType)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="tenant">{t("policyTargetTenant")}</option>
              <option value="country">{t("policyTargetCountry")}</option>
            </select>
          </div>

          {targetType === "tenant" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="vp-tenant" className="text-sm font-medium">{t("policyTenantId")}</label>
              <input
                id="vp-tenant"
                type="number"
                min={1}
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="w-28 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="vp-country" className="text-sm font-medium">{t("policyCountry")}</label>
              <input
                id="vp-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                maxLength={2}
                pattern="[A-Za-z]{2}"
                placeholder={t("tenantCountryPlaceholder")}
                className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="vp-mode" className="text-sm font-medium">{t("policyMode")}</label>
            <select
              id="vp-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="required">{t("modeRequired")}</option>
              <option value="provisional">{t("modeProvisional")}</option>
            </select>
          </div>

          {mode === "provisional" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="vp-expires" className="text-sm font-medium">{t("policyExpiresAt")}</label>
              <input
                id="vp-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                aria-describedby="vp-expires-help"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          )}

          <DiabeoButton variant="diabeoPrimary" size="sm" onClick={() => void submit()} disabled={!canSubmit}>
            <ShieldCheck className="mr-1 size-4" aria-hidden="true" />
            {t("policySetSubmit")}
          </DiabeoButton>
        </div>
        {mode === "provisional" && (
          <p id="vp-expires-help" className="text-xs text-muted-foreground">{t("policyProvisionalHint")}</p>
        )}
      </div>

      {/* Liste */}
      {state === "loading" && <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>}

      {state === "ready" && policies.length === 0 && (
        <DiabeoEmptyState variant="noData" title={t("policiesEmptyTitle")} message={t("policiesEmptyMessage")} />
      )}

      {state === "ready" && policies.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-start">{t("colTarget")}</th>
                <th scope="col" className="px-4 py-2 text-start">{t("colMode")}</th>
                <th scope="col" className="px-4 py-2 text-start">{t("colExpires")}</th>
                <th scope="col" className="px-4 py-2 text-start">{t("colSetAt")}</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    {p.tenantId != null ? t("policyTenantTarget", { id: p.tenantId }) : (p.country ?? "—")}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={p.mode === "required" ? "secondary" : "outline"}>
                      {p.mode === "required" ? t("modeRequired") : t("modeProvisional")}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {p.expiresAt ? formatDate(p.expiresAt, locale, { style: "medium" }) : "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(p.setAt, locale, { style: "medium" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
