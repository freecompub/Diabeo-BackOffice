"use client"

/**
 * InvoiceDetailClient — UI ADMIN détail facture + génération/téléchargement PDF.
 *
 * Backend :
 *   - GET `/api/billing/invoices/[id]` → InvoiceWithItemsDTO
 *   - POST `/api/billing/invoices/[id]/pdf` → génère + retourne pdfUrl/pdfHash
 *   - GET `/api/billing/invoices/[id]/pdf` → stream PDF (application/pdf)
 *
 * Pattern aligné iter 1-3 PR #457-#459 round 1 fixes.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/intl/formatters"
import type { Locale } from "@/i18n/config"
import {
  type InvoiceWithItemsDTOClient,
  getInvoiceStatusLabel,
  getInvoiceStatusVariant,
  getPaymentMethodLabel,
  formatAmount,
} from "@/lib/types/invoice-admin"
import { extractApiError } from "@/lib/ui/api-error"

type AsyncState = "idle" | "loading" | "saving" | "success" | "error"

export function InvoiceDetailClient({ invoiceId }: { invoiceId: number }) {
  const locale = useLocale() as Locale
  const t = useTranslations("invoiceDetail")
  const [invoice, setInvoice] = useState<InvoiceWithItemsDTOClient | null>(null)
  const [state, setState] = useState<AsyncState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pdfGenState, setPdfGenState] = useState<AsyncState>("idle")
  const [pdfError, setPdfError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  const fetchInvoice = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setInvoice(null)
    setState("loading")
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/billing/invoices/${invoiceId}`, {
        credentials: "include",
        signal: controller.signal,
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        setState("error")
        const parsed = await extractApiError(res)
        setErrorMessage(parsed.message)
        return
      }
      const data = (await res.json()) as { invoice?: InvoiceWithItemsDTOClient }
      if (!mountedRef.current) return
      if (data.invoice) setInvoice(data.invoice)
      setState("success")
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      if (!mountedRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : t("networkError"))
    }
  }, [invoiceId, t])

  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchInvoice()
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchInvoice])

  /**
   * Génère le PDF côté backend (idempotent si déjà généré). Sur succès,
   * l'utilisateur peut télécharger via le lien GET stream.
   */
  const generatePdf = useCallback(async () => {
    setPdfGenState("saving")
    setPdfError(null)
    try {
      const res = await fetch(`/api/billing/invoices/${invoiceId}/pdf`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        setPdfGenState("error")
        const parsed = await extractApiError(res)
        setPdfError(parsed.message)
        return
      }
      setPdfGenState("success")
    } catch (err) {
      if (!mountedRef.current) return
      setPdfGenState("error")
      setPdfError(err instanceof Error ? err.message : t("networkError"))
    }
  }, [invoiceId, t])

  if (state === "loading" && !invoice) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        {t("loading")}
      </div>
    )
  }

  if (state === "error" || !invoice) {
    // Fix M4 round 1 review PR #460 — focus management role=alert via
    // tabindex=-1 + ref autofocus pour SR / clavier ne rate pas le message.
    return (
      <div
        role="alert"
        tabIndex={-1}
        ref={(el) => { el?.focus() }}
        className="rounded-md border border-destructive/20 bg-destructive/10 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
      >
        <p className="font-medium text-destructive flex items-center gap-2">
          <AlertCircle className="size-4" aria-hidden="true" />
          {t("loadError")}
        </p>
        {errorMessage && <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>}
        <Link
          href="/admin/invoices"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("backToList")}
        </Link>
      </div>
    )
  }

  const canDownload = invoice.status !== "draft"
  // Fix M1 round 1 — utilise subtotalCents canonique backend (vs recalcul
  // client `totalCents - taxCents` qui dérivait si remises ligne).
  const subtotalCents = invoice.subtotalCents

  return (
    <>
      <nav aria-label={t("breadcrumbLabel")}>
        <Link
          href="/admin/invoices"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("backToList")}
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FileText className="size-6" aria-hidden="true" />
          {invoice.number ?? t("draftTitle", { id: invoice.id })}
        </h1>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <Badge variant={getInvoiceStatusVariant(invoice.status)}>
            {getInvoiceStatusLabel(invoice.status)}
          </Badge>
          <Badge variant="outline">{invoice.countryCode}</Badge>
        </div>
      </header>

      {/* PDF action */}
      <section
        className="rounded-md border p-4 space-y-3"
        aria-labelledby="pdf-section"
        aria-describedby={!canDownload ? "pdf-disabled-help" : undefined}
      >
        <h2 id="pdf-section" className="text-lg font-semibold">{t("pdfSectionTitle")}</h2>
        {!canDownload ? (
          // Fix M6 round 1 — aria-describedby pointe vers explication state disabled.
          <p id="pdf-disabled-help" className="text-sm text-muted-foreground">
            {t("pdfUnavailable")}
          </p>
        ) : (
          <div className="flex items-center flex-wrap gap-3">
            <DiabeoButton variant="diabeoTertiary" onClick={() => void generatePdf()} disabled={pdfGenState === "saving"}>
              <RefreshCw className="size-4 mr-1" aria-hidden="true" />
              {pdfGenState === "saving" ? t("pdfGenerating") : t("pdfRegenerate")}
            </DiabeoButton>
            {/* Fix H1 + H4 round 1 review PR #460 :
                - `referrerPolicy="no-referrer"` : pas de leak ID séquentiel via Referer
                - `aria-label` : indique "nouvel onglet" WCAG 3.2.5 Change on Request
                Backend (PR #414) renvoie déjà Cache-Control: no-store + Content-Disposition. */}
            <a
              href={`/api/billing/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-label={t("pdfDownloadAriaLabel", {
                number: invoice.number ?? t("draftTitle", { id: invoice.id }),
              })}
              className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
            >
              <Download className="size-4" aria-hidden="true" />
              {t("pdfDownload")}
              <span aria-hidden="true" className="text-xs opacity-75 ml-0.5">{t("newTab")}</span>
            </a>
          </div>
        )}
        {pdfGenState === "success" && (
          <div role="status" aria-live="polite" className="rounded-md border border-primary/20 bg-primary/5 p-2 text-sm">
            <p className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {t("pdfSuccess")}
            </p>
          </div>
        )}
        {pdfGenState === "error" && pdfError && (
          <p role="alert" className="text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="size-4" aria-hidden="true" />
            {pdfError}
          </p>
        )}
      </section>

      {/* Détails */}
      <section className="rounded-md border p-4 space-y-3" aria-labelledby="detail-section">
        <h2 id="detail-section" className="text-lg font-semibold">{t("detailsSectionTitle")}</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <Field label={t("fieldCabinet")}>#{invoice.cabinetId}</Field>
          {invoice.patientId !== null && (
            <Field label={t("fieldPatient")}>#{invoice.patientId}</Field>
          )}
          <Field label={t("fieldCurrency")}>{invoice.currency}</Field>
          <Field label={t("fieldCountry")}>{invoice.countryCode}</Field>
          {invoice.paymentMethod && (
            <Field label={t("fieldPaymentMethod")}>
              {getPaymentMethodLabel(invoice.paymentMethod)}
            </Field>
          )}
          {invoice.issuedAt && (
            <Field label={t("fieldIssuedAt")}>{formatDate(invoice.issuedAt, locale, { withTime: true })}</Field>
          )}
          {invoice.paidAt && (
            <Field label={t("fieldPaidAt")}>{formatDate(invoice.paidAt, locale, { withTime: true })}</Field>
          )}
          {invoice.cancelledAt && (
            <Field label={t("fieldCancelledAt")}>{formatDate(invoice.cancelledAt, locale, { withTime: true })}</Field>
          )}
          {invoice.refundedAt && (
            <Field label={t("fieldRefundedAt")}>{formatDate(invoice.refundedAt, locale, { withTime: true })}</Field>
          )}
          <Field label={t("fieldCreatedBy")}>{t("userRef", { id: invoice.createdBy })}</Field>
          <Field label={t("fieldCreatedAt")}>{formatDate(invoice.createdAt, locale, { withTime: true })}</Field>
        </dl>
      </section>

      {/* Lignes facture */}
      <section className="rounded-md border p-4 space-y-3" aria-labelledby="items-section">
        <h2 id="items-section" className="text-lg font-semibold">{t("linesSectionTitle")}</h2>
        {invoice.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noLines")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                {/* Fix C1 + A11y CRITICAL round 1 review PR #460 — scope="col"
                    pour mapping screen-reader headers→cellules (WCAG 1.3.1). */}
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">{t("colDescription")}</th>
                  <th scope="col" className="py-2 px-3 font-medium text-right">{t("colQty")}</th>
                  <th scope="col" className="py-2 px-3 font-medium text-right">{t("colUnitPriceExTax")}</th>
                  <th scope="col" className="py-2 px-3 font-medium text-right">{t("colTax")}</th>
                  <th scope="col" className="py-2 pl-3 font-medium text-right">{t("colTotalInclTax")}</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{item.description}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{item.quantity}</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {formatAmount(item.unitPriceCents, invoice.currency, locale)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {(item.taxRate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums font-medium">
                      {formatAmount(item.lineTotalCents, invoice.currency, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {/* Fix C1 round 1 — <th scope="row"> sur labels totaux pour
                    SR mapping (les chiffres totaux sont la ligne associée). */}
                <tr className="border-t-2">
                  <th scope="row" colSpan={3} className="py-2 pr-3 text-right font-medium text-muted-foreground">
                    {t("subtotalExTax")}
                  </th>
                  <td colSpan={2} className="py-2 pl-3 text-right tabular-nums">
                    {formatAmount(subtotalCents, invoice.currency, locale)}
                  </td>
                </tr>
                <tr>
                  <th scope="row" colSpan={3} className="py-2 pr-3 text-right font-medium text-muted-foreground">
                    {t("taxAmount")}
                  </th>
                  <td colSpan={2} className="py-2 pl-3 text-right tabular-nums">
                    {formatAmount(invoice.taxCents, invoice.currency, locale)}
                  </td>
                </tr>
                <tr className="border-t">
                  <th scope="row" colSpan={3} className="py-2 pr-3 text-right font-semibold">
                    {t("totalInclTax")}
                  </th>
                  <td colSpan={2} className="py-2 pl-3 text-right tabular-nums font-semibold">
                    {formatAmount(invoice.totalCents, invoice.currency, locale)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
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
