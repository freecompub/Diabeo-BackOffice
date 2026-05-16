/**
 * @module services/ins
 * @description US-2026 — INS (Identite Nationale de Sante) lifecycle.
 *
 * **Perimetre V1 standalone** : stockage chiffre + validation format
 * + lookup HMAC anti-doublon RNIPP. L'integration ANS Teleservice INSi
 * (verification temps-reel) reste **V2** (US-2126, bloque procurement
 * habilitation ANS 5-10k€).
 *
 * ### Format INS (15 chiffres)
 *
 * Conforme NIR / NIA / INS-NIA-temporaire publiees par ANS :
 *   - Position 1 : sexe (1=M, 2=F, 3-4=non-determine, 7-8=temporaire INS)
 *   - Positions 2-3 : annee naissance (00-99)
 *   - Positions 4-5 : mois naissance (01-12, plus 20/30/31/41-99 pour INS
 *                     temporaire)
 *   - Positions 6-7 : departement (01-95, 96-99 etranger, 9A-9Z DOM)
 *   - Positions 8-10 : code commune (000-999)
 *   - Positions 11-13 : ordre de naissance (001-999)
 *   - Positions 14-15 : cle Luhn-97
 *
 * Validation cle : `cle = 97 - (NIR_13_digits mod 97)`.
 *
 * ### Securite HDS / RGPD Art. 9
 *
 *   - Plaintext jamais journalise (audit log = metadata sans ins).
 *   - Stockage AES-256-GCM (`User.ins` base64).
 *   - Lookup unique via HMAC-SHA256 (`User.insHmac`, partial unique idx).
 *   - Une ligne audit par operation (set/get/clear/lookup).
 */

import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { hmacField } from "@/lib/crypto/hmac"

// ─────────────────────────────────────────────────────────────
// Erreurs typees
// ─────────────────────────────────────────────────────────────

export class InsValidationError extends Error {
  constructor(public field: string, public reason: string) {
    super(`ins:${field}:${reason}`)
    this.name = "InsValidationError"
  }
}

export class InsCollisionError extends Error {
  constructor() {
    super("INS already registered for another user")
    this.name = "InsCollisionError"
  }
}

export class InsNotFoundError extends Error {
  constructor() {
    super("User not found or no INS set")
    this.name = "InsNotFoundError"
  }
}

// ─────────────────────────────────────────────────────────────
// Audit kinds typees (US-2268 — resourceId = User.id natif)
// ─────────────────────────────────────────────────────────────

export type InsAuditKind =
  | "user.ins.set"
  | "user.ins.cleared"
  | "user.ins.read"
  | "user.ins.collision"

const AUDIT_KIND = {
  SET: "user.ins.set",
  CLEARED: "user.ins.cleared",
  READ: "user.ins.read",
  COLLISION: "user.ins.collision",
} as const satisfies Record<string, InsAuditKind>

// ─────────────────────────────────────────────────────────────
// Validation format INS — pure helpers
// ─────────────────────────────────────────────────────────────

/**
 * Validation stricte du format INS-NIR (15 chiffres + cle Luhn-97).
 *
 * @param ins Chaine candidate.
 * @returns `true` si valide.
 * @example
 * isValidInsFormat("1234567890123") // false (manque cle)
 * isValidInsFormat("199012a123456") // false (non-numerique)
 * isValidInsFormat("1990123450001 23") // false (espace)
 */
export function isValidInsFormat(ins: string): boolean {
  if (typeof ins !== "string") return false
  if (!/^\d{15}$/.test(ins)) return false
  return validateLuhn97(ins)
}

/**
 * Calcul + verification de la cle Luhn-97 du NIR francais.
 * Algorithme ANS : `cle = 97 - (NIR_13_digits mod 97)`.
 *
 * Note : les 13 premiers digits sont consideres comme un entier brut.
 * BigInt est utilise (13 chiffres max = 9 999 999 999 999 < 2^53 mais on
 * passe par BigInt pour exactitude, evite les bugs Number precision).
 *
 * @param ins15 INS de 15 chiffres exactement (deja valide format).
 * @returns `true` si la cle correspond.
 * @internal
 */
function validateLuhn97(ins15: string): boolean {
  if (ins15.length !== 15) return false
  const body = ins15.slice(0, 13)
  const cleExpectedStr = ins15.slice(13, 15)
  const cleExpected = parseInt(cleExpectedStr, 10)

  // BigInt pour eviter precision loss sur 13 digits (rare mais safe).
  // `BigInt(97)` syntaxe (vs litteral `97n`) pour compat tsconfig target.
  const bodyNum = BigInt(body)
  const cleComputed = BigInt(97) - (bodyNum % BigInt(97))

  return Number(cleComputed) === cleExpected
}

/**
 * Normalisation INS : strip whitespace + trim. Format ANS = digits only.
 *
 * @param raw Input utilisateur (peut contenir espaces : `1 99 01 23 456 001 23`).
 * @returns Chaine de digits sans espace ni separateurs.
 */
export function normalizeIns(raw: string): string {
  return raw.replace(/\s+/g, "").trim()
}

// ─────────────────────────────────────────────────────────────
// CRUD service
// ─────────────────────────────────────────────────────────────

export interface InsReadResult {
  /** Plaintext INS dechiffre. null si non renseigne (ou decrypt fail). */
  ins: string | null
  /** Indicateur "INS configure" (utile pour UI sans exposer plaintext). */
  hasIns: boolean
}

export const insService = {
  /**
   * Persiste un INS pour un User. Anti-doublon RNIPP via UNIQUE constraint
   * sur `insHmac`. Replay safe (idempotent : meme INS deja set = no-op
   * apres re-encrypt avec nouveau IV — pas de no-op strict pour audit).
   *
   * @throws InsValidationError si format invalide.
   * @throws InsCollisionError si INS deja registered pour un autre User.
   * @throws InsNotFoundError si User introuvable.
   */
  async setIns(
    targetUserId: number,
    rawIns: string,
    auditUserId: number,
    ctx: AuditContext,
    metadata: { patientId?: number } = {},
  ): Promise<{ updated: true }> {
    const ins = normalizeIns(rawIns)
    if (!isValidInsFormat(ins)) {
      throw new InsValidationError("ins", "invalidFormat")
    }

    const insEnc = encryptField(ins)
    const insHmac = hmacField(ins)

    // Anti-doublon : verifier qu'aucun AUTRE User n'a deja ce HMAC.
    // SELECT + audit collision separe (forensique anti-tentative-replay
    // sur INS existant) AVANT l'UPDATE.
    const existing = await prisma.user.findFirst({
      where: { insHmac, NOT: { id: targetUserId } },
      select: { id: true },
    })
    if (existing) {
      await auditService.log({
        userId: auditUserId,
        action: "UNAUTHORIZED",
        resource: "USER_INS",
        resourceId: String(targetUserId),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: {
          kind: AUDIT_KIND.COLLISION,
          collidingUserId: existing.id,
          ...(metadata.patientId && { patientId: metadata.patientId }),
        },
      })
      throw new InsCollisionError()
    }

    // Transaction : update + audit atomique (cohérence forensique HDS).
    return prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id: targetUserId },
        data: { ins: insEnc, insHmac },
      })
      if (result.count === 0) {
        throw new InsNotFoundError()
      }
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "USER_INS",
        resourceId: String(targetUserId),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: {
          kind: AUDIT_KIND.SET,
          ...(metadata.patientId && { patientId: metadata.patientId }),
        },
      })
      return { updated: true as const }
    })
  },

  /**
   * Lit l'INS dechiffre d'un User. Le caller assume avoir deja valide
   * le RBAC (typiquement via `resolvePatientForConsent` pour les routes
   * patient-scoped).
   *
   * @throws InsNotFoundError si User introuvable.
   */
  async getIns(
    targetUserId: number,
    auditUserId: number,
    ctx: AuditContext,
    metadata: { patientId?: number } = {},
  ): Promise<InsReadResult> {
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, ins: true },
    })
    if (!user) {
      throw new InsNotFoundError()
    }

    const ins = user.ins !== null ? safeDecryptField(user.ins) : null

    // Audit READ — toute consultation est tracee (HDS Art. L.1111-8).
    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "USER_INS",
      resourceId: String(targetUserId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        kind: AUDIT_KIND.READ,
        hasIns: ins !== null,
        ...(metadata.patientId && { patientId: metadata.patientId }),
      },
    })

    return { ins, hasIns: ins !== null }
  },

  /**
   * Efface l'INS d'un User (idempotent — efface deja efface = no-op).
   * Utilise pour RGPD Art. 17 (deletion) + correctif PS (saisie erronee).
   */
  async clearIns(
    targetUserId: number,
    auditUserId: number,
    ctx: AuditContext,
    metadata: { patientId?: number; reason?: "user_deletion" | "manual" } = {},
  ): Promise<{ cleared: boolean; alreadyCleared: boolean }> {
    return prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id: targetUserId, ins: { not: null } },
        data: { ins: null, insHmac: null },
      })
      if (result.count === 0) {
        return { cleared: true, alreadyCleared: true }
      }
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "USER_INS",
        resourceId: String(targetUserId),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: {
          kind: AUDIT_KIND.CLEARED,
          reason: metadata.reason ?? "manual",
          ...(metadata.patientId && { patientId: metadata.patientId }),
        },
      })
      return { cleared: true, alreadyCleared: false }
    })
  },
}
