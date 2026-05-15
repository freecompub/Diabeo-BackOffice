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
 *
 * **Arrondi monétaire** (review PR #406 M2/M3) : ligne-à-ligne, half-
 * away-from-zero via `Math.round` (positif uniquement). La somme des
 * `line_total_cents` peut diverger de 1-2 cents vs un calcul TTC global
 * — méthode admise comptablement, documentée ici.
 */

import { Prisma } from "@prisma/client"
import type {
  InvoiceStatus,
  PaymentMethod,
  Invoice,
  InvoiceItem,
  Role,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { decrypt } from "@/lib/crypto/health-data"
import { auditService, type AuditContext } from "./audit.service"
import { reserveNextInvoiceNumber } from "./invoice-numbering.service"

// ─────────────────────────────────────────────────────────────
// Erreurs typées
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

// Re-export pour les routes (mapping HTTP 409).
export { InvoiceSequenceOverflowError } from "./invoice-numbering.service"

// ─────────────────────────────────────────────────────────────
// Bornes & types
// ─────────────────────────────────────────────────────────────

/**
 * Bornes anti-coquille appliquées par le service ET par Zod côté route.
 * M4 (review PR #406) — bornes resserrées (max facture 100 000 €).
 * M5 (review PR #406) — partage Zod/service via export.
 */
export const INVOICE_BOUNDS = {
  MIN_ITEMS: 1,
  MAX_ITEMS: 100,
  MAX_UNIT_PRICE_CENTS: 100_000_00, // 100 000 € — sur-bornage anti-coquille
  MAX_QUANTITY: 1000,
  MAX_DESCRIPTION_LEN: 500,
  MAX_TOTAL_CENTS: 10_000_000_00, // 10 M€ par facture max (sécurité)
  MAX_CANCEL_REASON_LEN: 200,
} as const

export interface DraftInvoiceItemInput {
  description: string
  quantity: number
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
// Helpers internes
// ─────────────────────────────────────────────────────────────

function toCents(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new InvoiceValidationError("amountNotFinite")
  }
  // M3 (review PR #406) — `Math.round` JS = half-away-from-zero pour
  // valeurs positives (banque-friendly suffisant pour cents ≥ 0).
  return Math.round(amount)
}

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
 * H2 (review PR #406) — vérifie que le pays facturé correspond bien
 * au pays du cabinet (anti-évasion fiscale + cohérence comptable) ET
 * que la devise est supportée par ce pays (via CountryCurrency US-2113).
 */
async function assertCountryCurrencyAndCabinetMatch(
  tx: Prisma.TransactionClient,
  cabinetId: number,
  countryCode: string,
  currency: string,
): Promise<void> {
  const cc = countryCode.toUpperCase()
  const curr = currency.toUpperCase()

  const cabinet = await tx.healthcareService.findUnique({
    where: { id: cabinetId },
    select: { country: true },
  })
  if (!cabinet) {
    throw new InvoiceValidationError("cabinetNotFound")
  }
  if (cabinet.country && cabinet.country.toUpperCase() !== cc) {
    throw new InvoiceValidationError(`countryMismatchCabinet:${cabinet.country}`)
  }

  const supported = await tx.countryCurrency.findFirst({
    where: { countryCode: cc, currencyCode: curr, isActive: true },
    select: { id: true },
  })
  if (!supported) {
    throw new InvoiceValidationError(`currencyNotSupportedFor:${cc}`)
  }
}

/**
 * Defense-in-depth : vérifie que `userId` est bien membre actif du
 * cabinet. H1 (review PR #406) : `HealthcareMember` n'a pas de champ
 * `status` / `active` au schéma actuel → on filtre uniquement sur le
 * lien existant. Un follow-up V1 introduira la suspension explicite.
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
 * Décrypte un champ AES-256-GCM sans throw (renvoie null en cas d'erreur,
 * cohérent avec `safeDecryptField` de `user.service.ts`).
 */
function safeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return decrypt(new Uint8Array(Buffer.from(value, "base64")))
  } catch {
    return null
  }
}

/**
 * Construit le snapshot cabinet (US-2107 + H3 review).
 *
 * Champs inclus :
 *   - identité : name, establishment, addressLine1/2, postalCode, city, country
 *   - contact  : phone, email
 *   - mentions légales FR : siret, tvaIntra, iban, licenseNumber
 *
 * Le snapshot est figé au moment de l'issuance (trigger PG) → si le
 * cabinet change d'adresse plus tard, les anciennes factures conservent
 * l'ancienne adresse (obligation comptable).
 *
 * **Pré-condition** : si pays = FR, `siret` est obligatoire pour
 * conformité art. 242 nonies A CGI. Sinon, l'issue throw.
 */
async function buildIssuerSnapshot(
  tx: Prisma.TransactionClient,
  cabinetId: number,
  countryCode: string,
): Promise<Prisma.JsonObject> {
  const cabinet = await tx.healthcareService.findUnique({
    where: { id: cabinetId },
    select: {
      name: true, establishment: true,
      addressLine1: true, addressLine2: true,
      postalCode: true, city: true, country: true,
      phone: true, email: true,
      siret: true, tvaIntra: true, iban: true,
      licenseNumber: true,
    },
  })
  // H7 (review PR #406) — garantit non-null avant snapshot.
  if (!cabinet) {
    throw new InvoiceValidationError("cabinetNotFound")
  }

  // H3 (review PR #406) — conformité comptable FR :
  // SIRET obligatoire pour facture émise sous juridiction FR.
  if (countryCode.toUpperCase() === "FR" && !cabinet.siret) {
    throw new InvoiceValidationError("cabinetSiretRequiredForFR")
  }

  return {
    name: cabinet.name,
    ...(cabinet.establishment ? { establishment: cabinet.establishment } : {}),
    ...(cabinet.addressLine1 ? { addressLine1: cabinet.addressLine1 } : {}),
    ...(cabinet.addressLine2 ? { addressLine2: cabinet.addressLine2 } : {}),
    ...(cabinet.postalCode ? { postalCode: cabinet.postalCode } : {}),
    ...(cabinet.city ? { city: cabinet.city } : {}),
    ...(cabinet.country ? { country: cabinet.country } : {}),
    ...(cabinet.phone ? { phone: cabinet.phone } : {}),
    ...(cabinet.email ? { email: cabinet.email } : {}),
    ...(cabinet.siret ? { siret: cabinet.siret } : {}),
    ...(cabinet.tvaIntra ? { tvaIntra: cabinet.tvaIntra } : {}),
    ...(cabinet.iban ? { iban: cabinet.iban } : {}),
    ...(cabinet.licenseNumber ? { licenseNumber: cabinet.licenseNumber } : {}),
  }
}

/**
 * Construit le snapshot client (C2 review).
 *
 * **Pour un patient** (User PII chiffrée AES-256-GCM) : on déchiffre
 * `firstname`/`lastname`/`address1`/`postalCode`/`city` pour matérialiser
 * l'identité légalement requise sur la facture.
 *
 * **Base légale RGPD** : Art. 6.1.c GDPR — obligation légale comptable
 * (DGFiP). La donnée est stockée chiffrée applicativement (JSONB) ; le
 * trigger PG la verrouille post-issuance pour conservation 10 ans.
 *
 * **MVP V1+ TODO** : chiffrer le snapshot lui-même en AES-256-GCM avant
 * sérialisation JSONB. Pour Batch 1, le snapshot est en clair JSONB —
 * acceptable tant que la table `invoices` n'est pas exfiltrée
 * indépendamment des autres tables HDS chiffrées (defense-in-depth via
 * pgcrypto at-rest sur tout le tablespace).
 */
async function buildCustomerSnapshot(
  tx: Prisma.TransactionClient,
  patientId: number | null,
): Promise<Prisma.JsonObject | null> {
  if (!patientId) return null
  const patient = await tx.patient.findFirst({
    where: { id: patientId, deletedAt: null },
    select: {
      id: true,
      user: {
        select: {
          firstname: true, lastname: true,
          address1: true, address2: true,
          cp: true, city: true,
          email: true,
        },
      },
    },
  })
  // H7 (review PR #406) — patient introuvable ou soft-deleted :
  // bloque l'issuance (impossible de produire une facture sans
  // identité client valide).
  if (!patient) {
    throw new InvoiceValidationError("patientNotFound")
  }

  const firstname = safeDecrypt(patient.user.firstname)
  const lastname = safeDecrypt(patient.user.lastname)
  const fullName = [firstname, lastname].filter(Boolean).join(" ").trim()

  if (!fullName) {
    // Sans nom déchiffrable, la facture ne peut pas être conforme FR.
    throw new InvoiceValidationError("customerNameUnavailable")
  }

  return {
    patientRef: `patient#${patientId}`,
    name: fullName,
    ...((() => {
      const address1 = safeDecrypt(patient.user.address1)
      return address1 ? { address1 } : {}
    })()),
    ...((() => {
      const address2 = safeDecrypt(patient.user.address2)
      return address2 ? { address2 } : {}
    })()),
    ...((() => {
      const postalCode = safeDecrypt(patient.user.cp)
      return postalCode ? { postalCode } : {}
    })()),
    ...((() => {
      const city = safeDecrypt(patient.user.city)
      return city ? { city } : {}
    })()),
  }
}

/**
 * H4 (review PR #406) — Atomic FSM transition.
 *
 * Au lieu de `findUnique` + `update`, on utilise `updateMany` avec un
 * WHERE conditionnel sur le status courant. PostgreSQL garantit
 * l'atomicité de l'UPDATE (un seul writer succède, l'autre obtient
 * `affectedRows = 0`). On lit ensuite la ligne pour le retour DTO.
 */
async function atomicTransition(
  tx: Prisma.TransactionClient,
  invoiceId: number,
  fromStatus: InvoiceStatus | InvoiceStatus[],
  patch: Prisma.InvoiceUpdateInput,
): Promise<Invoice> {
  const fromArray = Array.isArray(fromStatus) ? fromStatus : [fromStatus]
  const updated = await tx.invoice.updateMany({
    where: { id: invoiceId, status: { in: fromArray } },
    data: patch,
  })
  if (updated.count === 0) {
    // Soit la facture n'existe pas, soit elle n'est pas dans `fromStatus`.
    const current = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true },
    })
    if (!current) throw new InvoiceNotFoundError()
    const targetStatus = (patch.status as InvoiceStatus | undefined) ?? current.status
    throw new InvoiceStateError(current.status, targetStatus)
  }
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId } })
  if (!inv) throw new InvoiceNotFoundError()
  return inv
}

// ─────────────────────────────────────────────────────────────
// Lecture autorisée — re-exporté pour les routes
// ─────────────────────────────────────────────────────────────

/**
 * Lecture autorisée si :
 *   - ADMIN (toujours)
 *   - membre du cabinet émetteur
 *   - patient cible (VIEWER consultant sa propre facture)
 *
 * M7 (review PR #406) — typé `Role` enum.
 */
async function canReadInvoice(
  userId: number,
  role: Role,
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
// Mapping DTO
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

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const invoiceService = {
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
      // H2 : pays cabinet ≡ pays facture, devise supportée.
      await assertCountryCurrencyAndCabinetMatch(
        tx, input.cabinetId, input.countryCode, input.currency,
      )

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

      // M4 (review PR #406) — borne anti-coquille totale.
      if (totalCents > INVOICE_BOUNDS.MAX_TOTAL_CENTS) {
        throw new InvoiceValidationError("totalCentsExceedsMax")
      }

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
          kind: "invoice.create",
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
   * H4 : transition atomique via updateMany WHERE status='draft'.
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

      const issuerSnapshot = await buildIssuerSnapshot(tx, inv.cabinetId, inv.countryCode)
      const customerSnapshot = await buildCustomerSnapshot(tx, inv.patientId)

      const updated = await atomicTransition(tx, invoiceId, "draft", {
        status: "issued",
        number,
        issuedAt: now,
        issuerSnapshot: issuerSnapshot as Prisma.InputJsonValue,
        customerSnapshot: customerSnapshot === null
          ? Prisma.JsonNull
          : (customerSnapshot as Prisma.InputJsonValue),
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
   * Marque une facture comme payée. `issued → paid`. H4 atomic update.
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

      const updated = await atomicTransition(tx, invoiceId, "issued", {
        status: "paid",
        paidAt: new Date(),
        paymentMethod,
        ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
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
          kind: "invoice.pay",
          paymentMethod,
        },
      })

      return toDTO(updated)
    })
  },

  /**
   * Annule une facture. `draft → cancelled` ou `issued → cancelled`.
   * Une facture `paid` ne peut plus être cancelled — utiliser refund.
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

      const updated = await atomicTransition(
        tx, invoiceId, ["draft", "issued"],
        { status: "cancelled", cancelledAt: new Date() },
      )

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
          ...(reason ? { reason: reason.slice(0, INVOICE_BOUNDS.MAX_CANCEL_REASON_LEN) } : {}),
        },
      })

      return toDTO(updated)
    })
  },

  /**
   * Lecture détaillée AVEC contrôle d'accès intégré.
   *
   * C3 + H5 (review PR #406) — On fetch d'abord SANS audit, on vérifie
   * `canReadInvoice` ensuite, puis on audit READ (succès) ou
   * `accessDenied` (échec). Évite la fuite d'existence pour les VIEWER
   * cross-patient.
   *
   * @returns `null` si la facture n'existe pas ou si l'user n'y a pas
   * accès. Le route layer mappe systématiquement null → 404 pour
   * éviter l'énumération.
   */
  async getById(
    invoiceId: number,
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<InvoiceWithItemsDTO | null> {
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true },
    })
    if (!inv) return null

    const allowed = await canReadInvoice(auditUserId, auditUserRole, {
      cabinetId: inv.cabinetId,
      patientId: inv.patientId,
    })
    if (!allowed) {
      // H5 (review PR #406) — accessDenied au lieu de READ pollué.
      await auditService.accessDenied({
        userId: auditUserId,
        resource: "INVOICE",
        resourceId: String(invoiceId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          ...(inv.patientId ? { patientId: inv.patientId } : {}),
          kind: "invoice.read.denied",
        },
      })
      return null
    }

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
   * Liste les factures d'un cabinet.
   *
   * M5 + M6 (review PR #406) — vérifie membership cabinet pour
   * NURSE/DOCTOR (ADMIN bypass), `resourceId=null` + pivot
   * `metadata.cabinetId` pour cohérence US-2268.
   */
  async listByCabinet(
    cabinetId: number,
    options: { status?: InvoiceStatus; limit?: number; cursor?: number } = {},
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<InvoiceDTO[]> {
    if (auditUserRole !== "ADMIN") {
      await assertCabinetMember(prisma, auditUserId, cabinetId)
    }

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

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "INVOICE",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        kind: "invoice.list.cabinet",
        cabinetId,
        count: rows.length,
        ...(options.status ? { statusFilter: options.status } : {}),
      },
    })

    return rows.map(toDTO)
  },

  /**
   * Liste les factures liées à un patient.
   * M5 : VIEWER limited to own patient; pros need cabinet membership
   * of the patient's healthcare service.
   */
  async listByPatient(
    patientId: number,
    options: { limit?: number; cursor?: number } = {},
    auditUserId: number,
    auditUserRole: Role,
    ctx?: AuditContext,
  ): Promise<InvoiceDTO[]> {
    // VIEWER : own only.
    if (auditUserRole === "VIEWER") {
      const ownPatient = await prisma.patient.findFirst({
        where: { id: patientId, userId: auditUserId, deletedAt: null },
        select: { id: true },
      })
      if (!ownPatient) throw new InvoiceAccessError("notOwnPatient")
    } else if (auditUserRole !== "ADMIN") {
      // DOCTOR/NURSE : must share a HealthcareService with the patient.
      const link = await prisma.patientService.findFirst({
        where: {
          patientId,
          patient: { deletedAt: null },
          service: { members: { some: { userId: auditUserId } } },
        },
        select: { id: true },
      })
      if (!link) throw new InvoiceAccessError("notPatientCaregiver")
    }

    const limit = Math.min(options.limit ?? 50, 200)
    const rows = await prisma.invoice.findMany({
      where: { patientId },
      orderBy: { id: "desc" },
      take: limit,
      ...(options.cursor ? { skip: 1, cursor: { id: options.cursor } } : {}),
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "INVOICE",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        patientId,
        kind: "invoice.list.patient",
        count: rows.length,
      },
    })

    return rows.map(toDTO)
  },
}
