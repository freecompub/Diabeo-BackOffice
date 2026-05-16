/**
 * @module services/ins
 * @description US-2026 — INS (Identite Nationale de Sante) lifecycle.
 *
 * **Perimetre V1 standalone** : stockage chiffre + validation format
 * + structure ANS + lookup HMAC anti-doublon RNIPP + flag qualite
 * `saisi_non_verifie`. L'integration ANS Teleservice INSi (verification
 * temps-reel) reste **V2** (US-2126, bloque procurement habilitation
 * ANS 5-10k€).
 *
 * ### Format INS (15 chiffres)
 *
 * Conforme NIR / NIA / INS-NIA-temporaire publiees par ANS :
 *   - Position 1 : sexe (1=M, 2=F, 3-4=non-determine, 7-8=temporaire INS)
 *   - Positions 2-3 : annee naissance (00-99)
 *   - Positions 4-5 : mois naissance (01-12, plus 20/30/31/41-99 pour INS
 *                     temporaire)
 *   - Positions 6-7 : departement (01-99 metropolitain/etranger, 9A-9Z DOM
 *                     hors scope V1 — Diabeo metropolitain only)
 *   - Positions 8-10 : code commune (000-999)
 *   - Positions 11-13 : ordre de naissance (001-999)
 *   - Positions 14-15 : cle Luhn-97
 *
 * Validation cle : `cle = 97 - (NIR_13_digits mod 97)`.
 *
 * ### Securite HDS / RGPD Art. 9 / ANSSI RGS
 *
 *   - Plaintext jamais journalise.
 *   - Stockage AES-256-GCM (`User.ins` base64).
 *   - Lookup unique via HMAC-SHA256 (`User.insHmac`).
 *   - Audit collision metadata `collidingUserIdHmac` peppered (H1 review
 *     anti leak cross-cabinet via `hmacAuditId`).
 *   - Audit `previousInsHmac` peppered via `hmacAuditId("ins-history", ...)`
 *     (L1 round 3 — sinon JOIN audit_logs ↔ users.ins_hmac demasque).
 *   - Race P2002 catch → `InsCollisionError` (H4 review round 2).
 *   - Rate-limit anti-enumeration 5/24h avec `pg_advisory_xact_lock`
 *     atomique (H2 round 3 — anti-TOCTOU race parallele).
 *   - Forensic audit `rate_limited` emit-once-per-window (M1 round 3
 *     anti audit log amplification).
 *   - `insTraitsHash` HMAC-SHA256(HMAC_SECRET) — pas SHA-256 nu (M5 round 3
 *     anti bruteforce GPU sur dump SQL leak).
 *
 * ### Referentiel INS ANS v3 conformite
 *
 *   - `insQualityStatus = saisi_non_verifie` force V1 (sans INSi).
 *   - **Interdiction de partage hors-Diabeo** §5.1 enforced via Branded
 *     type `QualifiedIns` (H3 round 3) — impossible d'appeler les
 *     futurs serializers US-2123 FHIR / US-2102 Facture sans
 *     `assertQualifiedForSharing` qui throw si quality non-validee.
 */

import { Prisma } from "@prisma/client"
import { createHmac } from "crypto"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { hmacIns, hmacAuditId } from "@/lib/crypto/hmac"
import type { Role, InsQualityStatus } from "@prisma/client"

// ─────────────────────────────────────────────────────────────
// Branded type — H3 round 3 review
// ─────────────────────────────────────────────────────────────

/**
 * Brand qui empeche un INS non-qualifie d'etre passe a un serializer
 * partage hors-Diabeo. Le brand est unique => meme un cast `as string`
 * ne le produit pas. Seul `assertQualifiedForSharing` retourne ce type.
 *
 * Usage (futur US-2123 / US-2102) :
 * ```typescript
 * const ins: QualifiedIns = assertQualifiedForSharing(decrypted, quality)
 * fhirBundle.patient.identifier.value = ins  // OK
 * msSantePayload.ins = ins                   // OK
 * ```
 */
declare const QualifiedInsBrand: unique symbol
export type QualifiedIns = string & { readonly [QualifiedInsBrand]: never }

export class InsNotQualifiedError extends Error {
  constructor(public quality: InsQualityStatus | null) {
    super(`INS not qualified for external sharing (status=${quality})`)
    this.name = "InsNotQualifiedError"
  }
}

/**
 * H3 review — Guard statique pour les serializers downstream (FHIR, Facture).
 * Throw si l'INS n'est pas `insi_recupere` ou `insi_verifie` (V1 force
 * `saisi_non_verifie` → toujours throw). Conforme Referentiel INS ANS §5.1.
 */
export function assertQualifiedForSharing(
  ins: string,
  quality: InsQualityStatus | null,
): QualifiedIns {
  if (!insService.canBeSharedExternally(quality)) {
    throw new InsNotQualifiedError(quality)
  }
  return ins as QualifiedIns
}

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
// Rate-limit anti-enumeration (H2 + M1 round 3 — advisory lock + emit-once)
// ─────────────────────────────────────────────────────────────

const INS_COLLISION_WINDOW_HOURS = 24
const INS_COLLISION_MAX_PER_WINDOW = 5

// Type alias pour transaction Prisma 7 (interactive transaction context).
type TxClient = Prisma.TransactionClient

/**
 * H2 round 3 — `pg_advisory_xact_lock` serialise les setIns concurrents
 * par `auditUserId` dans la meme transaction. Le lock est relache
 * automatiquement au COMMIT/ROLLBACK → pas de leak ressource.
 *
 * `hashtextextended(text, seed)` produit un bigint stable, parfait pour
 * advisory lock key (sinon collision possible sur hash 32-bit).
 */
async function acquireRateLimitLock(
  tx: TxClient,
  auditUserId: number,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    `ins-rate-limit:${auditUserId}`,
  )
}

/**
 * Compte les collisions INS par `auditUserId` sur 24h glissantes via
 * `audit_logs` (kind=user.ins.collision). Cap a 5. Au-dela, lockout 24h.
 *
 * Doit etre appele DANS la transaction qui a deja acquis advisory lock
 * via `acquireRateLimitLock` (sinon TOCTOU race parallele).
 *
 * M1 round 3 review — emit `rate_limited` audit row UNE seule fois par
 * fenetre 24h (sinon amplification : 1 audit row par call pendant lockout).
 */
async function assertNotRateLimited(
  tx: TxClient,
  auditUserId: number,
  ctx: AuditContext,
): Promise<void> {
  const since = new Date(Date.now() - INS_COLLISION_WINDOW_HOURS * 3600_000)

  // Compte les collisions passees dans la fenetre.
  // HIGH-1 round 3 + Prisma F-1 — la query utilise l'index partiel
  // `audit_logs_ins_collision_by_user_idx` (migration round 3) :
  //   ON audit_logs (user_id, created_at DESC)
  //   WHERE resource='USER_INS' AND action='UNAUTHORIZED'
  //     AND metadata @> '{"kind":"user.ins.collision"}'
  // → O(log N + matching_collisions) sans seq scan.
  const count = await tx.auditLog.count({
    where: {
      userId: auditUserId,
      resource: "USER_INS",
      action: "UNAUTHORIZED",
      createdAt: { gte: since },
      metadata: { path: ["kind"], equals: AUDIT_KIND.COLLISION },
    },
  })

  if (count >= INS_COLLISION_MAX_PER_WINDOW) {
    // M1 round 3 — verifier si `rate_limited` audit deja emis cette fenetre
    // pour eviter amplification log spam pendant 24h lockout.
    const alreadyAlerted = await tx.auditLog.findFirst({
      where: {
        userId: auditUserId,
        resource: "USER_INS",
        action: "UNAUTHORIZED",
        createdAt: { gte: since },
        metadata: { path: ["kind"], equals: AUDIT_KIND.RATE_LIMITED },
      },
      select: { id: true },
    })
    if (!alreadyAlerted) {
      // M8 round 3 — resourceId = String(auditUserId) US-2268 convention
      // (caller dont l'attack surface est protegee, pas sentinel "rate_limit").
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UNAUTHORIZED",
        resource: "USER_INS",
        resourceId: String(auditUserId),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { kind: AUDIT_KIND.RATE_LIMITED, attempts: count },
      })
    }
    throw new InsCollisionRateLimitError(INS_COLLISION_WINDOW_HOURS * 3600)
  }
}

// ─────────────────────────────────────────────────────────────
// Validation format + structure INS — pure helpers
// ─────────────────────────────────────────────────────────────

/**
 * Validation stricte format + structure ANS + Luhn-97.
 *
 * Round 3 (M2 review) — vraie structure ANS (sexe / mois / dept), pas
 * juste Luhn. Sans ce check, INS "9999990000000XX" passerait Luhn ok mais
 * sexe=9 impossible per ANS — identitovigilance amplifier.
 */
export function isValidInsFormat(ins: string): boolean {
  if (typeof ins !== "string") return false
  if (!/^\d{15}$/.test(ins)) return false
  if (!isValidInsStructure(ins)) return false
  return validateLuhn97(ins)
}

/**
 * M2 round 3 review — structure ANS-NIR/NIA conforme Referentiel INS v3 §3.1.
 *
 *   - Sexe (pos 1) : {1, 2, 3, 4, 7, 8} (1/2 qualifie, 3/4 indetermine,
 *     7/8 INS-NIA temporaire).
 *   - Mois (pos 4-5) : 01-12 (NIR normal) OU 20/30/31/41-99 (NIA temporaire).
 *   - Dept (pos 6-7) : 01-99 (metropole + etranger). 9A-9Z DOM exclu V1
 *     (Diabeo metropolitain only — regex /^\d{15}$/ deja exclut DOM).
 *
 * @internal
 */
function isValidInsStructure(ins15: string): boolean {
  const sexe = ins15[0]
  if (!["1", "2", "3", "4", "7", "8"].includes(sexe)) return false

  const monthStr = ins15.slice(3, 5)
  const month = parseInt(monthStr, 10)
  const monthValid =
    (month >= 1 && month <= 12)
    || month === 20 || month === 30 || month === 31
    || (month >= 41 && month <= 99)
  if (!monthValid) return false

  const deptStr = ins15.slice(5, 7)
  const dept = parseInt(deptStr, 10)
  // 00 invalide. 01-95 metropole, 96-99 etranger ou DOM legacy.
  if (dept < 1 || dept > 99) return false

  return true
}

/**
 * Calcul + verification cle Luhn-97 du NIR francais.
 * Algorithme ANS : `cle = 97 - (NIR_13_digits mod 97)`.
 *
 * BigInt pour exactitude. `BigInt(97)` syntax pour compat tsconfig ES2017.
 *
 * @internal
 */
function validateLuhn97(ins15: string): boolean {
  if (ins15.length !== 15) return false
  const body = ins15.slice(0, 13)
  const cleExpected = parseInt(ins15.slice(13, 15), 10)

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
 * Normalisation INS : strip whitespace + trim.
 */
export function normalizeIns(raw: string): string {
  return raw.replace(/\s+/g, "").trim()
}

// ─────────────────────────────────────────────────────────────
// Traits hash (C1 + M5 round 3 — HMAC-SHA256 anti bruteforce)
// ─────────────────────────────────────────────────────────────

/**
 * M5 round 3 review — HMAC-SHA256(HMAC_SECRET) au lieu de SHA-256 nu.
 *
 * Pourquoi HMAC :
 *   - SHA-256 nu sur `(firstnameHmac|lastnameHmac|YYYY-MM-DD|sex|cog)` est
 *     bruteforce-feasible (~5.8 milliards combinaisons sex+date+cog,
 *     ~12s GPU consumer @ 500 MH/s).
 *   - HMAC avec secret 32 bytes = infeasible sans compromission secret.
 *
 * L2 round 3 — date convertie via `getUTCFullYear/Month/Date` pour
 * future-proof si schema passe a Timestamptz (sinon timezone-sensitive
 * sur drift detection).
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
  const key = process.env.HMAC_SECRET
  if (!key) throw new Error("HMAC_SECRET is not set")

  let dateStr = "null"
  if (traits.birthday) {
    const d = traits.birthday
    dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
  }
  const tuple = [
    traits.firstnameHmac ?? "null",
    traits.lastnameHmac ?? "null",
    dateStr,
    traits.sex ?? "null",
    traits.codeBirthPlace ?? "null",
  ].join("|")
  // Domain prefix "ins-traits:" → cross-domain key reuse separation RGS B1.2.
  return createHmac("sha256", key).update(`ins-traits:${tuple}`).digest("hex")
}

// ─────────────────────────────────────────────────────────────
// CRUD service
// ─────────────────────────────────────────────────────────────

export interface InsReadResult {
  ins: string | null
  hasIns: boolean
  qualityStatus: InsQualityStatus | null
  setAt: Date | null
}

export const insService = {
  /**
   * Persiste un INS pour un User (V1 force qualite `saisi_non_verifie`).
   *
   * Architecture round 3 :
   *   - Transaction unique avec advisory lock per-user (H2 atomique).
   *   - Pre-check rate-limit dans la meme tx.
   *   - Collision lookup HMAC.
   *   - Audit collision metadata `collidingUserIdHmac` peppered (H1).
   *   - Audit `previousInsHmac` peppered via hmacAuditId "ins-history" (L1).
   *   - Traits hash HMAC-SHA256 (M5).
   *   - Race P2002 catch → InsCollisionError (H4).
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

    const insHmac = hmacIns(ins)

    try {
      return await prisma.$transaction(async (tx) => {
        // H2 round 3 — advisory lock serialise les concurrents per-userId.
        await acquireRateLimitLock(tx, auditUserId)

        // Pre-check rate-limit dans la meme tx (snapshot consistent).
        await assertNotRateLimited(tx, auditUserId, ctx)

        // Anti-doublon RNIPP : verifier qu'aucun AUTRE User n'a deja ce HMAC.
        const existing = await tx.user.findFirst({
          where: { insHmac, NOT: { id: targetUserId } },
          select: { id: true },
        })
        if (existing) {
          // H1 review — HMAC peppered collidingUserId (anti leak cross-cabinet).
          const collidingUserIdHmac = hmacAuditId("ins-collision", existing.id)
          await auditService.logWithTx(tx, {
            userId: auditUserId,
            action: "UNAUTHORIZED",
            resource: "USER_INS",
            resourceId: String(targetUserId),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: {
              kind: AUDIT_KIND.COLLISION,
              collidingUserIdHmac,
              ...(metadata.patientId && { patientId: metadata.patientId }),
            },
          })
          throw new InsCollisionError()
        }

        // Recupere traits + previousInsHmac (LOW L1 round 3 — chainage forensique).
        const userRow = await tx.user.findUnique({
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
        const previousInsHmacPeppered = userRow.insHmac
          ? hmacAuditId("ins-history", userRow.insHmac)
          : null

        const insEnc = encryptField(ins)
        const now = new Date()

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
            setByRole: auditUserRole,
            ...(previousInsHmacPeppered && {
              previousInsHmacPeppered, // L1 round 3 — domain-separated HMAC
            }),
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
        // H4 — race lost entre findFirst et update : remap en collision coherente.
        throw new InsCollisionError()
      }
      throw e
    }
  },

  /**
   * Lit l'INS dechiffre d'un User.
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
   * Efface l'INS d'un User (idempotent).
   *
   * Round 3 :
   *   - M3 — `RepeatableRead` isolation pour eviter race findUnique↔updateMany
   *     qui pourrait perdre `previousInsHmac` chainage.
   *   - M4 — accepte un `tx` externe optionnel pour reutilisation par
   *     `deletion.service.ts` dans sa propre tx (sans nested $transaction).
   *   - L8 — `clearedByRole` dans audit metadata (asymétrie corrigée vs setIns).
   *   - L1 — `previousInsHmacPeppered` chainage forensique sans JOIN-leak.
   */
  async clearIns(
    targetUserId: number,
    auditUserId: number,
    auditUserRole: Role,
    ctx: AuditContext,
    metadata: { patientId?: number; reason?: "user_deletion" | "manual" } = {},
    externalTx?: TxClient,
  ): Promise<{ cleared: boolean; alreadyCleared: boolean }> {
    const exec = async (tx: TxClient) => {
      const userRow = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { insHmac: true },
      })
      const previousInsHmacPeppered = userRow?.insHmac
        ? hmacAuditId("ins-history", userRow.insHmac)
        : null

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
          clearedByRole: auditUserRole, // L8 round 3
          ...(previousInsHmacPeppered && { previousInsHmacPeppered }),
          ...(metadata.patientId && { patientId: metadata.patientId }),
        },
      })
      return { cleared: true, alreadyCleared: false }
    }

    if (externalTx) {
      // M4 round 3 — reuse caller transaction (deletion.service).
      return exec(externalTx)
    }
    // M3 round 3 — RepeatableRead pour eviter race findUnique/updateMany.
    return prisma.$transaction(exec, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    })
  },

  /**
   * H3 review — guard ANS §5.1 partage hors-Diabeo. Utilise par
   * `assertQualifiedForSharing` qui retourne `QualifiedIns` branded type.
   *
   * V1 retourne `false` pour `saisi_non_verifie` → US-2123 FHIR / US-2102
   * Facture ne peuvent pas propager. V2 US-2126 elargit aux statuts INSi.
   */
  canBeSharedExternally(quality: InsQualityStatus | null): boolean {
    return quality === "insi_recupere" || quality === "insi_verifie"
  },
}
