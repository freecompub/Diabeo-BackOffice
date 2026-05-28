"use client"

/**
 * InvoicesListClient — UI ADMIN list factures (US-2102/2108).
 *
 * Backend : `GET /api/billing/invoices` (paginé cursor). Pattern aligné
 * iter 1-3 (AbortController + extractApiError + i18n via useLocale).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useLocale } from "next-intl"
import {
  AlertCircle,
  ChevronRight,
  FileText,
  Filter,
  RefreshCw,
} from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/intl/formatters"
import type { Locale } from "@/i18n/config"
import {
  type InvoiceDTOClient,
  type InvoiceStatus,
  INVOICE_STATUS_LABELS_FR,
  INVOICE_STATUS_VARIANT,
  formatAmount,
} from "@/lib/types/invoice-admin"
import { extractApiError } from "@/lib/ui/api-error"

type AsyncState = "idle" | "loading" | "success" | "error"

export function InvoicesListClient() {
  const locale = useLocale() as Locale
  const [invoices, setInvoices] = useState<InvoiceDTOClient[]>([])
  const [state, setState] = useState<AsyncState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<InvoiceStatus | "all">("all")
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const fetchSeqRef = useRef(0)

  const fetchInvoices = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++fetchSeqRef.current
    setState("loading")
    setErrorMessage(null)
    try {
      const params = new URLSearchParams()
      if (filterStatus !== "all") params.set("status", filterStatus)
      params.set("limit", "100")
      const url = `/api/billing/invoices?${params.toString()}`
      const res = await fetch(url, {
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
      const data = (await res.json()) as { items?: InvoiceDTOClient[]; nextCursor?: number }
      if (seq !== fetchSeqRef.current || !mountedRef.current) return
      setInvoices(data.items ?? [])
      setState("success")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (seq !== fetchSeqRef.current || !mountedRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [filterStatus])

  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchInvoices()
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchInvoices])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-1 text-sm">
          <Filter className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">Statut :</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as InvoiceStatus | "all")}
            className="rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
            aria-label="Filtrer par statut"
          >
            <option value="all">Tous</option>
            {Object.entries(INVOICE_STATUS_LABELS_FR).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchInvoices()}>
          <RefreshCw className="size-3.5 mr-1" aria-hidden="true" />
          Actualiser
        </DiabeoButton>
      </div>

      {state === "loading" && invoices.length === 0 && (
        <p className="text-sm text-muted-foreground" aria-live="polite">Chargement…</p>
      )}

      {state === "error" && invoices.length === 0 && (
        <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            Liste indisponible
          </p>
          {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
          <DiabeoButton variant="diabeoTertiary" size="sm" onClick={() => void fetchInvoices()} className="mt-2">
            Réessayer
          </DiabeoButton>
        </div>
      )}

      {state === "success" && invoices.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center">
          <FileText className="size-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Aucune facture enregistrée.</p>
        </div>
      )}

      {invoices.length > 0 && (
        <ul className="space-y-2" aria-label="Liste des factures">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="rounded-md border">
              <Link
                href={`/admin/invoices/${invoice.id}`}
                className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
              >
                <FileText className="size-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">
                      {invoice.number ?? `Brouillon #${invoice.id}`}
                    </span>
                    <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]} className="text-[10px]">
                      {INVOICE_STATUS_LABELS_FR[invoice.status]}
                    </Badge>
                    <span className="text-sm font-medium ml-auto">
                      {formatAmount(invoice.totalCents, invoice.currency, locale)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                    {invoice.issuedAt && (
                      <span>Émise le {formatDate(invoice.issuedAt, locale, { withTime: false })}</span>
                    )}
                    {invoice.patientId !== null && (
                      <span>Patient #{invoice.patientId}</span>
                    )}
                    <span>Cabinet #{invoice.cabinetId}</span>
                  </div>
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
