"use client"

/**
 * CabinetsListClient — UI ADMIN list cabinets (US-2117/2118).
 *
 * Backend : `GET /api/admin/healthcare-services` (paginé). Pattern aligné
 * iter 1+2 (AbortController + Dialog shadcn + i18n via formatDate).
 */

import { useCallback, useEffect, useRef, useState } from "react"
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

type ServiceType = "hospital" | "clinic" | "private_practice" | "lab" | "pharmacy" | "other"

interface HealthcareServiceDTO {
  id: number
  name: string
  type: ServiceType
  city: string | null
  establishment: string | null
  smsEnabled: boolean
  smsCreditBalance: number
  managerId: number | null
}

type AsyncState = "idle" | "loading" | "success" | "error"

const TYPE_LABELS: Record<ServiceType, string> = {
  hospital: "Hôpital",
  clinic: "Clinique",
  private_practice: "Cabinet libéral",
  lab: "Laboratoire",
  pharmacy: "Pharmacie",
  other: "Autre",
}

export function CabinetsListClient() {
  const [cabinets, setCabinets] = useState<HealthcareServiceDTO[]>([])
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
      const res = await fetch("/api/admin/healthcare-services?limit=100", {
        credentials: "include",
        signal: controller.signal,
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        setState("error")
        setErrorMessage(`HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { items?: HealthcareServiceDTO[] }
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
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm"
            aria-label="Rechercher un cabinet"
          />
        </div>
        <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchCabinets()}>
          <RefreshCw className="size-3.5 mr-1" aria-hidden="true" />
          Actualiser
        </DiabeoButton>
      </div>

      {state === "loading" && cabinets.length === 0 && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Chargement…
        </p>
      )}

      {state === "error" && cabinets.length === 0 && (
        <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            Liste indisponible
          </p>
          {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchCabinets()} className="mt-2">
            Réessayer
          </DiabeoButton>
        </div>
      )}

      {state === "success" && filtered.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center">
          <Building2 className="size-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {query ? "Aucun cabinet ne correspond à la recherche." : "Aucun cabinet enregistré."}
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
                      {TYPE_LABELS[cabinet.type] ?? cabinet.type}
                    </Badge>
                    {cabinet.smsEnabled && (
                      <Badge variant="default" className="text-[10px]">
                        SMS activé ({cabinet.smsCreditBalance} crédits)
                      </Badge>
                    )}
                    {cabinet.managerId === null && (
                      <Badge variant="destructive" className="text-[10px]">
                        Pas de manager
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
