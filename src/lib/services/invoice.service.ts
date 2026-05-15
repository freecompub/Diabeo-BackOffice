/**
 * @module invoice.service
 * @description Groupe 7 Batch 1 — Service Facturation
 *   - US-2103 : facturation au patient (FR)
 *   - US-2105 : numérotation séquentielle pays (gap-less)
 *   - US-2107 : versioning facture immuable
 *
 * Machine d'états (validée DB + service) :
 *   draft     → issued | cancelled
 *   issued    → paid | cancelled
 *   paid      → refunded
 *   cancelled = terminal
 *   refunded  = terminal
 *
 * **Immuabilité post-issuance** : tous les champs financiers, l'identité
 * cabinet/patient, le numéro et les snapshots sont verrouillés au niveau
 * trigger PostgreSQL dès que `status <> 'draft'`. Toute tentative
 * d'UPDATE lève une `check_violation` Postgres (P2010 côté Prisma).
 *
 * **Audit US-2268** : `resourceId = invoice.id`, `metadata.patientId`
 * comme pivot lorsque la facture cible un patient — alimente
 * `auditService.getByPatient(patientId)` pour la forensique CNIL/ANS.
 */

import { Prisma } from "@prisma/client"
import type {
  InvoiceStatus,
  PaymentMethod,
  Invoice,
  InvoiceItem,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"
import { reserveNextInvoiceNumber } from "./invoice-numbering.service"

// ─────────────────────────────────────────────────────────────
// Types & erreurs
// ─────────────────────────────────────────────────────────────

export class InvoiceValidationError extends Error {
  constructor(public field: string) {
    super(field)
    this.name = "InvoiceValidationError"
  }
}

export class InvoiceAccessError extends Error {
  constructor(message = "forbidden") {
    super(message)
    this.name = "InvoiceAccessError"
  }
}

export class InvoiceStateError extends Error {
  constructor(public from: InvoiceStatus, public to: InvoiceStatus) {
    super(`invalid invoice transition: ${from} → ${to}`)
    this.name = "InvoiceStateError"
  }
}

export class InvoiceNotFoundError extends Error {
  constructor() {
    super("invoiceNotFound")
    this.name = "InvoiceNotFoundError"
  }
}

export interface DraftInvoiceItemInput {
  description: string
  quantity: number // décimal
  unitPriceCents: number
  /** Taux TVA fractionnaire (0.20 = 20%). */
  taxRate: number
  /** Optionnel : lie cette ligne à un acte téléconsultation existant. */
  teleconsultActeId?: number
}

export interface CreateDraftInput {
  cabinetId: number
  patientId?: number | null
  countryCode: string
  currency: string
  items: DraftInvoiceItemInput[]
}

export interface InvoiceDTO {
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
  issuedAt: Date | null
  paidAt: Date | null
  cancelledAt: Date | null
  refundedAt: Date | null
  createdBy: number
  createdAt: Date
}

export interface InvoiceWithItemsDTO extends InvoiceDTO {
  items: Array<{
    id: number
    description: string
    quantity: number
    unitPriceCents: number
    taxRate: number
    taxCents: number
    lineTotalCents: number
    teleconsultActeId: number | null
    position: number
  }>
}

// ─────────────────────────────────────────────────────────────
// Bornes & validation
// ─────────────────────────────────────────────────────────────

const INVOICE_BOUNDS = {
  MIN_ITEMS: 1,
  MAX_ITEMS: 100,
  MAX_UNIT_PRICE_CENTS: 10_000_00, // 10 000 € — bornes anti-coquille
  MAX_QUANTITY: 1000,
  MAX_DESCRIPTION_LEN: 500,
} as const

function toCents(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new InvoiceValidationError("amountNotFinite")
  }
  return Math.round(amount)
}

/**
 * Calcule le tax_cents et line_total_cents pour une ligne, en
 * appliquant la règle de bankers rounding (Math.round half-away-from-zero
 * acceptable pour des montants entiers positifs).
 *
 *   tax_cents       = round(quantity × unit_price × tax_rate)
 *   line_total_cents = round(quantity × unit_price) + tax_cents
 */
function computeLineAmounts(input: DraftInvoiceItemInput): {
  taxCents: number
  lineTotalCents: number
} {
  const subtotal = input.quantity * input.unitPriceCents
  const taxCents = toCents(subtotal * input.taxRate)
  const lineTotalCents = toCents(subtotal) + taxCents
  return { taxCents, lineTotalCents }
}

function validateDraft(input: CreateDraftInput): void {
  if (input.countryCode.length !== 2) {
    throw new InvoiceValidationError("countryCode")
  }
  if (input.currency.length !== 3) {
    throw new InvoiceValidationError("currency")
  }
  if (
    input.items.length < INVOICE_BOUNDS.MIN_ITEMS
    || input.items.length > INVOICE_BOUNDS.MAX_ITEMS
  ) {
    throw new InvoiceValidationError("items.count")
  }
  for (const [idx, item] of input.items.entries()) {
    if (!item.description || item.description.length > INVOICE_BOUNDS.MAX_DESCRIPTION_LEN) {
      throw new InvoiceValidationError(`items[${idx}].description`)
    }
    if (!(item.quantity > 0) || item.quantity > INVOICE_BOUNDS.MAX_QUANTITY) {
      throw new InvoiceValidationError(`items[${idx}].quantity`)
    }
    if (item.unitPriceCents < 0 || item.unitPriceCents > INVOICE_BOUNDS.MAX_UNIT_PRICE_CENTS) {
      throw new InvoiceValidationError(`items[${idx}].unitPriceCents`)
    }
    if (item.taxRate < 0 || item.taxRate > 1) {
      throw new InvoiceValidationError(`items[${idx}].taxRate`)
    }
  }
}

/**
 * Vérifie qu'une devise est valide pour un pays donné via
 * `CountryCurrency` (US-2113). Évite d'émettre une facture EUR avec
 * country_code=DZ par étourderie.
 */
async function assertCountrySupportsCurrency(
  tx: Prisma.TransactionClient,
  countryCode: string,
  currency: string,
): Promise<void> {
  const cc = countryCode.toUpperCase()
  const curr = currency.toUpperCase()
  const found = await tx.countryCurrency.findFirst({
    where: { countryCode: cc, currencyCode: curr, isActive: true },
    select: { id: true },
  })
  if (!found) {
    throw new InvoiceValidationError(`currencyNotSupportedFor:${cc}`)
  }
}

// ─────────────────────────────────────────────────────────────
// Mapping
// ─────────────────────────────────────────────────────────────

function toDTO(inv: Invoice): InvoiceDTO {
  return {
    id: inv.id,
    number: inv.number,
    countryCode: inv.countryCode,
    cabinetId: inv.cabinetId,
    patientId: inv.patientId,
    totalCents: inv.totalCents,
    taxCents: inv.taxCents,
    currency: inv.currency,
    status: inv.status,
    paymentMethod: inv.paymentMethod,
    issuedAt: inv.issuedAt,
    paidAt: inv.paidAt,
    cancelledAt: inv.cancelledAt,
    refundedAt: inv.refundedAt,
    createdBy: inv.createdBy,
    createdAt: inv.createdAt,
  }
}

function toDetailDTO(
  inv: Invoice & { items: InvoiceItem[] },
): InvoiceWithItemsDTO {
  return {
    ...toDTO(inv),
    items: inv.items
      .sort((a, b) => a.position - b.position)
      .map((it) => ({
        id: it.id,
        description: it.description,
        quantity: Number(it.quantity),
        unitPriceCents: it.unitPriceCents,
        taxRate: Number(it.taxRate),
        taxCents: it.taxCents,
        lineTotalCents: it.lineTotalCents,
        teleconsultActeId: it.teleconsultActeId,
        position: it.position,
      })),
  }
}

/**
 * Vérifie qu'un user est membre du cabinet émetteur. Utilisé sur tous
 * les write-paths comme defense-in-depth — l'ADMIN bypass est appliqué
 * au layer route via `requireRole`. Cabinet member check est ortho au
 * RBAC (un DOCTOR n'a pas accès aux factures d'un autre cabinet).
 */
async function assertCabinetMember(
  tx: Prisma.TransactionClient | typeof prisma,
  userId: number,
  cabinetId: number,
): Promise<void> {
  const link = await tx.healthcareMember.findFirst({
    where: { userId, serviceId: cabinetId },
    select: { id: true },
  })
  if (!link) throw new InvoiceAccessError("notCabinetMember")
}

/**
 * Lecture autorisée si :
 *   - ADMIN (toujours)
 *   - membre du cabinet émetteur
 *   - patient cible (VIEWER consultant sa propre facture)
 */
async function canReadInvoice(
  userId: number,
  role: string,
  invoice: { cabinetId: number; patientId: number | null },
): Promise<boolean> {
  if (role === "ADMIN") return true
  if (role === "VIEWER") {
    if (!invoice.patientId) return false
    const patient = await prisma.patient.findFirst({
      where: { id: invoice.patientId, userId, deletedAt: null },
      select: { id: true },
    })
    return !!patient
  }
  const link = await prisma.healthcareMember.findFirst({
    where: { userId, serviceId: invoice.cabinetId },
    select: { id: true },
  })
  return !!link
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const invoiceService = {
  /** Re-exporté pour les routes API qui scopent la lecture. */
  canReadInvoice,

  /**
   * Crée une facture en draft. Les montants sont calculés en service
   * pour être canoniques (et empêcher un client malveillant de pousser
   * un `total_cents` qui ne correspond pas à la somme des lignes).
   */
  async createDraft(
    input: CreateDraftInput,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<InvoiceDTO> {
    validateDraft(input)

    return prisma.$transaction(async (tx) => {
      await assertCabinetMember(tx, auditUserId, input.cabinetId)
      await assertCountrySupportsCurrency(tx, input.countryCode, input.currency)

      const itemRows = input.items.map((item, position) => {
        const amounts = computeLineAmounts(item)
        return {
          description: item.description,
          quantity: new Prisma.Decimal(item.quantity),
          unitPriceCents: item.unitPriceCents,
          taxRate: new Prisma.Decimal(item.taxRate),
          taxCents: amounts.taxCents,
          lineTotalCents: amounts.lineTotalCents,
          teleconsultActeId: item.teleconsultActeId ?? null,
          position,
        }
      })

      const totalCents = itemRows.reduce((s, r) => s + r.lineTotalCents, 0)
      const taxCents = itemRows.reduce((s, r) => s + r.taxCents, 0)

      const invoice = await tx.invoice.create({
        data: {
          countryCode: input.countryCode.toUpperCase(),
          cabinetId: input.cabinetId,
          patientId: input.patientId ?? null,
          totalCents,
          taxCents,
          currency: input.currency.toUpperCase(),
          status: "draft",
          createdBy: auditUserId,
          items: { create: itemRows },
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "INVOICE",
        resourceId: String(invoice.id),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          ...(input.patientId ? { patientId: input.patientId } : {}),
          kind: "invoice.draft.create",
          cabinetId: input.cabinetId,
          itemCount: itemRows.length,
          totalCents,
          currency: input.currency.toUpperCase(),
        },
      })

      return toDTO(invoice)
    })
  },

  /**
   * Émet une facture : passe `draft → issued`, assigne le numéro
   * séquentiel et fige les snapshots immuables (cabinet + patient).
   *
   * **AC-3** : numérotation gap-less garantie via `reserveNextInvoiceNumber`
   * dans la transaction.
   */
  async issue(
    invoiceId: number,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<InvoiceDTO> {
    return prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId } })
      if (!inv) throw new InvoiceNotFoundError()
      await assertCabinetMember(tx, auditUserId, inv.cabinetId)
      if (inv.status !== "draft") {
        throw new InvoiceStateError(inv.status, "issued")
      }

      const now = new Date()
      const year = now.getUTCFullYear()
      const number = await reserveNextInvoiceNumber(tx, inv.countryCode, year)

      // Snapshot cabinet (immutable).
      const cabinet = await tx.healthcareService.findUnique({
        where: { id: inv.cabinetId },
        select: {
          name: true, establishment: true,
          addressLine1: true, addressLine2: true,
          postalCode: true, city: true, country: true,
          phone: true, email: true,
        },
      })
      // Snapshot patient (sans PHI déchiffrée — seulement l'ID).
      const customerSnapshot = inv.patientId
        ? { patientRef: `patient#${inv.patientId}` }
        : null

      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: "issued",
          number,
          issuedAt: now,
          issuerSnapshot: (cabinet ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          customerSnapshot: (customerSnapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "INVOICE",
        resourceId: String(invoiceId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          ...(inv.patientId ? { patientId: inv.patientId } : {}),
          kind: "invoice.issue",
          number,
          totalCents: updated.totalCents,
          currency: updated.currency,
        },
      })

      return toDTO(updated)
    })
  },

  /**
   * Marque une facture comme payée. `issued → paid`.
   */
  async markPaid(
    invoiceId: number,
    paymentMethod: PaymentMethod,
    auditUserId: number,
    ctx?: AuditContext,
    stripePaymentIntentId?: string,
  ): Promise<InvoiceDTO> {
    return prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId } })
      if (!inv) throw new InvoiceNotFoundError()
      await assertCabinetMember(tx, auditUserId, inv.cabinetId)
      if (inv.status !== "issued") {
        throw new InvoiceStateError(inv.status, "paid")
      }

      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: "paid",
          paidAt: new Date(),
          paymentMethod,
          ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "INVOICE",
        resourceId: String(invoiceId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          ...(inv.patientId ? { patientId: inv.patientId } : {}),
          kind: "invoice.markPaid",
          paymentMethod,
        },
      })

      return toDTO(updated)
    })
  },

  /**
   * Annule une facture. `draft → cancelled` ou `issued → cancelled`.
   * Un patient `paid` ne peut plus être cancelled — il faut un refund.
   */
  async cancel(
    invoiceId: number,
    reason: string | null,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<InvoiceDTO> {
    return prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId } })
      if (!inv) throw new InvoiceNotFoundError()
      await assertCabinetMember(tx, auditUserId, inv.cabinetId)
      if (inv.status !== "draft" && inv.status !== "issued") {
        throw new InvoiceStateError(inv.status, "cancelled")
      }

      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: "cancelled", cancelledAt: new Date() },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "INVOICE",
        resourceId: String(invoiceId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          ...(inv.patientId ? { patientId: inv.patientId } : {}),
          kind: "invoice.cancel",
          previousStatus: inv.status,
          ...(reason ? { reason: reason.slice(0, 200) } : {}),
        },
      })

      return toDTO(updated)
    })
  },

  /**
   * Lecture détaillée (avec items). Audit READ.
   */
  async getById(
    invoiceId: number,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<InvoiceWithItemsDTO | null> {
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true },
    })
    if (!inv) return null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "INVOICE",
      resourceId: String(invoiceId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        ...(inv.patientId ? { patientId: inv.patientId } : {}),
        kind: "invoice.read",
      },
    })

    return toDetailDTO(inv)
  },

  /**
   * Liste les factures émises par un cabinet, filtrable par status.
   * Pagination cursor-based simple par `id` desc.
   */
  async listByCabinet(
    cabinetId: number,
    options: { status?: InvoiceStatus; limit?: number; cursor?: number } = {},
    auditUserId?: number,
    ctx?: AuditContext,
  ): Promise<InvoiceDTO[]> {
    const limit = Math.min(options.limit ?? 50, 200)
    const rows = await prisma.invoice.findMany({
      where: {
        cabinetId,
        ...(options.status ? { status: options.status } : {}),
      },
      orderBy: { id: "desc" },
      take: limit,
      ...(options.cursor ? { skip: 1, cursor: { id: options.cursor } } : {}),
    })

    if (auditUserId) {
      await auditService.log({
        userId: auditUserId,
        action: "READ",
        resource: "INVOICE",
        resourceId: String(cabinetId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          kind: "invoice.listByCabinet",
          cabinetId,
          count: rows.length,
          ...(options.status ? { statusFilter: options.status } : {}),
        },
      })
    }

    return rows.map(toDTO)
  },

  /**
   * Liste les factures liées à un patient. Inclut `metadata.patientId`
   * dans l'audit pour US-2268 forensics.
   */
  async listByPatient(
    patientId: number,
    options: { limit?: number; cursor?: number } = {},
    auditUserId?: number,
    ctx?: AuditContext,
  ): Promise<InvoiceDTO[]> {
    const limit = Math.min(options.limit ?? 50, 200)
    const rows = await prisma.invoice.findMany({
      where: { patientId },
      orderBy: { id: "desc" },
      take: limit,
      ...(options.cursor ? { skip: 1, cursor: { id: options.cursor } } : {}),
    })

    if (auditUserId) {
      await auditService.log({
        userId: auditUserId,
        action: "READ",
        resource: "INVOICE",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          patientId,
          kind: "invoice.listByPatient",
          count: rows.length,
        },
      })
    }

    return rows.map(toDTO)
  },
}
