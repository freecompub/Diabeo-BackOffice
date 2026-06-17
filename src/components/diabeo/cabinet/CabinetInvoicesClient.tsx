"use client"

/**
 * US-2606 — Vue cabinet « Facturation » / « Paiements » (bloc gestion Q2).
 *
 * Lecture seule V1 : liste les factures du cabinet via `/api/billing/invoices?
 * cabinetId=…` (service `invoiceService.listByCabinet`, gated membre cabinet /
 * `ADMIN`). Deux modes, même source :
 *  - `billing`  : toutes les factures (registre de facturation) ;
 *  - `payments` : factures **encaissées** uniquement (`status=paid`).
 *
 * **Aucune donnée de santé** : on affiche une référence patient (`#id`), jamais
 * de PII déchiffrée ni de dossier clinique (axe Q2 = PII admin / financier).
 * Montants et dates localisés (FR/EN/AR) via `@/lib/intl/formatters`.
 */

import { useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import type { Locale } from "@/i18n/config"
import { formatCurrency, formatDate } from "@/lib/intl/formatters"
import { extractApiError } from "@/lib/ui/api-error"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { Badge } from "@/components/ui/badge"

export type InvoiceMode = "billing" | "payments"

type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled" | "refunded"

type InvoiceRow = {
  id: number
  number: string | null
  patientId: number | null
  totalCents: number
  currency: string
  status: InvoiceStatus
  issuedAt: string | null
  paidAt: string | null
  createdAt: string
}

type AsyncState = "loading" | "ready" | "error"

/** Couleur sémantique du statut (design system — jamais de Tailwind brut). */
const STATUS_BADGE: Record<InvoiceStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-feedback-info-bg text-feedback-info",
  paid: "bg-feedback-success-bg text-feedback-success",
  cancelled: "bg-muted text-muted-foreground",
  refunded: "bg-feedback-warning-bg text-feedback-warning",
}

export function CabinetInvoicesClient({
  cabinetId,
  mode,
}: {
  cabinetId: number
  mode: InvoiceMode
}) {
  const t = useTranslations("cabinetMgmt")
  const locale = useLocale() as Locale
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // 4xx (403/404…) = erreur d'autorisation/déterministe → réessayer est inutile
  // (boucle). On n'offre « Réessayer » que sur 5xx / erreurs réseau (transitoires).
  const [retryable, setRetryable] = useState(false)
  // `reloadKey` re-déclenche l'effet sur « réessayer » sans setState synchrone
  // dans l'effet (pattern canonique React : tout setState après l'await).
  const [reloadKey, setReloadKey] = useState(0)

  // Dépendance d'effet stable : on capture le message de repli (string stable)
  // plutôt que `t` (référence recréée à chaque render → refetch en boucle).
  const loadErrorMessage = t("loadError")

  useEffect(() => {
    const controller = new AbortController()
    let ignore = false
    ;(async () => {
      try {
        const params = new URLSearchParams({ cabinetId: String(cabinetId) })
        // Mode paiements : seules les factures encaissées (encaissements).
        if (mode === "payments") params.set("status", "paid")
        const res = await fetch(`/api/billing/invoices?${params.toString()}`, {
          credentials: "include",
          signal: controller.signal,
        })
        if (ignore) return
        if (!res.ok) {
          setErrorMessage((await extractApiError(res)).message)
          // 4xx → non rejouable ; 5xx → transitoire, on autorise « Réessayer ».
          setRetryable(res.status >= 500)
          setState("error")
          return
        }
        const data = (await res.json()) as { items?: InvoiceRow[] }
        if (ignore) return
        setRows(data.items ?? [])
        setState("ready")
      } catch (err) {
        if (ignore || controller.signal.aborted) return
        setErrorMessage(err instanceof Error ? err.message : loadErrorMessage)
        setRetryable(true) // erreur réseau → transitoire
        setState("error")
      }
    })()
    return () => {
      ignore = true
      controller.abort()
    }
  }, [cabinetId, mode, reloadKey, loadErrorMessage])

  const retry = () => {
    setState("loading")
    setErrorMessage(null)
    setReloadKey((k) => k + 1)
  }

  const titleKey = mode === "billing" ? "billingTitle" : "paymentsTitle"
  const subtitleKey = mode === "billing" ? "billingSubtitle" : "paymentsSubtitle"

  return (
    <section className="flex flex-col gap-6" aria-busy={state === "loading"}>
      <header>
        <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(subtitleKey)}</p>
      </header>

      {state === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("loading")}
        </p>
      )}

      {state === "error" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <span>{errorMessage ?? t("loadError")}</span>
          {retryable && (
            <button
              type="button"
              onClick={retry}
              className="inline-flex min-h-11 items-center rounded-md border border-destructive/40 px-3 py-2 font-medium hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            >
              {t("retry")}
            </button>
          )}
        </div>
      )}

      {state === "ready" && rows.length === 0 && (
        <DiabeoEmptyState
          variant="noData"
          title={t("invoicesEmptyTitle")}
          message={mode === "billing" ? t("billingEmptyMessage") : t("paymentsEmptyMessage")}
        />
      )}

      {state === "ready" && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-start text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 text-start">{t("colNumber")}</th>
                <th scope="col" className="px-4 py-2 text-start">{t("colPatient")}</th>
                <th scope="col" className="px-4 py-2 text-end">{t("colAmount")}</th>
                <th scope="col" className="px-4 py-2 text-start">{t("colStatus")}</th>
                <th scope="col" className="px-4 py-2 text-start">
                  {mode === "payments" ? t("colPaidAt") : t("colDate")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => {
                const dateValue = mode === "payments" ? inv.paidAt : (inv.issuedAt ?? inv.createdAt)
                return (
                  <tr key={inv.id} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{inv.number ?? `#${inv.id}`}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {inv.patientId != null ? `#${inv.patientId}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums">
                      {formatCurrency(inv.totalCents / 100, locale, { currency: inv.currency })}
                    </td>
                    <td className="px-4 py-2">
                      <Badge className={STATUS_BADGE[inv.status]}>{t(`status_${inv.status}`)}</Badge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {dateValue ? formatDate(dateValue, locale, { style: "medium" }) : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
