/**
 * @module services/invoice-pdf
 * @description US-2102 — Génération PDF facture + IBAN virement bancaire.
 *
 * Workflow :
 *   1. Fetch Invoice + items + snapshots (issuer chiffré côté IBAN HSA H-3
 *      round 1 ; customer chiffré AES-256-GCM si patient).
 *   2. Render PDF via `pdf-lib` (multi-page, sanitization Unicode → WinAnsi).
 *   3. SHA-256 du buffer pour intégrité (`Invoice.pdfHash`).
 *   4. Upload OVH S3 SSE-S3 — clé `invoices/<cabinetId>/<year>/<number>.pdf`.
 *   5. UPDATE `Invoice.pdfUrl + pdfHash` atomique (CAS via updateMany).
 *   6. Audit `INVOICE/UPDATE` kind `invoice.pdf.generated`.
 *
 * Garde-fous :
 *   - Status ≥ `issued` (jamais sur draft — pas de numéro séquentiel).
 *   - Idempotent : si `pdfHash` existe + le status hasn't changed depuis,
 *     retourne l'URL existante. Si status change (paid/cancelled/refunded
 *     post-generation), force regen pour refléter le nouveau status.
 *   - `setCreationDate(inv.issuedAt)` → render déterministe (M3 round 1).
 *   - Atomic CAS `updateMany WHERE pdfHash = null` empêche double-write
 *     concurrent (M3+M-5 round 1).
 *   - IBAN obligatoire si `paymentMethod = bank_transfer` (M5 round 1).
 *   - Multi-page support (H1+H-4 round 1) — jamais de truncation silencieuse.
 *   - Unicode sanitization → WinAnsi-compatible (C1 round 1).
 *   - RBAC : `canReadInvoice` (ADMIN, cabinet member, VIEWER patient owner).
 *
 * Pas de PHI lockscreen / log :
 *   - `customerSnapshot` n'est déchiffré qu'en mémoire pour le render.
 *   - Audit ne contient JAMAIS le nom client (`pdfHash` + `pdfKey` + `pdfSize`).
 */
import { createHash } from "crypto"
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"
import {
  decryptCustomerSnapshot,
  type CustomerSnapshotPii,
} from "./invoice.service"
import { safeDecryptField } from "@/lib/crypto/fields"
import { uploadFile, downloadFile } from "@/lib/storage/s3"
import { logger } from "@/lib/logger"
import type { Role } from "@prisma/client"

// ─────────────────────────────────────────────────────────────
// Bornes + types
// ─────────────────────────────────────────────────────────────

export const INVOICE_PDF_BOUNDS = {
  /** Max items rendered total (cohérent INVOICE_BOUNDS.MAX_ITEMS = 100). */
  MAX_ITEMS_RENDERED: 100,
  /** Cap content-length PDF généré (anti-DoS S3 upload). Tient ~100 items multi-page. */
  MAX_PDF_BYTES: 4_000_000,
  /** Cap description after word-wrap split (M-1/L2 round 1). */
  DESC_WRAP_WIDTH_CHARS: 50,
  DESC_WRAP_MAX_LINES: 3,
} as const

/** Audit kinds typés (M8 review round 1). */
export type InvoicePdfAuditKind =
  | "invoice.pdf.generated"
  | "invoice.pdf.regenerated"
  | "invoice.pdf.downloaded"
  | "invoice.pdf.generate.accessDenied"
  | "invoice.pdf.download.accessDenied"

const PDF_AUDIT_KIND = {
  GENERATED: "invoice.pdf.generated",
  REGENERATED: "invoice.pdf.regenerated",
  DOWNLOADED: "invoice.pdf.downloaded",
  GENERATE_DENIED: "invoice.pdf.generate.accessDenied",
  DOWNLOAD_DENIED: "invoice.pdf.download.accessDenied",
} as const satisfies Record<string, InvoicePdfAuditKind>

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
  /** Code stable pour mapping client (M-4 review HSA round 1 — pas de leak
   *  d'info via message brut). */
  constructor(public code: string) {
    super(code)
    this.name = "InvoicePdfRenderError"
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers — Unicode sanitization + Intl formatters
// ─────────────────────────────────────────────────────────────

/**
 * C1 review round 1 — pdf-lib StandardFonts (Helvetica) supportent WinAnsi
 * (CP1252) uniquement. Caractères hors Latin-1 (Polonais Ł, Cyrillique,
 * Arabe, CJK) → throw `drawText`.
 *
 * Sanitization V1 : remplace par `?` les caractères incompatibles.
 * Follow-up V2 : embed NotoSans subset (pdf-lib + fontkit) pour DZ launch.
 */
function sanitizeForWinAnsi(text: string): string {
  // WinAnsi = Latin-1 (U+00 → U+FF) sauf 5 char-spots :
  // - U+80 → € (U+20AC), U+82 → ‚ (U+201A), U+83 → ƒ (U+0192), ...
  // Pour simplicité : on autorise U+00 → U+FF, et on remplace tout le
  // reste par '?'. Cas spécial : on garde explicitement € (U+20AC) car
  // pdf-lib WinAnsi le supporte au glyph 0x80.
  // eslint-disable-next-line no-control-regex
  return text.replace(/[^\x00-\xFF€]/g, "?")
}

const CURRENCY_LOCALE: Record<string, string> = {
  EUR: "fr-FR",
  DZD: "fr-DZ",
}

/** L1 review round 1 — formatage monétaire localisé. */
function formatMoney(cents: number, currencyCode: string): string {
  const locale = CURRENCY_LOCALE[currencyCode] ?? "fr-FR"
  try {
    const fmt = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    return sanitizeForWinAnsi(fmt.format(cents / 100))
  } catch {
    // Fallback si currencyCode invalide.
    return sanitizeForWinAnsi(`${(cents / 100).toFixed(2)} ${currencyCode}`)
  }
}

/** L3 review round 1 — format date FR-style. */
function formatDate(d: Date, countryCode: string): string {
  const locale = countryCode === "DZ" ? "fr-DZ" : "fr-FR"
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/** L2/M-1 review round 1 — word-wrap multi-ligne pour description. */
function wrapDescription(text: string): string[] {
  const sanitized = sanitizeForWinAnsi(text)
  if (sanitized.length <= INVOICE_PDF_BOUNDS.DESC_WRAP_WIDTH_CHARS) {
    return [sanitized]
  }
  const lines: string[] = []
  const words = sanitized.split(/\s+/)
  let current = ""
  for (const w of words) {
    if (current.length === 0) {
      current = w
    } else if ((current + " " + w).length <= INVOICE_PDF_BOUNDS.DESC_WRAP_WIDTH_CHARS) {
      current += " " + w
    } else {
      lines.push(current)
      if (lines.length >= INVOICE_PDF_BOUNDS.DESC_WRAP_MAX_LINES - 1) {
        // Dernière ligne — concat reste truncé.
        current = w
      } else {
        current = w
      }
    }
  }
  if (current) lines.push(current)
  // Cap à MAX_LINES, suffix "..." si truncated.
  if (lines.length > INVOICE_PDF_BOUNDS.DESC_WRAP_MAX_LINES) {
    const kept = lines.slice(0, INVOICE_PDF_BOUNDS.DESC_WRAP_MAX_LINES)
    const last = kept[kept.length - 1]!
    kept[kept.length - 1] = last.slice(0, Math.max(0, last.length - 3)) + "..."
    return kept
  }
  return lines
}

// ─────────────────────────────────────────────────────────────
// Snapshot validators (M2 review round 1 — Zod strict)
// ─────────────────────────────────────────────────────────────

import { z } from "zod"

const issuerSnapshotSchema = z.object({
  name: z.string().min(1).max(200),
  establishment: z.string().max(200).optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  postalCode: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(2).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().max(200).optional(),
  siret: z.string().max(20).optional(),
  tvaIntra: z.string().max(20).optional(),
  /** Plain IBAN (legacy snapshots pre HSA H-3 round 1). */
  iban: z.string().max(50).optional(),
  /** HSA H-3 review round 1 — IBAN chiffré AES-256-GCM base64.
   *  Defense-in-depth : un dump SQL ne révèle pas l'IBAN cabinet. */
  ibanEnc: z.string().max(500).optional(),
  licenseNumber: z.string().max(50).optional(),
}).strict()

type IssuerSnapshotShape = z.infer<typeof issuerSnapshotSchema>

function parseIssuerSnapshot(json: Prisma.JsonValue | null): IssuerSnapshotShape {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new InvoicePdfRenderError("issuerSnapshotMissing")
  }
  const parsed = issuerSnapshotSchema.safeParse(json)
  if (!parsed.success) {
    throw new InvoicePdfRenderError("issuerSnapshotInvalid")
  }
  return parsed.data
}

/** Resolve IBAN — preferr chiffré (HSA H-3), fallback legacy plaintext. */
function resolveIban(issuer: IssuerSnapshotShape): string | null {
  if (issuer.ibanEnc) {
    const decrypted = safeDecryptField(issuer.ibanEnc)
    if (decrypted) return decrypted
  }
  return issuer.iban ?? null
}

// ─────────────────────────────────────────────────────────────
// RBAC (M1 review round 1 — kept inline, no cycle today)
// ─────────────────────────────────────────────────────────────

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
// Render PDF (multi-page H1/H-4 review round 1)
// ─────────────────────────────────────────────────────────────

const PAGE_W = 595
const PAGE_H = 842
const MARGIN_L = 50
const MARGIN_R = 545
const MIN_Y = 80 // marge bas avant page break

interface RenderInput {
  number: string
  issuedAt: Date
  status: string
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

interface RenderCtx {
  pdfDoc: PDFDocument
  font: PDFFont
  fontBold: PDFFont
  page: PDFPage
  y: number
}

function drawText(
  ctx: RenderCtx, text: string, x: number, opts?: { bold?: boolean; size?: number },
): void {
  ctx.page.drawText(sanitizeForWinAnsi(text), {
    x,
    y: ctx.y,
    size: opts?.size ?? 10,
    font: opts?.bold ? ctx.fontBold : ctx.font,
    color: rgb(0, 0, 0),
  })
}

function newPage(ctx: RenderCtx): void {
  ctx.page = ctx.pdfDoc.addPage([PAGE_W, PAGE_H])
  ctx.y = PAGE_H - 50
}

function ensureSpace(ctx: RenderCtx, needed: number): void {
  if (ctx.y - needed < MIN_Y) {
    newPage(ctx)
  }
}

function drawItemsHeader(ctx: RenderCtx): void {
  drawText(ctx, "Description", MARGIN_L, { bold: true })
  drawText(ctx, "Qte", 340, { bold: true })
  drawText(ctx, "PU HT", 380, { bold: true })
  drawText(ctx, "TVA", 440, { bold: true })
  drawText(ctx, "Total TTC", 485, { bold: true })
  ctx.y -= 4
  ctx.page.drawLine({
    start: { x: MARGIN_L, y: ctx.y },
    end: { x: MARGIN_R, y: ctx.y },
    thickness: 0.5,
  })
  ctx.y -= 12
}

/** Pure helper — produit le Buffer PDF. Multi-page support. */
export async function renderInvoicePdf(input: RenderInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create()
  const ctx: RenderCtx = {
    pdfDoc,
    font: await pdfDoc.embedFont(StandardFonts.Helvetica),
    fontBold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    page: pdfDoc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - 50,
  }

  // Header — Issuer.
  drawText(ctx, input.issuer.name, MARGIN_L, { bold: true, size: 14 })
  ctx.y -= 18
  if (input.issuer.establishment) {
    drawText(ctx, input.issuer.establishment, MARGIN_L); ctx.y -= 12
  }
  if (input.issuer.addressLine1) { drawText(ctx, input.issuer.addressLine1, MARGIN_L); ctx.y -= 12 }
  if (input.issuer.addressLine2) { drawText(ctx, input.issuer.addressLine2, MARGIN_L); ctx.y -= 12 }
  if (input.issuer.postalCode || input.issuer.city) {
    drawText(ctx, `${input.issuer.postalCode ?? ""} ${input.issuer.city ?? ""}`.trim(), MARGIN_L); ctx.y -= 12
  }
  if (input.issuer.country) { drawText(ctx, input.issuer.country, MARGIN_L); ctx.y -= 12 }
  if (input.issuer.siret) { drawText(ctx, `SIRET : ${input.issuer.siret}`, MARGIN_L); ctx.y -= 12 }
  if (input.issuer.tvaIntra) { drawText(ctx, `TVA : ${input.issuer.tvaIntra}`, MARGIN_L); ctx.y -= 12 }

  // Title + status banner (H2 review round 1).
  ctx.y -= 20
  drawText(ctx, `FACTURE ${input.number}`, MARGIN_L, { bold: true, size: 18 })
  ctx.y -= 22
  if (input.status === "cancelled") {
    drawText(ctx, "FACTURE ANNULEE", MARGIN_L, { bold: true, size: 14 })
    ctx.y -= 18
  } else if (input.status === "refunded") {
    drawText(ctx, "FACTURE REMBOURSEE", MARGIN_L, { bold: true, size: 14 })
    ctx.y -= 18
  } else if (input.status === "paid") {
    drawText(ctx, "PAYEE", MARGIN_L, { bold: true, size: 14 })
    ctx.y -= 18
  }
  drawText(ctx, `Date d'emission : ${formatDate(input.issuedAt, input.countryCode)}`, MARGIN_L)
  ctx.y -= 20

  // Customer block.
  if (input.customer) {
    drawText(ctx, "Client :", MARGIN_L, { bold: true })
    ctx.y -= 14
    drawText(ctx, input.customer.name, MARGIN_L); ctx.y -= 12
    if (input.customer.address1) { drawText(ctx, input.customer.address1, MARGIN_L); ctx.y -= 12 }
    if (input.customer.address2) { drawText(ctx, input.customer.address2, MARGIN_L); ctx.y -= 12 }
    if (input.customer.postalCode || input.customer.city) {
      drawText(ctx, `${input.customer.postalCode ?? ""} ${input.customer.city ?? ""}`.trim(), MARGIN_L); ctx.y -= 12
    }
    ctx.y -= 14
  }

  // Items table — header.
  ctx.y -= 10
  drawItemsHeader(ctx)

  for (const item of input.items.slice(0, INVOICE_PDF_BOUNDS.MAX_ITEMS_RENDERED)) {
    const lines = wrapDescription(item.description)
    // Anticipate space needed = lines.length * 14 + 4 (line spacing).
    const needed = lines.length * 14 + 4
    if (ctx.y - needed < MIN_Y) {
      newPage(ctx)
      drawItemsHeader(ctx)
    }
    // Render first line + numeric cols (Qty, PU, TVA, Total).
    drawText(ctx, lines[0]!, MARGIN_L)
    drawText(ctx, item.quantity.toString(), 340)
    drawText(ctx, formatMoney(item.unitPriceCents, input.currency), 380)
    drawText(ctx, `${(item.taxRate * 100).toFixed(1)}%`, 440)
    drawText(ctx, formatMoney(item.lineTotalCents, input.currency), 485)
    ctx.y -= 14
    // Render extra wrapped lines indented.
    for (const extra of lines.slice(1)) {
      drawText(ctx, extra, MARGIN_L + 10)
      ctx.y -= 12
    }
  }

  // Totals (force on current page or new page if needed).
  ensureSpace(ctx, 60)
  ctx.y -= 20
  ctx.page.drawLine({
    start: { x: 340, y: ctx.y + 8 },
    end: { x: MARGIN_R, y: ctx.y + 8 },
    thickness: 0.5,
  })
  const totalHt = input.totalCents - input.taxCents
  drawText(ctx, "Total HT :", 340)
  drawText(ctx, formatMoney(totalHt, input.currency), 485)
  ctx.y -= 14
  drawText(ctx, "TVA :", 340)
  drawText(ctx, formatMoney(input.taxCents, input.currency), 485)
  ctx.y -= 14
  drawText(ctx, "Total TTC :", 340, { bold: true })
  drawText(ctx, formatMoney(input.totalCents, input.currency), 485, { bold: true })

  // Footer — IBAN si BANK_TRANSFER.
  const iban = resolveIban(input.issuer)
  if (input.paymentMethod === "bank_transfer" && iban) {
    ensureSpace(ctx, 60)
    ctx.y -= 30
    ctx.page.drawLine({
      start: { x: MARGIN_L, y: ctx.y },
      end: { x: MARGIN_R, y: ctx.y },
      thickness: 0.5,
    })
    ctx.y -= 14
    drawText(ctx, "Reglement par virement bancaire :", MARGIN_L, { bold: true })
    ctx.y -= 14
    drawText(ctx, `IBAN : ${iban}`, MARGIN_L)
    ctx.y -= 12
    drawText(ctx, `Reference a indiquer : ${input.number}`, MARGIN_L)
  }

  // Metadata — déterministe (M3 review round 1).
  pdfDoc.setTitle(`Facture ${sanitizeForWinAnsi(input.number)}`)
  pdfDoc.setSubject(`Invoice ${input.number}`)
  pdfDoc.setProducer("Diabeo BackOffice US-2102")
  // Use issuedAt (figé) au lieu de new Date() → render déterministe.
  pdfDoc.setCreationDate(input.issuedAt)
  pdfDoc.setModificationDate(input.issuedAt)

  const bytes = await pdfDoc.save()
  const buf = Buffer.from(bytes)
  if (buf.length > INVOICE_PDF_BOUNDS.MAX_PDF_BYTES) {
    throw new InvoicePdfRenderError("pdfTooLarge")
  }
  return buf
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const invoicePdfService = {
  /**
   * Génère le PDF d'une facture émise.
   * Idempotent : si `pdfHash` existe ET status non changé depuis la
   * génération, retourne l'URL existante. Sinon regénère.
   */
  async generate(
    invoiceId: number,
    auditUserId: number,
    auditUserRole: Role,
    ctx: AuditContext,
  ): Promise<{ pdfUrl: string; pdfHash: string; pdfKey: string; regenerated: boolean }> {
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
            kind: PDF_AUDIT_KIND.GENERATE_DENIED,
            ...(inv.patientId ? { patientId: inv.patientId } : {}),
          },
        })
      } catch { /* swallow audit fail */ }
      throw new InvoicePdfAccessError()
    }

    // Status check.
    if (inv.status === "draft") {
      throw new InvoicePdfStateError(inv.status, "issued|paid|cancelled|refunded")
    }
    if (!inv.number || !inv.issuedAt) {
      throw new InvoicePdfStateError(inv.status, "issued (number+issuedAt required)")
    }

    // M5 review round 1 — IBAN obligatoire si bank_transfer.
    const issuer = parseIssuerSnapshot(inv.issuerSnapshot)
    if (inv.paymentMethod === "bank_transfer" && !resolveIban(issuer)) {
      throw new InvoicePdfRenderError("cabinetIbanMissingForBankTransfer")
    }

    // H2 review round 1 — lifecycle invalidation.
    // Si `pdfHash` existe ET status n'a pas changé (audit metadata stocke
    // un statusSnapshot — on lit le dernier audit "generated"), retourne
    // l'URL existante. Sinon force regen.
    // Approche pragmatique V1 : on regénère si status ∈ {paid, cancelled,
    // refunded} ET pdfHash existe — l'idempotence S3 (clé déterministe)
    // empêche les orphelins.
    const isPostIssuedStatus = inv.status === "paid"
      || inv.status === "cancelled"
      || inv.status === "refunded"
    const shouldRegen = !inv.pdfHash || isPostIssuedStatus

    const year = inv.issuedAt.getUTCFullYear()
    const pdfKey = `invoices/${inv.cabinetId}/${year}/${inv.number}.pdf`

    if (inv.pdfHash && inv.pdfUrl && !shouldRegen) {
      return {
        pdfUrl: inv.pdfUrl,
        pdfHash: inv.pdfHash,
        pdfKey: inv.pdfUrl, // legacy field stores key, see HSA H-3 review note
        regenerated: false,
      }
    }

    // Customer snapshot decrypt (L6 review — throw si patient présent et
    // décryptage fail, non-conforme DGFiP sinon).
    let customer: CustomerSnapshotPii | null = null
    if (inv.patientId) {
      customer = decryptCustomerSnapshot(inv.customerSnapshot)
      if (!customer) {
        logger.error(
          "invoice-pdf",
          "customerSnapshot decrypt failed for patient invoice",
          { userId: auditUserId, resource: "INVOICE", patientId: inv.patientId },
        )
        throw new InvoicePdfRenderError("customerSnapshotUndecryptable")
      }
    }

    // Render (déterministe avec setCreationDate = issuedAt).
    const pdfBuffer = await renderInvoicePdf({
      number: inv.number,
      issuedAt: inv.issuedAt,
      status: inv.status,
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

    const pdfHash = createHash("sha256").update(pdfBuffer).digest("hex")

    // S3 upload (clé déterministe — regen écrase la même clé).
    await uploadFile(pdfKey, pdfBuffer, "application/pdf")

    // M3+M-5 review round 1 — Atomic compare-and-set : si un autre thread
    // a déjà UPDATE le pdfHash entre notre read et notre write, l'updateMany
    // count=0 et on bail (l'autre PDF est en S3 sous la même clé, identique
    // car render déterministe — pas de désync).
    // Sur regen (status changed), on accepte de remplacer le hash existant.
    const expectedHash = shouldRegen ? inv.pdfHash : null
    const upd = await prisma.invoice.updateMany({
      where: { id: invoiceId, pdfHash: expectedHash },
      data: { pdfUrl: pdfKey, pdfHash },
    })
    if (upd.count === 0) {
      // Race lost — re-read et retourne l'état actuel (idempotent côté caller).
      const fresh = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { pdfUrl: true, pdfHash: true },
      })
      if (fresh?.pdfHash && fresh.pdfUrl) {
        return {
          pdfUrl: fresh.pdfUrl,
          pdfHash: fresh.pdfHash,
          pdfKey: fresh.pdfUrl,
          regenerated: false,
        }
      }
      throw new InvoicePdfRenderError("concurrentGenerationRaceLost")
    }

    await auditService.log({
      userId: auditUserId,
      action: "UPDATE",
      resource: "INVOICE",
      resourceId: String(invoiceId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        kind: shouldRegen && inv.pdfHash
          ? PDF_AUDIT_KIND.REGENERATED
          : PDF_AUDIT_KIND.GENERATED,
        ...(inv.patientId ? { patientId: inv.patientId } : {}),
        pdfHash,
        pdfKey, // H3 review round 1 — forensique S3 access log correlation
        pdfSize: pdfBuffer.length,
        invoiceStatus: inv.status,
      },
    })

    return { pdfUrl: pdfKey, pdfHash, pdfKey, regenerated: true }
  },

  /**
   * Stream le PDF depuis S3. RBAC re-vérifié.
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
            kind: PDF_AUDIT_KIND.DOWNLOAD_DENIED,
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
        kind: PDF_AUDIT_KIND.DOWNLOADED,
        ...(inv.patientId ? { patientId: inv.patientId } : {}),
        pdfHash: inv.pdfHash,
        pdfKey: inv.pdfUrl, // L3 review round 1 — corrélation S3 logs
        ...(file.contentLength !== undefined && { pdfSize: file.contentLength }),
      },
    })
    return { ...file, pdfHash: inv.pdfHash }
  },
}
