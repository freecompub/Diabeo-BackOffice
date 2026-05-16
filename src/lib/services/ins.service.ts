/**
 * @module services/ins
 * @description US-2026 — INS (Identite Nationale de Sante) lifecycle.
 *
 * **Perimetre V1 standalone** : stockage chiffre + validation format
 * + lookup HMAC anti-doublon RNIPP + flag qualite `saisi_non_verifie`.
 * L'integration ANS Teleservice INSi (verification temps-reel) reste **V2**
 * (US-2126, bloque procurement habilitation ANS 5-10k€).
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
 *   - Lookup unique via HMAC-SHA256 (`User.insHmac`, UNIQUE NULLS DISTINCT).
 *   - Audit collision metadata `collidingUserId` HMAC-pepper anonymise
 *     (H1 review — anti leak cross-cabinet via `hmacAuditId`).
 *   - Race P2002 catchee + remappee `InsCollisionError` (H4 review).
 *   - Coherence traits hashee `insTraitsHash` (C1 review — detection trait
 *     drift post-set).
 *
 * ### Referentiel INS ANS v3 conformite
 *
 *   - `insQualityStatus = saisi_non_verifie` force V1 (sans INSi).
 *   - **Interdiction de partage hors-Diabeo** tant que qualite non-verifiee
 *     (§5.1 ANS) — enforced via `assertInsCanBeShared` (a appeler par
 *     US-2123 FHIR, US-2102 Facture si propagation downstream).
 */

import { Prisma } from "@prisma/client"
import { createHash } from "crypto"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { hmacIns, hmacAuditId } from "@/lib/crypto/hmac"
import type { Role, InsQualityStatus } from "@prisma/client"

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

/** H2 review — rate-limit collision attempts par caller (anti-enumeration RNIPP). */
export class InsCollisionRateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Too many INS collision attempts (retry after ${retryAfterSec}s)`)
    this.name = "InsCollisionRateLimitError"
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
  | "user.ins.accessDenied"
  | "user.ins.rate_limited"

const AUDIT_KIND = {
  SET: "user.ins.set",
  CLEARED: "user.ins.cleared",
  READ: "user.ins.read",
  COLLISION: "user.ins.collision",
  ACCESS_DENIED: "user.ins.accessDenied",
  RATE_LIMITED: "user.ins.rate_limited",
} as const satisfies Record<string, InsAuditKind>

export { AUDIT_KIND as INS_AUDIT_KIND }

// ─────────────────────────────────────────────────────────────
// Rate-limit anti-enumeration (H2 review — sliding window 24h).
// ─────────────────────────────────────────────────────────────

/**
 * Compte les collisions INS par `auditUserId` sur 24h glissantes via
 * `audit_logs` (kind=user.ins.collision). Cap a 5 (un PS legitime
 * n'enumere pas 5 INS distincts par jour). Au-dela, lockout 24h.
 */
const INS_COLLISION_WINDOW_HOURS = 24
const INS_COLLISION_MAX_PER_WINDOW = 5

async function assertNotRateLimited(
  auditUserId: number,
  ctx: AuditContext,
): Promise<void> {
  const since = new Date(Date.now() - INS_COLLISION_WINDOW_HOURS * 3600_000)
  const count = await prisma.auditLog.count({
    where: {
      userId: auditUserId,
      resource: "USER_INS",
      action: "UNAUTHORIZED",
      createdAt: { gte: since },
      // Filtre metadata.kind = "user.ins.collision" via JSON path
      // (PG GIN index sur metadata supporte ce query).
      metadata: { path: ["kind"], equals: AUDIT_KIND.COLLISION },
    },
  })
  if (count >= INS_COLLISION_MAX_PER_WINDOW) {
    // Audit rate-limit hit (SOC alerte burst detection).
    await auditService.log({
      userId: auditUserId,
      action: "UNAUTHORIZED",
      resource: "USER_INS",
      resourceId: "rate_limit",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: { kind: AUDIT_KIND.RATE_LIMITED, attempts: count },
    }).catch(() => undefined)
    throw new InsCollisionRateLimitError(INS_COLLISION_WINDOW_HOURS * 3600)
  }
}

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
 * isValidInsFormat("190017A00100196") // false (non-numerique)
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
 * BigInt pour exactitude (13 chiffres = 9.999... < 2^53 mais defense-in-depth).
 * `BigInt(97)` syntaxe (vs litteral `97n`) pour compat tsconfig target ES2017.
 *
 * @param ins15 INS de 15 chiffres exactement (deja valide format regex).
 * @returns `true` si la cle correspond.
 * @internal
 */
function validateLuhn97(ins15: string): boolean {
  if (ins15.length !== 15) return false
  const body = ins15.slice(0, 13)
  const cleExpected = parseInt(ins15.slice(13, 15), 10)

  // Defense-in-depth : BigInt(body) throw SyntaxError sur non-digit.
  // Le regex check precedent garantit pas de throw mais on guard.
  let bodyNum: bigint
  try {
    bodyNum = BigInt(body)
  } catch {
    return false
  }
  const cleComputed = BigInt(97) - (bodyNum % BigInt(97))
  return Number(cleComputed) === cleExpected
}

/**
 * Normalisation INS : strip whitespace + trim. Format ANS = digits only.
 */
export function normalizeIns(raw: string): string {
  return raw.replace(/\s+/g, "").trim()
}

// ─────────────────────────────────────────────────────────────
// Traits hash (C1 review — detection trait drift post-set)
// ─────────────────────────────────────────────────────────────

/**
 * Calcule SHA-256 hex du tuple `(firstnameHmac, lastnameHmac, birthday,
 * sex, codeBirthPlace)`. Stocke au moment du set INS, compare au moment de
 * re-set/check qualite. Permet de detecter qu'un trait a change
 * post-saisie INS (declenche workflow re-verification INSi futur V2).
 *
 * Note : utilise les HMAC existants des traits (deja stockes) pour ne pas
 * deciffrer les plaintext. Si un trait est null → on hash "null" string.
 *
 * @internal
 */
export function computeTraitsHash(
  traits: {
    firstnameHmac: string | null
    lastnameHmac: string | null
    birthday: Date | null
    sex: string | null
    codeBirthPlace: string | null
  },
): string {
  const tuple = [
    traits.firstnameHmac ?? "null",
    traits.lastnameHmac ?? "null",
    traits.birthday ? traits.birthday.toISOString().split("T")[0] : "null",
    traits.sex ?? "null",
    traits.codeBirthPlace ?? "null",
  ].join("|")
  return createHash("sha256").update(tuple).digest("hex")
}

// ─────────────────────────────────────────────────────────────
// CRUD service
// ─────────────────────────────────────────────────────────────

export interface InsReadResult {
  /** Plaintext INS dechiffre. null si non renseigne. */
  ins: string | null
  /** Indicateur "INS configure" (UI sans exposer plaintext). */
  hasIns: boolean
  /** Statut qualite Referentiel ANS — null si pas d'INS. */
  qualityStatus: InsQualityStatus | null
  /** Timestamp du set INS. */
  setAt: Date | null
}

export const insService = {
  /**
   * Persiste un INS pour un User (V1 force qualite `saisi_non_verifie`).
   *
   * Workflow :
   *   1. Validation format Luhn-97 (defense-in-depth applicative).
   *   2. Rate-limit anti-enumeration (5 collisions/24h/auditUserId — H2).
   *   3. Lookup HMAC anti-doublon RNIPP (autres users).
   *   4. Si collision → audit `collidingUserIdHmac` (anonymise H1) + throw.
   *   5. Recupere traits actuels User + calcule `traitsHash`.
   *   6. Transaction : updateMany + audit `set` avec chainage
   *      `previousInsHmac` (forensique LOW review).
   *
   * Note `updateMany` vs `update` (M5 review) : `updateMany` permet le
   * filtre additionnel `WHERE` futur (ex. `deletedAt: null`) sans devoir
   * refactorer. `update({where:{id}})` necessite que `id` soit @id/@unique
   * et catch P2025 NotFound — equivalent fonctionnel mais moins flexible.
   *
   * @throws InsValidationError si format invalide.
   * @throws InsCollisionError si INS deja registered pour un autre User
   *                            (ou race P2002 H4).
   * @throws InsCollisionRateLimitError si > 5 collisions/24h (H2).
   * @throws InsNotFoundError si User cible introuvable.
   */
  async setIns(
    targetUserId: number,
    rawIns: string,
    auditUserId: number,
    auditUserRole: Role,
    ctx: AuditContext,
    metadata: { patientId?: number } = {},
  ): Promise<{ updated: true; qualityStatus: InsQualityStatus }> {
    const ins = normalizeIns(rawIns)
    if (!isValidInsFormat(ins)) {
      throw new InsValidationError("ins", "invalidFormat")
    }

    // H2 — rate-limit anti-enumeration AVANT lookup HMAC (= la lecture du
    // count audit_logs ne donne pas d'info attaquant).
    await assertNotRateLimited(auditUserId, ctx)

    const insHmac = hmacIns(ins)

    // Anti-doublon RNIPP : verifier qu'aucun AUTRE User n'a deja ce HMAC.
    const existing = await prisma.user.findFirst({
      where: { insHmac, NOT: { id: targetUserId } },
      select: { id: true },
    })
    if (existing) {
      // H1 review — HMAC anonymise collidingUserId (DPO/RSSI re-correle
      // via fonction interne dediee, PS audit reader ne voit qu'un hash).
      const collidingUserIdHmac = hmacAuditId(
        "ins-collision",
        existing.id,
      )
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
          collidingUserIdHmac, // ID anonymise (H1)
          ...(metadata.patientId && { patientId: metadata.patientId }),
        },
      })
      throw new InsCollisionError()
    }

    // Recupere les traits + previousInsHmac actuels pour audit chainage (LOW HSA-F8).
    const userRow = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        firstnameHmac: true,
        lastnameHmac: true,
        birthday: true,
        sex: true,
        codeBirthPlace: true,
        insHmac: true,
      },
    })
    if (!userRow) {
      throw new InsNotFoundError()
    }
    const traitsHash = computeTraitsHash(userRow)
    const previousInsHmac = userRow.insHmac

    const insEnc = encryptField(ins)
    const now = new Date()

    // H4 review — try/catch P2002 race condition (entre findFirst et update
    // un autre thread peut inserer le meme HMAC → 500 sinon).
    try {
      return await prisma.$transaction(async (tx) => {
        const result = await tx.user.updateMany({
          where: { id: targetUserId },
          data: {
            ins: insEnc,
            insHmac,
            insQualityStatus: "saisi_non_verifie",
            insSetAt: now,
            insSetByUserId: auditUserId,
            insTraitsHash: traitsHash,
          },
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
            qualityStatus: "saisi_non_verifie",
            // H5 review — role du saisisseur (forensique identitovigilance).
            setByRole: auditUserRole,
            // LOW HSA-F8 — chainage forensique (sans plaintext).
            ...(previousInsHmac && { previousInsHmac }),
            ...(metadata.patientId && { patientId: metadata.patientId }),
          },
        })
        return { updated: true as const, qualityStatus: "saisi_non_verifie" as const }
      })
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError
        && e.code === "P2002"
        && Array.isArray(e.meta?.target)
        && (e.meta.target as string[]).some((t) => t === "ins_hmac")
      ) {
        // Race lost — un autre thread a insere le meme INS entre findFirst
        // et updateMany. On remappe en InsCollisionError pour cohérence.
        throw new InsCollisionError()
      }
      throw e
    }
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
      select: {
        id: true,
        ins: true,
        insQualityStatus: true,
        insSetAt: true,
      },
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
        qualityStatus: user.insQualityStatus,
        ...(metadata.patientId && { patientId: metadata.patientId }),
      },
    })

    return {
      ins,
      hasIns: ins !== null,
      qualityStatus: user.insQualityStatus,
      setAt: user.insSetAt,
    }
  },

  /**
   * Efface l'INS d'un User (idempotent — efface deja efface = no-op).
   * Utilise pour RGPD Art. 17 (deletion cascade) + correctif PS.
   *
   * Note M5 — `updateMany` necessaire car filtre `{ ins: { not: null } }`
   * pas exprimable via `update({where:{id}})` (where unique limite a @id/@unique).
   *
   * Note F8 review — `clearIns` masque silencieusement un userId inexistant
   * (count=0 sur User inexistant = meme reponse que User-sans-INS). Choix
   * de design intent : DELETE idempotent. Si validation user-must-exist
   * requise futur, ajouter findFirst prealable.
   */
  async clearIns(
    targetUserId: number,
    auditUserId: number,
    ctx: AuditContext,
    metadata: { patientId?: number; reason?: "user_deletion" | "manual" } = {},
  ): Promise<{ cleared: boolean; alreadyCleared: boolean }> {
    return prisma.$transaction(async (tx) => {
      // Recupere previousInsHmac pour chainage forensique (LOW HSA-F8).
      const userRow = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { insHmac: true },
      })
      const previousInsHmac = userRow?.insHmac ?? null

      const result = await tx.user.updateMany({
        where: { id: targetUserId, ins: { not: null } },
        data: {
          ins: null,
          insHmac: null,
          insQualityStatus: null,
          insSetAt: null,
          insSetByUserId: null,
          insTraitsHash: null,
        },
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
          ...(previousInsHmac && { previousInsHmac }),
          ...(metadata.patientId && { patientId: metadata.patientId }),
        },
      })
      return { cleared: true, alreadyCleared: false }
    })
  },

  /**
   * Helper export — assert que l'INS peut etre partage hors-Diabeo selon
   * Referentiel INS ANS v3 §5.1.
   *
   * V1 retourne toujours `false` pour `saisi_non_verifie` (interdit DMP,
   * MSSante, FHIR, factures DGFiP). V2 US-2126 elargit a `insi_recupere`
   * et `insi_verifie`.
   *
   * Usage : appeler depuis US-2123 FHIR ou US-2102 Facture AVANT d'inclure
   * l'INS dans un payload externe.
   */
  canBeSharedExternally(quality: InsQualityStatus | null): boolean {
    return quality === "insi_recupere" || quality === "insi_verifie"
  },
}
