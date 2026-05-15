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
import { decrypt, encrypt } from "@/lib/crypto/health-data"
import { validateSiret } from "./healthcare-management.service"
import { auditService, type AuditContext } from "./audit.service"
import { reserveNextInvoiceNumber } from "./invoice-numbering.service"

// ─────────────────────────────────────────────────────────────
// L-NEW-4 (review re-2) — typed audit kinds (compile-time drift safety).
// ─────────────────────────────────────────────────────────────

export type InvoiceAuditKind =
  | "invoice.create"
  | "invoice.issue"
  | "invoice.pay"
  | "invoice.cancel"
  | "invoice.read"
  | "invoice.read.denied"
  | "invoice.list.cabinet"
  | "invoice.list.patient"

const AUDIT_KIND = {
  CREATE: "invoice.create",
  ISSUE: "invoice.issue",
  PAY: "invoice.pay",
  CANCEL: "invoice.cancel",
  READ: "invoice.read",
  READ_DENIED: "invoice.read.denied",
  LIST_CABINET: "invoice.list.cabinet",
  LIST_PATIENT: "invoice.list.patient",
} as const satisfies Record<string, InvoiceAuditKind>

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

/**
 * M-NEW-1 (review re-2) — Lost-update race : la transition était
 * légitime au moment du `findUnique` mais un autre writer concurrent
 * a déjà transitionné depuis. À distinguer de `InvoiceStateError`
 * pour que le client puisse retry (mappé 409 + `retryable:true`).
 */
export class InvoiceConcurrencyError extends Error {
  constructor(public current: InvoiceStatus, public expected: InvoiceStatus[]) {
    super(`concurrent update: invoice now ${current}, expected one of ${expected.join("|")}`)
    this.name = "InvoiceConcurrencyError"
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
 *
 * L-NEW-3 (review re-2) — logs un warning structuré quand un champ
 * non-null échoue au déchiffrement (corruption clé / format), pour
 * que les ops détectent les key rotation skew sans fouiller à la main.
 * Aucun PHI loggé : juste le contexte (field name + invoice context).
 */
function safeDecrypt(value: string | null | undefined, fieldContext?: string): string | null {
  if (!value) return null
  try {
    return decrypt(new Uint8Array(Buffer.from(value, "base64")))
  } catch {
    if (fieldContext && process.env.NODE_ENV !== "test") {
      // Structured warning — no PHI leaked.
      console.warn(JSON.stringify({
        level: "warn",
        service: "invoice",
        event: "snapshot_decrypt_failed",
        field: fieldContext,
        message: "PII field decryption failed, omitted from snapshot",
      }))
    }
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

  // H3 + H-NEW-1 (review re-2) — conformité comptable FR :
  // SIRET obligatoire pour facture émise sous juridiction FR, validé Luhn
  // (anti-forge `00000000000000` qui passerait le simple regex DB).
  if (countryCode.toUpperCase() === "FR") {
    if (!cabinet.siret) {
      throw new InvoiceValidationError("cabinetSiretRequiredForFR")
    }
    const siretError = validateSiret(cabinet.siret)
    if (siretError) {
      throw new InvoiceValidationError(`cabinetSiretInvalid:${siretError}`)
    }
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
 * PII contenu dans le snapshot client. Sérialisé en JSON puis chiffré
 * AES-256-GCM avant stockage JSONB (M-NEW-3 review re-2).
 */
interface CustomerSnapshotPii {
  name: string
  address1?: string
  address2?: string
  postalCode?: string
  city?: string
}

/**
 * Schéma JSONB stocké en colonne `customer_snapshot` :
 *
 *   { patientRef: "patient#42", encryptedPii: "base64...", encryptedAt: "ISO-8601" }
 *
 * - `patientRef` : référence non-PHI (juste l'ID patient).
 * - `encryptedPii` : `base64( AES-256-GCM( JSON.stringify(CustomerSnapshotPii) ) )`.
 * - `encryptedAt` : horodatage du chiffrement, utile pour rotation clé V2+.
 *
 * **Asymétrie defense-in-depth** : le contenu PHI suit la même
 * politique HDS que `users.firstname` (chiffré applicativement).
 * Un dump SQL `SELECT customer_snapshot FROM invoices` retourne le
 * blob chiffré, pas le nom du client en clair.
 */
interface CustomerSnapshotStored {
  patientRef: string
  encryptedPii: string
  encryptedAt: string
}

/**
 * Construit le snapshot client (C2 + M-NEW-3 review).
 *
 * **Pour un patient** (User PII chiffrée AES-256-GCM) : on déchiffre
 * `firstname`/`lastname`/`address1`/`postalCode`/`city`, on construit
 * l'objet `CustomerSnapshotPii`, on le sérialise en JSON, on chiffre
 * AES-256-GCM le JSON, on stocke le blob base64 en JSONB.
 *
 * **Base légale RGPD** : Art. 6.1.c GDPR — obligation légale comptable
 * (DGFiP art. 242 nonies A CGI). La donnée est doublement protégée :
 * chiffrement applicatif AES-256-GCM + immuabilité trigger PG.
 */
async function buildCustomerSnapshot(
  tx: Prisma.TransactionClient,
  patientId: number | null,
): Promise<CustomerSnapshotStored | null> {
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

  const firstname = safeDecrypt(patient.user.firstname, "patient.firstname")
  const lastname = safeDecrypt(patient.user.lastname, "patient.lastname")
  const fullName = [firstname, lastname].filter(Boolean).join(" ").trim()

  if (!fullName) {
    // Sans nom déchiffrable, la facture ne peut pas être conforme FR.
    throw new InvoiceValidationError("customerNameUnavailable")
  }

  const pii: CustomerSnapshotPii = { name: fullName }
  const address1 = safeDecrypt(patient.user.address1, "patient.address1")
  if (address1) pii.address1 = address1
  const address2 = safeDecrypt(patient.user.address2, "patient.address2")
  if (address2) pii.address2 = address2
  const postalCode = safeDecrypt(patient.user.cp, "patient.cp")
  if (postalCode) pii.postalCode = postalCode
  const city = safeDecrypt(patient.user.city, "patient.city")
  if (city) pii.city = city

  // M-NEW-3 (review re-2) — chiffrement applicatif AES-256-GCM du blob PII.
  const encryptedPii = Buffer.from(encrypt(JSON.stringify(pii))).toString("base64")

  return {
    patientRef: `patient#${patientId}`,
    encryptedPii,
    encryptedAt: new Date().toISOString(),
  }
}

/**
 * Déchiffre le `customer_snapshot` stocké pour reconstituer la PII
 * client (utilisé par le générateur de PDF en Batch 2, par les routes
 * d'export comptable, etc.).
 *
 * @returns `null` si la facture n'a pas de snapshot (cabinet-interne)
 * ou si le snapshot est corrompu / clé absente (graceful degradation).
 */
export function decryptCustomerSnapshot(
  snapshot: Prisma.JsonValue | null,
): CustomerSnapshotPii | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null
  }
  const enc = (snapshot as Record<string, unknown>).encryptedPii
  if (typeof enc !== "string") return null
  try {
    const json = decrypt(new Uint8Array(Buffer.from(enc, "base64")))
    const parsed = JSON.parse(json)
    if (typeof parsed !== "object" || !parsed || typeof parsed.name !== "string") {
      return null
    }
    return parsed as CustomerSnapshotPii
  } catch {
    return null
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
  /** Status au moment du check pre-transition (caller-supplied). Sert
   *  à distinguer une race (caller a lu A, mais maintenant B) d'une
   *  vraie FSM violation (caller a lu B et tente B→X interdit). */
  expectedSeenStatus?: InvoiceStatus,
): Promise<Invoice> {
  const fromArray = Array.isArray(fromStatus) ? fromStatus : [fromStatus]
  const updated = await tx.invoice.updateMany({
    where: { id: invoiceId, status: { in: fromArray } },
    data: patch,
  })
  if (updated.count === 0) {
    const current = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true },
    })
    if (!current) throw new InvoiceNotFoundError()
    // M-NEW-1 (review re-2) — distinguer race lost-update vs FSM réelle.
    // Si le status actuel est dans `fromArray` mais le updateMany a count=0,
    // c'est une race (extrêmement rare, theorique). Plus probable :
    // status a changé entre le `findUnique` du caller et notre updateMany.
    if (expectedSeenStatus && current.status !== expectedSeenStatus) {
      throw new InvoiceConcurrencyError(current.status, fromArray)
    }
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
          kind: AUDIT_KIND.CREATE,
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

      const updated = await atomicTransition(
        tx, invoiceId, "draft",
        {
          status: "issued",
          number,
          issuedAt: now,
          issuerSnapshot: issuerSnapshot as Prisma.InputJsonValue,
          customerSnapshot: customerSnapshot === null
            ? Prisma.JsonNull
            : (customerSnapshot as unknown as Prisma.InputJsonValue),
        },
        "draft", // expectedSeenStatus (M-NEW-1)
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
          kind: AUDIT_KIND.ISSUE,
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
    // H-NEW-2 (review re-2) — defense-in-depth : valider le PI ID au
    // niveau service (pas seulement Zod route). Couvre les callers
    // internes (webhook reconciliation Batch 3, server actions, etc.).
    if (paymentMethod === "stripe") {
      if (!stripePaymentIntentId || !/^pi_[A-Za-z0-9]{1,46}$/.test(stripePaymentIntentId)) {
        throw new InvoiceValidationError("stripePaymentIntentId")
      }
    } else if (stripePaymentIntentId) {
      throw new InvoiceValidationError("stripePaymentIntentIdUnexpected")
    }

    return prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId } })
      if (!inv) throw new InvoiceNotFoundError()
      await assertCabinetMember(tx, auditUserId, inv.cabinetId)
      if (inv.status !== "issued") {
        throw new InvoiceStateError(inv.status, "paid")
      }

      const updated = await atomicTransition(
        tx, invoiceId, "issued",
        {
          status: "paid",
          paidAt: new Date(),
          paymentMethod,
          ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
        },
        "issued",
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
          kind: AUDIT_KIND.PAY,
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
      if (inv.status !== "draft" && inv.status !== "issued") {
        throw new InvoiceStateError(inv.status, "cancelled")
      }

      const updated = await atomicTransition(
        tx, invoiceId, ["draft", "issued"],
        { status: "cancelled", cancelledAt: new Date() },
        inv.status,
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
          kind: AUDIT_KIND.CANCEL,
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
          kind: AUDIT_KIND.READ_DENIED,
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
        kind: AUDIT_KIND.READ,
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
      // M-NEW-2 (review re-2) — `metadata.cabinetId` est un pivot
      // sortant de la convention US-2268 (`metadata.patientId` indexé
      // par GIN partiel). Les requêtes forensiques cabinet-scope
      // feront un sequential scan jusqu'à ce qu'un index complémentaire
      // soit ajouté en V1 follow-up (issue à créer : "GIN partial
      // index on audit_logs.metadata->'cabinetId'"). Acceptable Batch 1.
      metadata: {
        kind: AUDIT_KIND.LIST_CABINET,
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
        kind: AUDIT_KIND.LIST_PATIENT,
        count: rows.length,
      },
    })

    return rows.map(toDTO)
  },
}
