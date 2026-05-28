/**
 * Types partagés pour US-2102 (Invoice PDF) + US-2108 (Invoice reminders) UI.
 *
 * Pattern aligné PR #457/#458/#459 (`src/lib/types/*-admin.ts`).
 * Backend DTOs : `invoice.service.ts:InvoiceDTO/InvoiceWithItemsDTO`.
 *
 * Fixes round 1 review PR #460 :
 *   - M1 : `subtotalCents` exposé serveur (UI ne recalcule plus)
 *   - H2 : `formatAmount` currency minor units via Intl.NumberFormat
 *     `resolvedOptions().maximumFractionDigits` (gère JPY/KRW 0 décimale,
 *     TND/BHD 3 décimales — pas hardcoded /100)
 *   - M2 : `getInvoiceStatusLabel` + `getPaymentMethodLabel` helpers avec
 *     warning dev si drift backend (cohérent fix L1 PR #459 ServiceType)
 */

export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled" | "refunded"
export type PaymentMethod = "stripe" | "bank_transfer" | "cash" | "other"

const INVOICE_STATUSES: ReadonlySet<InvoiceStatus> = new Set([
  "draft", "issued", "paid", "cancelled", "refunded",
])

const PAYMENT_METHODS: ReadonlySet<PaymentMethod> = new Set([
  "stripe", "bank_transfer", "cash", "other",
])

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === "string" && INVOICE_STATUSES.has(value as InvoiceStatus)
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && PAYMENT_METHODS.has(value as PaymentMethod)
}

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
  /** Fix M1 round 1 — serveur-canonique (DGFiP). */
  subtotalCents: number
}

// ─────────────────────────────────────────────────────────────
// Labels FR + variants
// ─────────────────────────────────────────────────────────────

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
 * Fix M2 round 1 — defense-in-depth + warning dev si backend ajoute
 * un statut sans mise à jour UI (cohérent pattern PR #459 ServiceType).
 */
export function getInvoiceStatusLabel(status: InvoiceStatus | string): string {
  if (isInvoiceStatus(status)) return INVOICE_STATUS_LABELS_FR[status]
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[invoice-admin] Unknown InvoiceStatus: ${status}`)
  }
  return status
}

export function getPaymentMethodLabel(method: PaymentMethod | string): string {
  if (isPaymentMethod(method)) return PAYMENT_METHOD_LABELS_FR[method]
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[invoice-admin] Unknown PaymentMethod: ${method}`)
  }
  return method
}

export function getInvoiceStatusVariant(status: InvoiceStatus | string): BadgeVariant {
  if (isInvoiceStatus(status)) return INVOICE_STATUS_VARIANT[status]
  return "outline" // safe fallback
}

// ─────────────────────────────────────────────────────────────
// formatAmount — currency-aware minor units
// ─────────────────────────────────────────────────────────────

/**
 * Fix H2 round 1 review PR #460 — `Intl.NumberFormat` avec
 * `resolvedOptions().minimumFractionDigits` détecte automatiquement le
 * nombre de chiffres après la virgule pour la devise (0 pour JPY/KRW,
 * 2 pour EUR/USD, 3 pour TND/BHD).
 *
 * Backend stocke en unité minimale de la devise (EUR cents, JPY yen,
 * TND millicents) — diviseur calculé dynamiquement.
 *
 * Fix L7 round 1 — try/catch fallback si devise inconnue (sinon
 * Intl.NumberFormat throw RangeError crash UI).
 */
export function formatAmount(
  minorUnits: number,
  currency: string,
  locale: string,
): string {
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    })
    const fractionDigits = formatter.resolvedOptions().minimumFractionDigits ?? 2
    const divisor = Math.pow(10, fractionDigits)
    return formatter.format(minorUnits / divisor)
  } catch {
    // Devise invalide / non supportée par Intl → fallback affichage brut.
    return `${minorUnits} ${currency}`
  }
}
