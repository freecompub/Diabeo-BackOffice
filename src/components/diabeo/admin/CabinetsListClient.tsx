"use client"

/**
 * CabinetsListClient — UI ADMIN list cabinets (US-2117/2118).
 *
 * Backend : `GET /api/admin/healthcare-services` (paginé). Pattern aligné
 * iter 1+2 (AbortController + Dialog shadcn + i18n via formatDate).
 *
 * Fixes round 1 review PR #459 :
 *   - H1 : error codes mapping via `extractApiError`
 *   - H2 : types extraits dans `src/lib/types/cabinet-admin.ts`
 *   - L1 : `isServiceType` guard + warning dev si type drift backend
 *   - L8 : limit 100 documenté + TODO pagination cursor V1.5
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import {
  AlertCircle,
  Building2,
  ChevronRight,
  RefreshCw,
  Search,
} from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
import {
  type HealthcareServiceListItem,
  type ServiceType,
  isServiceType,
  SERVICE_TYPE_LABELS_FR,
} from "@/lib/types/cabinet-admin"
import { extractApiError } from "@/lib/ui/api-error"

type AsyncState = "idle" | "loading" | "success" | "error"

function getTypeLabel(type: ServiceType | string): string {
  if (isServiceType(type)) return SERVICE_TYPE_LABELS_FR[type]
  // Fix L1 round 1 — defense-in-depth + warning dev (drift backend enum).
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[CabinetsListClient] Unknown ServiceType: ${type}`)
  }
  return type
}

export function CabinetsListClient() {
  const t = useTranslations("admin.cabinetsList")
  const [cabinets, setCabinets] = useState<HealthcareServiceListItem[]>([])
  const [state, setState] = useState<AsyncState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  const fetchCabinets = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState("loading")
    setErrorMessage(null)
    try {
      // Fix L8 round 1 — pagination cursor V1.5 (backend `nextCursor` exposé).
      // Iter 3 : 100 premiers cabinets (aligné backend cap MAX_LIST_LIMIT).
      const res = await fetch("/api/admin/healthcare-services?limit=100", {
        credentials: "include",
        signal: controller.signal,
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        setState("error")
        // Fix H1 round 1 review PR #459 — error code mapping friendly (vs HTTP générique).
        const parsed = await extractApiError(res)
        setErrorMessage(parsed.message)
        return
      }
      const data = (await res.json()) as { items?: HealthcareServiceListItem[] }
      if (!mountedRef.current) return
      setCabinets(data.items ?? [])
      setState("success")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (!mountedRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCabinets()
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchCabinets])

  const filtered = query.trim().length > 0
    ? cabinets.filter((c) => {
        const q = query.trim().toLowerCase()
        return c.name.toLowerCase().includes(q)
          || (c.city ?? "").toLowerCase().includes(q)
          || (c.establishment ?? "").toLowerCase().includes(q)
      })
    : cabinets

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher par nom / ville / établissement…"
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
            aria-label="Rechercher un cabinet"
          />
        </div>
        <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchCabinets()}>
          <RefreshCw className="size-3.5 mr-1" aria-hidden="true" />
          {t("refresh")}
        </DiabeoButton>
      </div>

      {state === "loading" && cabinets.length === 0 && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t("loading")}
        </p>
      )}

      {state === "error" && cabinets.length === 0 && (
        <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            {t("listUnavailable")}
          </p>
          {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchCabinets()} className="mt-2">
            {t("retry")}
          </DiabeoButton>
        </div>
      )}

      {state === "success" && filtered.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center">
          <Building2 className="size-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {query ? t("noMatch") : t("empty")}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <ul className="space-y-2" aria-label="Liste des cabinets">
          {filtered.map((cabinet) => (
            <li key={cabinet.id} className="rounded-md border">
              <Link
                href={`/admin/cabinets/${cabinet.id}`}
                className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
              >
                <Building2 className="size-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{cabinet.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {getTypeLabel(cabinet.type)}
                    </Badge>
                    {cabinet.smsEnabled && (
                      <Badge variant="default" className="text-[10px]">
                        {t("smsEnabled", { credits: cabinet.smsCreditBalance })}
                      </Badge>
                    )}
                    {cabinet.managerId === null && (
                      <Badge variant="destructive" className="text-[10px]">
                        {t("noManager")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {[cabinet.establishment, cabinet.city].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-1" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
