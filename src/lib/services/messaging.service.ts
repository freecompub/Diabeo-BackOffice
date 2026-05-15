/**
 * @module services/messaging
 * @description US-2076 scope A — Messagerie sécurisée 1↔1 patient↔PS et staff↔staff.
 *
 * Approche V1 (sans WebSocket) :
 *   - Envoi : POST `/api/messages` → encrypt AES-256-GCM → persist → FCM data-only.
 *   - Réception live : badge `GET /api/messages/unread-count` polled 60s côté client.
 *   - Mobile/offline : FCM push (corps lockscreen = `[message chiffré]`, jamais PHI).
 *   - WS realtime in-chat-screen → reporté V2 sous US-2076bis.
 *
 * RBAC `canMessage` :
 *   - patient↔PS : autorisé si PS (DOCTOR/NURSE) encadre le patient (referent OU
 *     PatientService) — ADMIN passe partout.
 *   - staff↔staff : autorisé si les deux HealthcareMember partagent le même
 *     `serviceId` (= même cabinet). ADMIN passe partout.
 *   - patient↔patient : interdit.
 *   - self↔self : interdit (CHECK DB + service-level).
 *
 * Audit HDS US-2268 :
 *   - `resource: "MESSAGE"`, `resourceId: <message.id>`.
 *   - `metadata.patientId` pivot si message contextualise un patient.
 *   - `metadata.conversationKey` pour forensique thread.
 *
 * Sécurité HDS :
 *   - Corps chiffré AES-256-GCM (IV+TAG+CIPHERTEXT) via `lib/crypto/health-data`.
 *   - Rate limit applicatif 100 msgs/min/user (in-memory, 1 VPS POC).
 *     ⚠️ H8 (review) — Multi-instance breaks this : pour scaling horizontal
 *     (> 1 VPS Node.js), migrer vers `@/lib/cache/redis-cache` atomic INCR+EXPIRE.
 *     Aujourd'hui cohérent avec `auth/rate-limit.ts` login (même ADR).
 *   - FCM payload n'expose JAMAIS le plaintext — body = `[message chiffré]`.
 *   - Decryption failure → `logger.error` (M3 review) pour alerte SOC.
 */

import { createHash } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { encrypt, decrypt, HealthDataDecryptionError } from "@/lib/crypto/health-data"
import { auditService, type AuditContext } from "./audit.service"
import { fcmService } from "./fcm.service"
import { logger } from "@/lib/logger"

/** Bornes applicatives — partagées avec les validators Zod côté routes. */
export const MESSAGING_BOUNDS = {
  /** Cap en octets UTF-8 plaintext (BLOCKER #1 fix review round 3).
   *  Aligné sur le CHECK SQL `OCTET_LENGTH(body_encrypted) <= 8192` :
   *  ciphertext_bytes = plaintext_utf8_bytes + IV(12) + TAG(16)
   *  Donc plaintext ≤ 8192 - 28 = 8164 octets UTF-8. */
  MAX_BODY_BYTES_UTF8: 8164,
  /** Cap codepoints UNUSED (legacy — gardé pour rétrocompat tests).
   *  La vraie validation se fait en octets UTF-8 via `MAX_BODY_BYTES_UTF8`. */
  MAX_BODY_CHARS: 4000,
  /** Quota anti-spam : 100 messages / minute / user. */
  RATE_LIMIT_PER_MIN: 100,
  /** Fenêtre glissante rate limit. */
  RATE_LIMIT_WINDOW_MS: 60_000,
  /** Pagination inbox (max threads par page). */
  MAX_THREADS_PER_QUERY: 100,
  /** Pagination thread. */
  MAX_MESSAGES_PER_PAGE: 50,
  /** Longueur exacte de `conversation_key` (SHA-256 hex). */
  CONVERSATION_KEY_LEN: 64,
  /** Hard cap mémoire rate-limit map (LRU eviction). */
  RATE_LIMIT_MAP_HARD_CAP: 10_000,
  /** Throttle decrypt-failure logs (1 log par seconde max).
   *  Évite log spam si DB corruption + reads volumineux. */
  DECRYPT_FAIL_LOG_THROTTLE_MS: 1_000,
} as const

export class MessagingValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message)
    this.name = "MessagingValidationError"
  }
}

export class MessagingAccessError extends Error {
  constructor(public reason: string) {
    super(reason)
    this.name = "MessagingAccessError"
  }
}

export class MessagingNotFoundError extends Error {
  constructor(message = "messageNotFound") {
    super(message)
    this.name = "MessagingNotFoundError"
  }
}

export class MessagingRateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("rateLimitExceeded")
    this.name = "MessagingRateLimitError"
  }
}

/**
 * Canonical conversation hash. SHA-256(min(uid):max(uid)) hex 64 chars.
 * Symétrique : `computeConversationKey(1, 2) === computeConversationKey(2, 1)`.
 */
export function computeConversationKey(userIdA: number, userIdB: number): string {
  if (!Number.isInteger(userIdA) || !Number.isInteger(userIdB) || userIdA <= 0 || userIdB <= 0) {
    throw new MessagingValidationError("userId", "invalidUserId")
  }
  if (userIdA === userIdB) {
    throw new MessagingValidationError("userId", "selfMessageForbidden")
  }
  const [a, b] = userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA]
  return createHash("sha256").update(`${a}:${b}`).digest("hex")
}

// ─────────────────────────────────────────────────────────────
// Rate limit in-memory (per VPS)
// ─────────────────────────────────────────────────────────────
//
// ⚠️ Note : compte les requêtes y compris en cas de validation/RBAC fail
// (C5 review — appliqué AVANT canMessage). Trade-off documenté : empêche
// DoS amplification via probes parallel sur `canMessage` (~4 queries DB).
// Le client est responsable de valider localement avant POST.
//
// Hardening (LOW review round 3) :
//   - LRU eviction utilise `lastSeenAt` (cohérent avec audit burst map).
//   - Clock skew negative (NTP slew) géré via reset windowStart.

interface RateBucket {
  count: number
  windowStart: number
  /** Dernière activité — pour LRU eviction cohérent (review LOW round 3). */
  lastSeenAt: number
}

const rateLimitMap = new Map<number, RateBucket>()

function checkAndRecordSendRate(userId: number): {
  allowed: boolean
  retryAfterSeconds?: number
} {
  const now = Date.now()

  // LRU eviction softcap — pivot sur lastSeenAt (et non windowStart) pour
  // que les buckets inactifs depuis longtemps soient évincés en premier,
  // cohérent avec `audit.service.ts` burst map.
  if (rateLimitMap.size > MESSAGING_BOUNDS.RATE_LIMIT_MAP_HARD_CAP) {
    let oldestKey: number | null = null
    let oldestSeen = Infinity
    for (const [k, v] of rateLimitMap) {
      if (v.lastSeenAt < oldestSeen) {
        oldestSeen = v.lastSeenAt
        oldestKey = k
      }
    }
    if (oldestKey !== null) rateLimitMap.delete(oldestKey)
  }

  const bucket =
    rateLimitMap.get(userId) ?? { count: 0, windowStart: now, lastSeenAt: now }

  // Clock skew guard (LOW review round 3) — si NTP slew fait reculer
  // l'horloge système, `now - windowStart` deviendrait négatif et
  // bloquerait le user pendant 2× la fenêtre. Reset le bucket.
  if (now < bucket.windowStart) {
    bucket.windowStart = now
    bucket.count = 0
  }

  if (now - bucket.windowStart >= MESSAGING_BOUNDS.RATE_LIMIT_WINDOW_MS) {
    bucket.count = 1
    bucket.windowStart = now
    bucket.lastSeenAt = now
    rateLimitMap.set(userId, bucket)
    return { allowed: true }
  }
  if (bucket.count >= MESSAGING_BOUNDS.RATE_LIMIT_PER_MIN) {
    bucket.lastSeenAt = now
    rateLimitMap.set(userId, bucket)
    const retryAfterSeconds = Math.ceil(
      (MESSAGING_BOUNDS.RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart)) / 1000,
    )
    return { allowed: false, retryAfterSeconds }
  }
  bucket.count++
  bucket.lastSeenAt = now
  rateLimitMap.set(userId, bucket)
  return { allowed: true }
}

// ─────────────────────────────────────────────────────────────
// Decrypt-fail logger throttle (M3 review round 3)
// ─────────────────────────────────────────────────────────────

let lastDecryptFailLogMs = 0

/** Log throttled — évite spam si plusieurs rows corrompus dans la même
 *  query. SOC reçoit 1 alerte / seconde max au lieu d'1 par row. */
function logDecryptFailThrottled(
  scope: string,
  userId: number,
  err: unknown,
): void {
  const now = Date.now()
  if (now - lastDecryptFailLogMs < MESSAGING_BOUNDS.DECRYPT_FAIL_LOG_THROTTLE_MS) {
    return
  }
  lastDecryptFailLogMs = now
  logger.error(
    "messaging",
    `decrypt-failed in ${scope}`,
    { userId, resource: "MESSAGE" },
    err,
  )
}

/** Test-only — reset rate limit state between tests. */
export function __resetMessagingRateLimit(): void {
  rateLimitMap.clear()
}

// ─────────────────────────────────────────────────────────────
// canMessage : autorisation patient↔PS / staff↔staff
// ─────────────────────────────────────────────────────────────

interface CanMessageResult {
  allowed: boolean
  /** Patient.id à utiliser comme pivot US-2268 (null si staff↔staff sans patient). */
  patientId: number | null
  /** Raison du refus si `allowed=false`. */
  reason?: string
}

/**
 * Vérifie qu'un utilisateur peut envoyer un message à un autre.
 *
 * Règles :
 *   - selfMessage interdit (from === to).
 *   - patient (User avec Patient associé via 1:1) ↔ PS : autorisé si le PS
 *     encadre le patient via PatientReferent (proId = HealthcareMember.id du PS)
 *     OU PatientService (le PS est membre d'un service où le patient est inscrit).
 *   - PS ↔ PS : autorisé si même `HealthcareMember.serviceId` (ADMIN passe partout).
 *   - patient ↔ patient : interdit.
 *
 * @param fromUserId User.id émetteur
 * @param toUserId User.id destinataire
 */
export async function canMessage(
  fromUserId: number,
  toUserId: number,
): Promise<CanMessageResult> {
  if (fromUserId === toUserId) {
    return { allowed: false, patientId: null, reason: "selfMessage" }
  }

  const [fromUser, toUser] = await Promise.all([
    prisma.user.findUnique({
      where: { id: fromUserId },
      select: {
        id: true,
        role: true,
        patient: { select: { id: true, deletedAt: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: toUserId },
      select: {
        id: true,
        role: true,
        patient: { select: { id: true, deletedAt: true } },
      },
    }),
  ])

  if (!fromUser || !toUser) {
    return { allowed: false, patientId: null, reason: "userNotFound" }
  }

  // ADMIN passe partout (forensique + outillage).
  if (fromUser.role === "ADMIN" || toUser.role === "ADMIN") {
    // H7 (review) — Ne flag le pivot patient que si l'autre partie est
    // PUREMENT un patient (role VIEWER + Patient associé). Sinon (PS qui
    // serait aussi soigné sur la plateforme, ou ADMIN↔ADMIN), le message
    // n'a pas pour contexte clinique ce patient → pivot null pour ne pas
    // polluer la forensique CNIL "getByPatient(X)".
    const other = fromUser.role === "ADMIN" ? toUser : fromUser
    const isPurelyPatient =
      other.role === "VIEWER" &&
      other.patient !== null &&
      other.patient.deletedAt === null
    return {
      allowed: true,
      patientId: isPurelyPatient ? other.patient!.id : null,
    }
  }

  const fromIsPatient =
    fromUser.patient !== null && fromUser.patient.deletedAt === null
  const toIsPatient =
    toUser.patient !== null && toUser.patient.deletedAt === null

  if (fromIsPatient && toIsPatient) {
    return { allowed: false, patientId: null, reason: "patientToPatient" }
  }

  // Cas 1 — Patient → PS
  if (fromIsPatient && !toIsPatient) {
    const patientId = fromUser.patient!.id
    const ok = await isPsManagingPatient(toUser.id, patientId)
    return {
      allowed: ok,
      patientId: ok ? patientId : null,
      reason: ok ? undefined : "psNotManaging",
    }
  }

  // Cas 2 — PS → Patient
  if (!fromIsPatient && toIsPatient) {
    const patientId = toUser.patient!.id
    const ok = await isPsManagingPatient(fromUser.id, patientId)
    return {
      allowed: ok,
      patientId: ok ? patientId : null,
      reason: ok ? undefined : "psNotManaging",
    }
  }

  // Cas 3 — Staff ↔ Staff (même cabinet)
  const ok = await haveSharedCabinet(fromUser.id, toUser.id)
  return {
    allowed: ok,
    patientId: null,
    reason: ok ? undefined : "notInSameCabinet",
  }
}

async function isPsManagingPatient(
  psUserId: number,
  patientId: number,
): Promise<boolean> {
  // Le PS doit être un HealthcareMember.
  const member = await prisma.healthcareMember.findUnique({
    where: { userId: psUserId },
    select: { id: true, serviceId: true },
  })
  if (!member) return false

  // H6 (review) — Construction conditionnelle de l'OR pour éviter le sentinel
  // `{id: -1}` (code smell + masque potentiel de futurs bugs).
  const orClauses: Prisma.PatientWhereInput[] = [
    { referent: { proId: member.id } },
  ]
  if (member.serviceId !== null) {
    orClauses.push({
      patientServices: { some: { serviceId: member.serviceId } },
    })
  }

  // Soft-deleted patient ne peut plus recevoir/envoyer.
  const patient = await prisma.patient.findFirst({
    where: {
      id: patientId,
      deletedAt: null,
      OR: orClauses,
    },
    select: { id: true },
  })
  return patient !== null
}

async function haveSharedCabinet(
  userIdA: number,
  userIdB: number,
): Promise<boolean> {
  const [a, b] = await Promise.all([
    prisma.healthcareMember.findUnique({
      where: { userId: userIdA },
      select: { serviceId: true },
    }),
    prisma.healthcareMember.findUnique({
      where: { userId: userIdB },
      select: { serviceId: true },
    }),
  ])
  if (!a || !b) return false
  if (a.serviceId === null || b.serviceId === null) return false
  return a.serviceId === b.serviceId
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export interface SendMessageInput {
  toUserId: number
  body: string
}

export interface SendMessageResult {
  id: string
  conversationKey: string
  fromUserId: number
  toUserId: number
  patientId: number | null
  createdAt: Date
  /** FCM dispatch outcome (sent/failed counts). */
  fcm: { sent: number; failed: number }
}

export interface ThreadSummary {
  conversationKey: string
  otherUserId: number
  patientId: number | null
  lastMessage: {
    id: string
    fromUserId: number
    bodyPreview: string
    createdAt: Date
    isRead: boolean
  }
  unreadCount: number
}

export interface ThreadMessage {
  id: string
  fromUserId: number
  toUserId: number
  body: string
  createdAt: Date
  readAt: Date | null
}

export const messagingService = {
  /**
   * Envoie un message. Encrypt + persist + FCM data-only.
   * Audit : `MESSAGE/CREATE`, `metadata.patientId` pivot, `metadata.conversationKey`.
   *
   * Garde-fous (review round 3) :
   *   - BLOCKER #1 fix : validation `body` en **octets UTF-8** (pas codepoints
   *     ni code-units) pour aligner sur le CHECK SQL `OCTET_LENGTH ≤ 8192`.
   *     Sans ça, 4000 emoji = 16028 octets ciphertext → check_violation 500.
   *   - HIGH-3 fix : consent destinataire vérifié (`requireGdprConsent(toUserId)`).
   *     Si le destinataire a révoqué son consent RGPD Art. 9, l'envoi est
   *     refusé (anti-énumération : reason `recipientConsentRevoked`).
   *   - C5 : rate-limit avant validation+canMessage (anti DoS amplification).
   */
  async send(
    fromUserId: number,
    input: SendMessageInput,
    ctx: AuditContext,
  ): Promise<SendMessageResult> {
    // 1. Rate limit FIRST (C5 review) — avant tout work coûteux (encrypt,
    //    canMessage 4 queries). Empêche DoS amplification via probes parallel
    //    sur `canMessage` qui consomme ~4 DB queries par appel.
    const rate = checkAndRecordSendRate(fromUserId)
    if (!rate.allowed) {
      throw new MessagingRateLimitError(rate.retryAfterSeconds ?? 60)
    }

    // 2. Validation longueur en OCTETS UTF-8 (BLOCKER #1 review round 3).
    if (typeof input.body !== "string" || input.body.length === 0) {
      throw new MessagingValidationError("body", "bodyEmpty")
    }
    const utf8ByteLen = Buffer.byteLength(input.body, "utf8")
    if (utf8ByteLen > MESSAGING_BOUNDS.MAX_BODY_BYTES_UTF8) {
      throw new MessagingValidationError("body", "bodyTooLong")
    }

    // 3. RBAC métier (canMessage = 4 queries — protégé par rate-limit ci-dessus).
    const access = await canMessage(fromUserId, input.toUserId)
    if (!access.allowed) {
      throw new MessagingAccessError(access.reason ?? "forbidden")
    }

    // 3b. HIGH-3 review round 3 — Consent RGPD Art. 9 destinataire.
    //     Si Bob a révoqué son consent, Alice ne peut pas lui envoyer
    //     (refus côté serveur + jamais de FCM push à Bob).
    //     Import dynamique pour casser un cycle potentiel gdpr ↔ messaging.
    const { requireGdprConsent } = await import("@/lib/gdpr")
    const recipientHasConsent = await requireGdprConsent(input.toUserId)
    if (!recipientHasConsent) {
      throw new MessagingAccessError("recipientConsentRevoked")
    }

    // 4. Encrypt + persist (transaction : message + audit).
    const conversationKey = computeConversationKey(fromUserId, input.toUserId)
    const bodyEncrypted = Buffer.from(encrypt(input.body))

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationKey,
          fromUserId,
          toUserId: input.toUserId,
          bodyEncrypted,
          patientId: access.patientId,
        },
        select: {
          id: true,
          conversationKey: true,
          fromUserId: true,
          toUserId: true,
          patientId: true,
          createdAt: true,
        },
      })
      await auditService.logWithTx(tx, {
        userId: fromUserId,
        action: "CREATE",
        resource: "MESSAGE",
        resourceId: created.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: {
          kind: "message.send",
          conversationKey,
          toUserId: input.toUserId,
          patientId: access.patientId ?? undefined,
        },
      })
      return created
    })

    // 5. FCM data-only — body = "[message chiffré]" placeholder (jamais PHI lockscreen).
    //    Payload data minimal (HSA MED-4 review round 3) :
    //    `conversationKey` RETIRÉ — SHA-256 sans sel = corrélateur graphe-social
    //    si Google FCM compromis (uid + 100M hashes brute-force ≈ 1 min GPU).
    //    Le client peut recalculer `conversationKey` après auth via API.
    let fcmOutcome = { sent: 0, failed: 0 }
    try {
      const result = await fcmService.sendToUser(
        {
          userId: input.toUserId,
          senderId: fromUserId,
          title: "Nouveau message",
          body: "[message chiffré]",
          data: {
            type: "message",
            messageId: message.id,
          },
        },
        ctx,
      )
      fcmOutcome = { sent: result.sent, failed: result.failed }
    } catch (err) {
      // Échec FCM ne doit jamais bloquer l'envoi : le message est persisté,
      // le destinataire le verra via polling 60s ou prochain GET inbox.
      logger.error(
        "messaging",
        `FCM dispatch failed for message ${message.id}`,
        { userId: fromUserId, resource: "MESSAGE" },
        err,
      )
    }

    return { ...message, fcm: fcmOutcome }
  },

  /**
   * Compte les messages non lus pour un user (badge polling 60s).
   * Endpoint optimisé : COUNT direct sur index `(to_user_id, read_at, created_at)`.
   */
  async unreadCount(userId: number): Promise<{ count: number }> {
    const count = await prisma.message.count({
      where: {
        toUserId: userId,
        readAt: null,
        deletedAt: null,
      },
    })
    return { count }
  },

  /**
   * Liste les threads (conversations) d'un user. Aggregate via dernier
   * message + unread count par `conversationKey`.
   *
   * Refactor C4+H4 (review) : remplace l'ancien pattern `take * 20` + dédup
   * JS (qui pouvait masquer des threads + DoS 2000 décryptions/appel) par
   * une query SQL native `DISTINCT ON (conversation_key)` PostgreSQL :
   *   - 1 query pour les threads (≤ cappedLimit lignes, pas × 20)
   *   - 1 query pour unread aggregate
   *   - 1 query pour patients soft-delete filter (H3)
   * Total : 3 queries au lieu d'over-fetch + dédup quadratique.
   */
  async listThreads(
    userId: number,
    ctx: AuditContext,
    limit: number = MESSAGING_BOUNDS.MAX_THREADS_PER_QUERY,
  ): Promise<ThreadSummary[]> {
    const cappedLimit = Math.min(limit, MESSAGING_BOUNDS.MAX_THREADS_PER_QUERY)

    // 1. UNION ALL des deux perspectives (from_user_id OR to_user_id)
    //    puis DISTINCT ON (Prisma H2 review round 3).
    //    Chaque branche utilise son index respectif (`from_user_id` +
    //    `(to_user_id, read_at, created_at)`), évite le BitmapOr + sort
    //    mémoire à scale. Plan attendu :
    //    Append → Index Scan ×2 → Sort (conv_key, created_at DESC) →
    //    DISTINCT ON → outer Sort created_at DESC → Limit.
    interface RawRow {
      id: string
      conversation_key: string
      from_user_id: number
      to_user_id: number
      // Buffer (pg driver) ou Uint8Array (Prisma engine) — les deux
      // sont compatibles avec `new Uint8Array(...)` pour decrypt.
      body_encrypted: Buffer | Uint8Array
      patient_id: number | null
      created_at: Date
      read_at: Date | null
    }
    const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT * FROM (
        SELECT DISTINCT ON (conversation_key)
          id, conversation_key, from_user_id, to_user_id,
          body_encrypted, patient_id, created_at, read_at
        FROM (
          SELECT id, conversation_key, from_user_id, to_user_id,
                 body_encrypted, patient_id, created_at, read_at
          FROM messages
          WHERE from_user_id = ${userId} AND deleted_at IS NULL
          UNION ALL
          SELECT id, conversation_key, from_user_id, to_user_id,
                 body_encrypted, patient_id, created_at, read_at
          FROM messages
          WHERE to_user_id = ${userId} AND deleted_at IS NULL
        ) combined
        ORDER BY conversation_key, created_at DESC
      ) sub
      ORDER BY created_at DESC
      LIMIT ${cappedLimit}
    `)

    if (rows.length === 0) {
      // Inbox vide — audit quand même (HDS : "qui a consulté l'inbox").
      await auditService.log({
        userId,
        action: "READ",
        resource: "MESSAGE",
        resourceId: "inbox",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { kind: "message.inbox", threadCount: 0, empty: true },
      })
      return []
    }

    const conversationKeys = rows.map((r) => r.conversation_key)
    const candidatePatientIds = [
      ...new Set(rows.map((r) => r.patient_id).filter((p): p is number => p !== null)),
    ]

    // 2. Unread aggregate par conversationKey (user = receiver).
    // 3. Filtre H3 — patients soft-deleted exclus du pivot affiché.
    const [unreadGroups, livePatients] = await Promise.all([
      prisma.message.groupBy({
        by: ["conversationKey"],
        where: {
          conversationKey: { in: conversationKeys },
          toUserId: userId,
          readAt: null,
          deletedAt: null,
        },
        _count: { _all: true },
      }),
      candidatePatientIds.length > 0
        ? prisma.patient.findMany({
            where: { id: { in: candidatePatientIds }, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve([] as { id: number }[]),
    ])

    const unreadMap = new Map(
      unreadGroups.map((g) => [g.conversationKey, g._count._all]),
    )
    const livePatientSet = new Set(livePatients.map((p) => p.id))

    // 4. Build summaries — décryption preview limitée aux ≤ cappedLimit rows.
    const summaries: ThreadSummary[] = rows.map((m) => {
      const otherUserId =
        m.from_user_id === userId ? m.to_user_id : m.from_user_id
      let preview = ""
      try {
        const plaintext = decrypt(new Uint8Array(m.body_encrypted))
        preview = [...plaintext].slice(0, 80).join("")
      } catch (err) {
        if (err instanceof HealthDataDecryptionError) {
          // M3 review — alerte SOC throttled (anti log spam si DB corruption).
          logDecryptFailThrottled("listThreads preview", userId, err)
          preview = "[message corrompu]"
        } else {
          throw err
        }
      }
      // H3 — pivot patientId nullifié si patient soft-deleted (l'historique
      // n'est plus rattaché à un patient actif pour la forensique vivante).
      const exposedPatientId =
        m.patient_id !== null && livePatientSet.has(m.patient_id)
          ? m.patient_id
          : null
      return {
        conversationKey: m.conversation_key,
        otherUserId,
        patientId: exposedPatientId,
        lastMessage: {
          id: m.id,
          fromUserId: m.from_user_id,
          bodyPreview: preview,
          createdAt: m.created_at,
          isRead: m.read_at !== null,
        },
        unreadCount: unreadMap.get(m.conversation_key) ?? 0,
      }
    })

    // 5. Audit inbox — BLOCKER #2 fix (review round 3 — CR L8 / HSA HIGH-1 /
    //    Prisma C2 convergence).
    //
    //    Le GIN partial index US-2268 est défini WHERE `metadata ? 'patientId'`
    //    (clé SINGULIER). Émettre `metadata.patientIds: [...]` (pluriel array)
    //    ne match PAS le predicate → forensique CNIL `getByPatient(X)` muette
    //    sur les events inbox.
    //
    //    Fix : 1 audit row PAR patientId vu dans l'inbox (pivot singulier),
    //    + 1 row "inbox vide ou staff-only" sans pivot. Aligné convention
    //    ADR #18 CLAUDE.md.
    //
    //    Coût : ≤ MAX_THREADS_PER_QUERY (100) rows par consultation inbox,
    //    acceptable car `listThreads` n'est pas sur le hot path.
    const exposedPatientIds = [
      ...new Set(summaries.map((s) => s.patientId).filter((p): p is number => p !== null)),
    ]

    if (exposedPatientIds.length === 0) {
      // Inbox vue sans aucun patient pivot (staff-only) — 1 row global.
      await auditService.log({
        userId,
        action: "READ",
        resource: "MESSAGE",
        resourceId: "inbox",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: {
          kind: "message.inbox",
          threadCount: summaries.length,
        },
      })
    } else {
      // 1 row par patient vu — `metadata.patientId` singulier matche
      // le GIN index US-2268. `getByPatient(X)` retrouvera ces events.
      await Promise.all(
        exposedPatientIds.map((pid) =>
          auditService.log({
            userId,
            action: "READ",
            resource: "MESSAGE",
            resourceId: "inbox",
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: {
              kind: "message.inbox",
              threadCount: summaries.length,
              patientId: pid,
            },
          }),
        ),
      )
    }

    return summaries
  },

  /**
   * Récupère un thread (messages déchiffrés) — paginé par cursor `createdAt`.
   * Vérifie que l'appelant est l'un des deux participants.
   */
  async getThread(
    userId: number,
    conversationKey: string,
    opts: { cursor?: string; limit?: number },
    ctx: AuditContext,
  ): Promise<{ items: ThreadMessage[]; nextCursor: string | null }> {
    // 1. Validation conversation key shape.
    if (
      typeof conversationKey !== "string" ||
      conversationKey.length !== MESSAGING_BOUNDS.CONVERSATION_KEY_LEN ||
      !/^[a-f0-9]{64}$/.test(conversationKey)
    ) {
      throw new MessagingValidationError("conversationKey", "invalidShape")
    }

    // 2. RBAC — l'appelant doit être participant. On charge en plus le
    //    `patientId` pour les checks H1 (pivot audit) + H9 (re-verify).
    const probe = await prisma.message.findFirst({
      where: {
        conversationKey,
        deletedAt: null,
        OR: [{ fromUserId: userId }, { toUserId: userId }],
      },
      select: {
        id: true,
        fromUserId: true,
        toUserId: true,
        patientId: true,
      },
    })
    if (!probe) {
      // Pas de message dans ce thread accessible à l'utilisateur → 404 pour
      // ne pas leaker l'existence d'autres threads.
      throw new MessagingNotFoundError("threadNotFound")
    }

    // H9 (review) — Re-vérifie le lien soignant↔patient à la lecture si le
    //   thread est patient-scoped. Évite qu'un ex-référent garde accès à
    //   l'historique après rupture du lien (RGPD Art. 5(1)(b) finalité).
    //   H3 (review) — filtre aussi les patients soft-deleted.
    //   Utilise `!= null` pour matcher null ET undefined (defensive si le
    //   select ne remonte pas patient_id).
    if (probe.patientId != null) {
      const livePatient = await prisma.patient.findFirst({
        where: { id: probe.patientId, deletedAt: null },
        select: { id: true },
      })
      if (!livePatient) {
        // Patient soft-deleted ou inexistant → thread orphelin, 404.
        throw new MessagingNotFoundError("threadNotFound")
      }
      // Si l'appelant n'est PAS le patient lui-même (sender/recipient =
      // patient.userId), re-check qu'il a toujours le droit clinique.
      const caller = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, patient: { select: { id: true } } },
      })
      const callerIsThisPatient = caller?.patient?.id === probe.patientId
      const callerIsAdmin = caller?.role === "ADMIN"
      if (!callerIsThisPatient && !callerIsAdmin) {
        const stillManages = await isPsManagingPatient(userId, probe.patientId)
        if (!stillManages) {
          // Lien rompu après le thread — refuse la lecture.
          throw new MessagingNotFoundError("threadNotFound")
        }
      }
    }

    const limit = Math.min(
      opts.limit ?? MESSAGING_BOUNDS.MAX_MESSAGES_PER_PAGE,
      MESSAGING_BOUNDS.MAX_MESSAGES_PER_PAGE,
    )

    const cursorMessage = opts.cursor
      ? await prisma.message.findFirst({
          where: { id: opts.cursor, conversationKey },
          select: { createdAt: true, id: true },
        })
      : null

    const messages = await prisma.message.findMany({
      where: {
        conversationKey,
        deletedAt: null,
        ...(cursorMessage
          ? {
              OR: [
                { createdAt: { lt: cursorMessage.createdAt } },
                {
                  AND: [
                    { createdAt: cursorMessage.createdAt },
                    { id: { lt: cursorMessage.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1, // +1 pour détecter `hasMore` sans count séparé.
      select: {
        id: true,
        fromUserId: true,
        toUserId: true,
        bodyEncrypted: true,
        createdAt: true,
        readAt: true,
      },
    })

    const hasMore = messages.length > limit
    const sliced = hasMore ? messages.slice(0, limit) : messages

    const items: ThreadMessage[] = sliced.map((m) => {
      let body: string
      try {
        body = decrypt(new Uint8Array(m.bodyEncrypted))
      } catch (err) {
        if (err instanceof HealthDataDecryptionError) {
          // M3 review — alerte SOC throttled (anti log spam).
          logDecryptFailThrottled("getThread", userId, err)
          body = "[message corrompu]"
        } else {
          throw err
        }
      }
      return {
        id: m.id,
        fromUserId: m.fromUserId,
        toUserId: m.toUserId,
        body,
        createdAt: m.createdAt,
        readAt: m.readAt,
      }
    })

    // Audit (lecture thread) — H1 review : `metadata.patientId` pivot
    //   US-2268 obligatoire pour forensique CNIL `getByPatient(X)`.
    await auditService.log({
      userId,
      action: "READ",
      resource: "MESSAGE",
      resourceId: conversationKey,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        kind: "message.thread",
        messageCount: items.length,
        ...(probe.patientId != null && { patientId: probe.patientId }),
      },
    })

    return {
      items,
      nextCursor: hasMore ? (sliced[sliced.length - 1]?.id ?? null) : null,
    }
  },

  /**
   * Marque un message reçu comme lu. Idempotent (no-op si déjà lu).
   * Refuse si l'appelant n'est pas le destinataire.
   */
  async markRead(
    userId: number,
    messageId: string,
    ctx: AuditContext,
  ): Promise<{ id: string; readAt: Date; alreadyRead: boolean }> {
    // updateMany scoped `WHERE toUserId = me AND readAt IS NULL` — atomique,
    // pas de race condition entre read/check/write.
    const now = new Date()
    const result = await prisma.message.updateMany({
      where: {
        id: messageId,
        toUserId: userId,
        readAt: null,
        deletedAt: null,
      },
      data: { readAt: now },
    })

    if (result.count === 0) {
      // Soit le message n'existe pas, soit l'appelant n'est pas le destinataire,
      // soit déjà lu. On désambigue pour le bon retour client + audit.
      const existing = await prisma.message.findFirst({
        where: { id: messageId, deletedAt: null },
        select: { id: true, toUserId: true, readAt: true },
      })
      if (!existing) {
        throw new MessagingNotFoundError("messageNotFound")
      }
      if (existing.toUserId !== userId) {
        // Audit accessDenied + 404 (anti-énumération).
        //
        // Note HDS (CR L6 review round 3) : `actualRecipientId` est
        // exposé uniquement dans l'audit log (table admin-only, immuable
        // par trigger PG). Champ requis pour forensique CNIL
        // "qui a tenté d'impersonner ?". Pas leak côté client (404 seul).
        try {
          await auditService.accessDenied({
            userId,
            resource: "MESSAGE",
            resourceId: messageId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: {
              kind: "message.markRead.notRecipient",
              actualRecipientId: existing.toUserId,
            },
          })
        } catch (auditErr) {
          // Burst detector US-2265 perdrait visibilité silencieuse.
          // Log local pour SOC (LOW review round 3).
          logger.error(
            "messaging",
            "accessDenied audit emit failed",
            { userId, resource: "MESSAGE" },
            auditErr,
          )
        }
        throw new MessagingNotFoundError("messageNotFound")
      }
      // Déjà lu — idempotent. Fallback `now` si race exotique
      // (concurrent thread set readAt entre updateMany et findFirst —
      // LOW review round 3 : éviter `!` non-null assertion).
      return {
        id: messageId,
        readAt: existing.readAt ?? now,
        alreadyRead: true,
      }
    }

    await auditService.log({
      userId,
      action: "UPDATE",
      resource: "MESSAGE",
      resourceId: messageId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: { kind: "message.markRead" },
    })

    return { id: messageId, readAt: now, alreadyRead: false }
  },
}
