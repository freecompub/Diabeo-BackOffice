"use client"

/**
 * TaxRulesClient — UI ADMIN résolution taux fiscal actif (US-2110).
 *
 * Backend : `GET /api/config/tax-rules/active?countryCode=&taxType=&date=`.
 * Pattern aligné iter 1-4 (AbortController + extractApiError).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale } from "next-intl"
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Percent,
  Search,
} from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/intl/formatters"
import type { Locale } from "@/i18n/config"
import {
  type TaxRuleDTOClient,
  type TaxType,
  TAX_TYPES,
  TAX_TYPE_LABELS_FR,
  formatTaxRate,
  getLocalIsoDate,
} from "@/lib/types/user-admin"
import { extractApiError } from "@/lib/ui/api-error"

type AsyncState = "idle" | "loading" | "success" | "error" | "not_found"

// Fix M5 round 1 review PR #461 — `<datalist>` suggestions + `<input type="text">`
// libre (vs `<select>` qui figeait 6 codes et bloquait cabinets US/UK/DE).
// Backend `countryTaxRuleService` accepte tout ISO 3166-1 alpha-2.
const COUNTRY_SUGGESTIONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "FR", label: "France" },
  { code: "DZ", label: "Algérie" },
  { code: "BE", label: "Belgique" },
  { code: "CH", label: "Suisse" },
  { code: "MA", label: "Maroc" },
  { code: "TN", label: "Tunisie" },
  { code: "DE", label: "Allemagne" },
  { code: "US", label: "États-Unis" },
  { code: "GB", label: "Royaume-Uni" },
]

const COUNTRY_CODE_RE = /^[A-Z]{2}$/

export function TaxRulesClient() {
  const locale = useLocale() as Locale
  const [countryCode, setCountryCode] = useState<string>("FR")
  const [taxType, setTaxType] = useState<TaxType>("VAT")
  // Fix M6 round 1 — getLocalIsoDate (vs new Date().toISOString() UTC).
  const [date, setDate] = useState<string>(getLocalIsoDate())
  const [result, setResult] = useState<TaxRuleDTOClient | null>(null)
  const [state, setState] = useState<AsyncState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  // Fix L1 round 1 — useRef + useEffect focus error state.
  const errorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])
  useEffect(() => {
    if (state === "error") errorRef.current?.focus()
  }, [state])
  const isCountryValid = COUNTRY_CODE_RE.test(countryCode)

  const fetchRule = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState("loading")
    setErrorMessage(null)
    setResult(null)
    try {
      const params = new URLSearchParams({ countryCode, taxType, date })
      const res = await fetch(`/api/config/tax-rules/active?${params.toString()}`, {
        credentials: "include",
        signal: controller.signal,
      })
      if (!mountedRef.current) return
      if (res.status === 404) {
        setState("not_found")
        return
      }
      if (!res.ok) {
        setState("error")
        const parsed = await extractApiError(res)
        setErrorMessage(parsed.message)
        return
      }
      const data = (await res.json()) as { rule?: TaxRuleDTOClient } | TaxRuleDTOClient
      if (!mountedRef.current) return
      const rule = "rule" in data ? data.rule : (data as TaxRuleDTOClient)
      if (rule) setResult(rule)
      setState("success")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (!mountedRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [countryCode, taxType, date])

  return (
    <>
      {/* Form recherche */}
      <section className="rounded-md border p-4 space-y-3" aria-labelledby="search-section">
        <h2 id="search-section" className="text-lg font-semibold">Rechercher un taux actif</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            <span>Pays (ISO 3166-1 alpha-2)</span>
            {/* Fix M5 round 1 — input libre + datalist suggestions. */}
            <input
              type="text"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              list="country-suggestions"
              pattern="[A-Z]{2}"
              maxLength={2}
              required
              placeholder="FR"
              aria-invalid={countryCode.length > 0 && !COUNTRY_CODE_RE.test(countryCode) ? "true" : undefined}
              className="rounded-md border bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary uppercase"
            />
            <datalist id="country-suggestions">
              {COUNTRY_SUGGESTIONS.map((c) => (
                <option key={c.code} value={c.code}>{c.label} ({c.code})</option>
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Type de taxe</span>
            <select
              value={taxType}
              onChange={(e) => setTaxType(e.target.value as TaxType)}
              className="rounded-md border bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {TAX_TYPES.map((t) => (
                <option key={t} value={t}>{TAX_TYPE_LABELS_FR[t]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <div className="flex items-end">
            <DiabeoButton onClick={() => void fetchRule()} disabled={state === "loading" || !isCountryValid} className="w-full">
              <Search className="size-4 mr-1" aria-hidden="true" />
              {state === "loading" ? "Recherche…" : "Rechercher"}
            </DiabeoButton>
          </div>
        </div>
      </section>

      {/* Résultats */}
      {state === "loading" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          Chargement…
        </div>
      )}

      {state === "error" && errorMessage && (
        <div role="alert" tabIndex={-1} ref={errorRef} className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive">
          <p className="font-medium text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            Erreur
          </p>
          <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>
        </div>
      )}

      {state === "not_found" && (
        <div role="status" aria-live="polite" className="rounded-md border border-dashed p-6 text-center text-sm">
          <p className="text-muted-foreground">
            Aucun taux actif pour <strong>{countryCode}</strong> / <strong>{TAX_TYPE_LABELS_FR[taxType]}</strong> au {date}.
          </p>
        </div>
      )}

      {state === "success" && result && (
        <section className="rounded-md border p-4 space-y-3" aria-labelledby="result-section">
          <h2 id="result-section" className="text-lg font-semibold flex items-center gap-2">
            <CheckCircle2 className="size-5 text-primary" aria-hidden="true" />
            Taux actif trouvé
          </h2>
          <div className="flex items-center gap-3 mb-2">
            <Percent className="size-8 text-primary" aria-hidden="true" />
            <div>
              <p className="text-3xl font-bold">{formatTaxRate(result.baseRate, locale)}</p>
              <p className="text-sm text-muted-foreground">{TAX_TYPE_LABELS_FR[result.taxType]} · {result.countryCode}</p>
            </div>
          </div>
          <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <Field label="Pays">{result.countryCode}</Field>
            <Field label="Type">
              {TAX_TYPE_LABELS_FR[result.taxType]}
              <Badge variant="outline" className="ml-1 text-[10px]">{result.taxType}</Badge>
            </Field>
            <Field label="Taux">{formatTaxRate(result.baseRate, locale)}</Field>
            <Field label="Statut">
              <Badge variant={result.isActive ? "default" : "secondary"}>
                {result.isActive ? "Actif" : "Inactif"}
              </Badge>
            </Field>
            <Field label="Effet depuis">{formatDate(result.appliesFrom, locale, { withTime: false })}</Field>
            <Field label="Effet jusqu'au">
              {result.appliesUntil ? formatDate(result.appliesUntil, locale, { withTime: false }) : "Pas de fin programmée"}
            </Field>
            {result.description && (
              <Field label="Description">
                <span className="text-sm">{result.description}</span>
              </Field>
            )}
          </dl>
        </section>
      )}
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
