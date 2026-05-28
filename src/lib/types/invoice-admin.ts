/**
 * Types partagés pour US-2102 (Invoice PDF) + US-2108 (Invoice reminders) UI.
 *
 * Pattern aligné PR #457/#458/#459 (`src/lib/types/*-admin.ts`).
 * Backend DTOs : `invoice.service.ts:InvoiceDTO/InvoiceWithItemsDTO`.
 */

export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled" | "refunded"
export type PaymentMethod = "stripe" | "bank_transfer" | "cash" | "other"

export interface InvoiceDTOClient {
  id: number
  number: string | null
  countryCode: string
  cabinetId: number
  patientId: number | null
  totalCents: number
  taxCents: number
  currency: string
  status: InvoiceStatus
  paymentMethod: PaymentMethod | null
  issuedAt: string | null // ISO 8601 from JSON
  paidAt: string | null
  cancelledAt: string | null
  refundedAt: string | null
  createdBy: number
  createdAt: string
}

export interface InvoiceItemDTOClient {
  id: number
  description: string
  quantity: number
  unitPriceCents: number
  taxRate: number
  taxCents: number
  lineTotalCents: number
  teleconsultActeId: number | null
  position: number
}

export interface InvoiceWithItemsDTOClient extends InvoiceDTOClient {
  items: InvoiceItemDTOClient[]
}

export const INVOICE_STATUS_LABELS_FR: Record<InvoiceStatus, string> = {
  draft: "Brouillon",
  issued: "Émise",
  paid: "Payée",
  cancelled: "Annulée",
  refunded: "Remboursée",
}

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

export const INVOICE_STATUS_VARIANT: Record<InvoiceStatus, BadgeVariant> = {
  draft: "secondary",
  issued: "outline",
  paid: "default",
  cancelled: "destructive",
  refunded: "destructive",
}

export const PAYMENT_METHOD_LABELS_FR: Record<PaymentMethod, string> = {
  stripe: "Carte (Stripe)",
  bank_transfer: "Virement bancaire",
  cash: "Espèces",
  other: "Autre",
}

/**
 * Formate cents → euros lisible (1234 cents → "12,34 €").
 * Cents-only stocké backend pour éviter floating point. Locale-aware
 * via `Intl.NumberFormat` côté caller.
 */
export function formatAmount(
  cents: number,
  currency: string,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(cents / 100)
}
