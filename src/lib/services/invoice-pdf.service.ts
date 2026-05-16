/**
 * @module services/invoice-pdf
 * @description US-2102 — Génération PDF facture + IBAN virement bancaire.
 *
 * Workflow :
 *   1. Fetch Invoice + items + snapshots (issuer chiffré ; customer chiffré
 *      AES-256-GCM si patient).
 *   2. Render PDF via `pdf-lib` (sans dependency native, runtime Node-safe).
 *   3. SHA-256 du buffer pour intégrité (`Invoice.pdfHash`).
 *   4. Upload OVH S3 SSE-S3 — clé `invoices/<cabinetId>/<year>/<number>.pdf`.
 *   5. UPDATE `Invoice.pdfUrl + pdfHash` (atomic).
 *   6. Audit `INVOICE/UPDATE` kind `invoice.pdf.generated`.
 *
 * Garde-fous :
 *   - Status doit être ≥ `issued` (jamais de PDF sur draft — pas de
 *     numéro séquentiel ni de snapshot stable).
 *   - Idempotent : si PDF déjà généré (pdfHash != null), retourne l'URL
 *     existante sans regénérer (les snapshots sont figés, le contenu PDF
 *     ne changerait pas — sauf si on veut un re-render forcé via flag).
 *   - RBAC : `canReadInvoice` (ADMIN, cabinet member, VIEWER patient owner).
 *
 * Pas de PHI lockscreen / log :
 *   - `customerSnapshot` n'est déchiffré qu'en mémoire pour le render.
 *   - Audit ne contient JAMAIS le nom client (`pdfHash` + `pdfKey`).
 */
import { createHash } from "crypto"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"
import {
  decryptCustomerSnapshot,
  type CustomerSnapshotPii,
} from "./invoice.service"
import { uploadFile, downloadFile } from "@/lib/storage/s3"
import { logger } from "@/lib/logger"
import type { Role } from "@prisma/client"

/** Bornes applicatives. */
export const INVOICE_PDF_BOUNDS = {
  /** Max items rendered (cohérent INVOICE_BOUNDS.MAX_ITEMS = 100). */
  MAX_ITEMS_RENDERED: 100,
  /** Cap content-length PDF généré (anti-DoS S3 upload). */
  MAX_PDF_BYTES: 2_000_000,
} as const

export class InvoicePdfNotFoundError extends Error {
  constructor() {
    super("invoiceNotFound")
    this.name = "InvoicePdfNotFoundError"
  }
}

export class InvoicePdfAccessError extends Error {
  constructor(reason = "forbidden") {
    super(reason)
    this.name = "InvoicePdfAccessError"
  }
}

export class InvoicePdfStateError extends Error {
  constructor(public actual: string, public expected: string) {
    super(`invalidState:${actual}!=${expected}`)
    this.name = "InvoicePdfStateError"
  }
}

export class InvoicePdfRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvoicePdfRenderError"
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Formate en cents → string "12,34 €". */
function formatCents(cents: number, currencyCode: string): string {
  const amount = (cents / 100).toFixed(2)
  const symbol = currencyCode === "EUR" ? "€" : currencyCode === "DZD" ? "DA" : currencyCode
  return `${amount} ${symbol}`
}

interface IssuerSnapshotShape {
  name: string
  establishment?: string
  addressLine1?: string
  addressLine2?: string
  postalCode?: string
  city?: string
  country?: string
  phone?: string
  email?: string
  siret?: string
  tvaIntra?: string
  iban?: string
  licenseNumber?: string
}

function parseIssuerSnapshot(json: Prisma.JsonValue | null): IssuerSnapshotShape {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new InvoicePdfRenderError("issuerSnapshotMissing")
  }
  const obj = json as Record<string, unknown>
  if (typeof obj.name !== "string" || obj.name.length === 0) {
    throw new InvoicePdfRenderError("issuerSnapshotInvalid:name")
  }
  return obj as unknown as IssuerSnapshotShape
}

/** RBAC — voir canReadInvoice dans invoice.service. */
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
// Render PDF
// ─────────────────────────────────────────────────────────────

interface RenderInput {
  number: string
  issuedAt: Date
  countryCode: string
  currency: string
  paymentMethod: string | null
  issuer: IssuerSnapshotShape
  customer: CustomerSnapshotPii | null
  items: ReadonlyArray<{
    description: string
    quantity: number
    unitPriceCents: number
    taxRate: number
    taxCents: number
    lineTotalCents: number
  }>
  totalCents: number
  taxCents: number
}

/** Pure helper — produit le Buffer PDF. Pas de side-effect DB/S3. */
export async function renderInvoicePdf(input: RenderInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([595, 842]) // A4 portrait points
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  let y = 800
  const MARGIN_L = 50
  const MARGIN_R = 545

  const draw = (text: string, x: number, yPos: number, opts?: { bold?: boolean; size?: number }) => {
    page.drawText(text, {
      x,
      y: yPos,
      size: opts?.size ?? 10,
      font: opts?.bold ? fontBold : font,
      color: rgb(0, 0, 0),
    })
  }

  // Header — Issuer.
  draw(input.issuer.name, MARGIN_L, y, { bold: true, size: 14 })
  y -= 18
  if (input.issuer.establishment) {
    draw(input.issuer.establishment, MARGIN_L, y)
    y -= 12
  }
  if (input.issuer.addressLine1) {
    draw(input.issuer.addressLine1, MARGIN_L, y)
    y -= 12
  }
  if (input.issuer.addressLine2) {
    draw(input.issuer.addressLine2, MARGIN_L, y)
    y -= 12
  }
  if (input.issuer.postalCode || input.issuer.city) {
    draw(`${input.issuer.postalCode ?? ""} ${input.issuer.city ?? ""}`.trim(), MARGIN_L, y)
    y -= 12
  }
  if (input.issuer.country) {
    draw(input.issuer.country, MARGIN_L, y)
    y -= 12
  }
  if (input.issuer.siret) {
    draw(`SIRET : ${input.issuer.siret}`, MARGIN_L, y)
    y -= 12
  }
  if (input.issuer.tvaIntra) {
    draw(`TVA : ${input.issuer.tvaIntra}`, MARGIN_L, y)
    y -= 12
  }

  // Title.
  y -= 20
  draw(`FACTURE ${input.number}`, MARGIN_L, y, { bold: true, size: 18 })
  y -= 22
  draw(`Date d'émission : ${input.issuedAt.toISOString().slice(0, 10)}`, MARGIN_L, y)
  y -= 20

  // Customer block (if patient).
  if (input.customer) {
    draw("Client :", MARGIN_L, y, { bold: true })
    y -= 14
    draw(input.customer.name, MARGIN_L, y)
    y -= 12
    if (input.customer.address1) {
      draw(input.customer.address1, MARGIN_L, y)
      y -= 12
    }
    if (input.customer.address2) {
      draw(input.customer.address2, MARGIN_L, y)
      y -= 12
    }
    if (input.customer.postalCode || input.customer.city) {
      draw(`${input.customer.postalCode ?? ""} ${input.customer.city ?? ""}`.trim(), MARGIN_L, y)
      y -= 12
    }
    y -= 14
  }

  // Items table — header.
  y -= 10
  draw("Description", MARGIN_L, y, { bold: true })
  draw("Qté", 340, y, { bold: true })
  draw("PU HT", 380, y, { bold: true })
  draw("TVA", 440, y, { bold: true })
  draw("Total TTC", 485, y, { bold: true })
  y -= 4
  page.drawLine({
    start: { x: MARGIN_L, y },
    end: { x: MARGIN_R, y },
    thickness: 0.5,
  })
  y -= 12

  for (const item of input.items.slice(0, INVOICE_PDF_BOUNDS.MAX_ITEMS_RENDERED)) {
    const desc = item.description.length > 50
      ? item.description.slice(0, 47) + "..."
      : item.description
    draw(desc, MARGIN_L, y)
    draw(item.quantity.toString(), 340, y)
    draw(formatCents(item.unitPriceCents, input.currency), 380, y)
    draw(`${(item.taxRate * 100).toFixed(1)}%`, 440, y)
    draw(formatCents(item.lineTotalCents, input.currency), 485, y)
    y -= 14
    if (y < 150) break // page-overflow guard V1 (V2 = multi-page)
  }

  // Totals.
  y -= 20
  page.drawLine({
    start: { x: 340, y: y + 8 },
    end: { x: MARGIN_R, y: y + 8 },
    thickness: 0.5,
  })
  const totalHt = input.totalCents - input.taxCents
  draw("Total HT :", 340, y)
  draw(formatCents(totalHt, input.currency), 485, y)
  y -= 14
  draw("TVA :", 340, y)
  draw(formatCents(input.taxCents, input.currency), 485, y)
  y -= 14
  draw("Total TTC :", 340, y, { bold: true })
  draw(formatCents(input.totalCents, input.currency), 485, y, { bold: true })

  // Footer — IBAN si BANK_TRANSFER.
  if (input.paymentMethod === "bank_transfer" && input.issuer.iban) {
    y -= 30
    page.drawLine({
      start: { x: MARGIN_L, y },
      end: { x: MARGIN_R, y },
      thickness: 0.5,
    })
    y -= 14
    draw("Règlement par virement bancaire :", MARGIN_L, y, { bold: true })
    y -= 14
    draw(`IBAN : ${input.issuer.iban}`, MARGIN_L, y)
    y -= 12
    draw(`Référence à indiquer : ${input.number}`, MARGIN_L, y)
  }

  // PDF metadata.
  pdfDoc.setTitle(`Facture ${input.number}`)
  pdfDoc.setSubject(`Invoice ${input.number} — ${input.countryCode}`)
  pdfDoc.setProducer("Diabeo BackOffice US-2102")
  pdfDoc.setCreationDate(new Date())

  const bytes = await pdfDoc.save()
  const buf = Buffer.from(bytes)
  if (buf.length > INVOICE_PDF_BOUNDS.MAX_PDF_BYTES) {
    throw new InvoicePdfRenderError(`pdfTooLarge:${buf.length}`)
  }
  return buf
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const invoicePdfService = {
  /**
   * Génère le PDF d'une facture émise (status ≥ issued).
   * Idempotent : si `pdfHash` existe déjà, retourne l'URL existante.
   *
   * @returns `{ pdfUrl, pdfHash, regenerated }` — `regenerated: false` si
   *   déjà existant, `true` si nouvellement créé.
   */
  async generate(
    invoiceId: number,
    auditUserId: number,
    auditUserRole: Role,
    ctx: AuditContext,
  ): Promise<{ pdfUrl: string; pdfHash: string; regenerated: boolean }> {
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: { orderBy: { position: "asc" } } },
    })
    if (!inv) throw new InvoicePdfNotFoundError()

    // RBAC.
    const allowed = await canReadInvoice(auditUserId, auditUserRole, {
      cabinetId: inv.cabinetId,
      patientId: inv.patientId,
    })
    if (!allowed) {
      try {
        await auditService.accessDenied({
          userId: auditUserId,
          resource: "INVOICE",
          resourceId: String(invoiceId),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: {
            kind: "invoice.pdf.generate.accessDenied",
            ...(inv.patientId ? { patientId: inv.patientId } : {}),
          },
        })
      } catch {
        // swallow — audit fail ne doit pas bloquer le 403.
      }
      throw new InvoicePdfAccessError()
    }

    // Status check.
    if (inv.status === "draft") {
      throw new InvoicePdfStateError(inv.status, "issued|paid|cancelled|refunded")
    }
    if (!inv.number || !inv.issuedAt) {
      throw new InvoicePdfStateError(inv.status, "issued (number+issuedAt required)")
    }

    // Idempotence : déjà généré.
    if (inv.pdfHash && inv.pdfUrl) {
      return {
        pdfUrl: inv.pdfUrl,
        pdfHash: inv.pdfHash,
        regenerated: false,
      }
    }

    // Snapshots.
    const issuer = parseIssuerSnapshot(inv.issuerSnapshot)
    let customer: CustomerSnapshotPii | null = null
    if (inv.customerSnapshot && inv.patientId) {
      try {
        customer = decryptCustomerSnapshot(inv.customerSnapshot)
      } catch (err) {
        logger.error(
          "invoice-pdf",
          "customerSnapshot decrypt failed",
          { userId: auditUserId, resource: "INVOICE" },
          err,
        )
        // Continue render sans customer block (factures cabinet-interne).
      }
    }

    // Render.
    const pdfBuffer = await renderInvoicePdf({
      number: inv.number,
      issuedAt: inv.issuedAt,
      countryCode: inv.countryCode,
      currency: inv.currency,
      paymentMethod: inv.paymentMethod,
      issuer,
      customer,
      items: inv.items.map((it) => ({
        description: it.description,
        quantity: Number(it.quantity),
        unitPriceCents: it.unitPriceCents,
        taxRate: Number(it.taxRate),
        taxCents: it.taxCents,
        lineTotalCents: it.lineTotalCents,
      })),
      totalCents: inv.totalCents,
      taxCents: inv.taxCents,
    })

    // SHA-256 intégrité.
    const pdfHash = createHash("sha256").update(pdfBuffer).digest("hex")

    // Upload S3 — clé déterministe par facture (regen idempotent côté S3).
    const year = inv.issuedAt.getUTCFullYear()
    const pdfKey = `invoices/${inv.cabinetId}/${year}/${inv.number}.pdf`
    await uploadFile(pdfKey, pdfBuffer, "application/pdf")
    const pdfUrl = pdfKey // Stockage : on garde la clé S3, pas l'URL pré-signée.

    // Atomic UPDATE — bloque race-condition double-generate (l'autre voit
    // pdfHash != null à son next read et bail out).
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { pdfUrl, pdfHash },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "INVOICE",
        resourceId: String(invoiceId),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: {
          kind: "invoice.pdf.generated",
          ...(inv.patientId ? { patientId: inv.patientId } : {}),
          pdfHash, // hash OK, pas PHI
          pdfSize: pdfBuffer.length,
        },
      })
    })

    return { pdfUrl, pdfHash, regenerated: true }
  },

  /**
   * Stream le PDF depuis S3 vers le client. RBAC re-vérifié.
   */
  async download(
    invoiceId: number,
    auditUserId: number,
    auditUserRole: Role,
    ctx: AuditContext,
  ): Promise<{ body: ReadableStream; contentType: string; contentLength: number | undefined; pdfHash: string }> {
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true, cabinetId: true, patientId: true, status: true,
        pdfUrl: true, pdfHash: true, number: true,
      },
    })
    if (!inv) throw new InvoicePdfNotFoundError()

    const allowed = await canReadInvoice(auditUserId, auditUserRole, {
      cabinetId: inv.cabinetId,
      patientId: inv.patientId,
    })
    if (!allowed) {
      try {
        await auditService.accessDenied({
          userId: auditUserId,
          resource: "INVOICE",
          resourceId: String(invoiceId),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: {
            kind: "invoice.pdf.download.accessDenied",
            ...(inv.patientId ? { patientId: inv.patientId } : {}),
          },
        })
      } catch { /* swallow */ }
      throw new InvoicePdfAccessError()
    }

    if (!inv.pdfUrl || !inv.pdfHash) {
      throw new InvoicePdfStateError("noPdf", "pdf generated")
    }

    const file = await downloadFile(inv.pdfUrl)
    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "INVOICE",
      resourceId: String(invoiceId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        kind: "invoice.pdf.downloaded",
        ...(inv.patientId ? { patientId: inv.patientId } : {}),
        pdfHash: inv.pdfHash,
      },
    })
    return { ...file, pdfHash: inv.pdfHash }
  },
}
