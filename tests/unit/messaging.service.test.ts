/**
 * @description US-2076 scope A — Messaging service unit tests.
 *
 * Couvre :
 *   - computeConversationKey : symétrie, format hex 64, reject self
 *   - canMessage : patient↔PS, staff↔staff, refus patient↔patient, ADMIN bypass
 *   - send : encrypt + persist + audit + FCM dispatch (fail FCM ne bloque pas)
 *   - send : rate limit 100/min déclenche 429
 *   - unreadCount : COUNT WHERE toUserId, readAt NULL, deletedAt NULL
 *   - listThreads : dedup conversationKey, unread aggregate, preview 80c
 *   - getThread : RBAC participant check (404 sinon), cursor pagination
 *   - markRead : idempotent, accessDenied audit pour non-recipient
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/services/fcm.service", () => ({
  fcmService: {
    sendToUser: vi.fn().mockResolvedValue({ sent: 1, failed: 0, results: [] }),
  },
}))

// HEALTH_DATA_ENCRYPTION_KEY est setté par tests/setup.ts en mode test.
import {
  messagingService,
  computeConversationKey,
  canMessage,
  MESSAGING_BOUNDS,
  MessagingValidationError,
  MessagingAccessError,
  MessagingRateLimitError,
  MessagingNotFoundError,
  __resetMessagingRateLimit,
} from "@/lib/services/messaging.service"
import { fcmService } from "@/lib/services/fcm.service"
import { encrypt } from "@/lib/crypto/health-data"

const ctx = {
  ipAddress: "1.2.3.4",
  userAgent: "Chrome",
  requestId: "req-1",
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
  __resetMessagingRateLimit()
  vi.mocked(fcmService.sendToUser).mockResolvedValue({
    sent: 1, failed: 0, results: [],
  })
})

// ────────────────────────────────────────────────────────────────
// computeConversationKey
// ────────────────────────────────────────────────────────────────

describe("computeConversationKey", () => {
  it("returns symmetric SHA-256 hex 64", () => {
    const a = computeConversationKey(1, 2)
    const b = computeConversationKey(2, 1)
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it("different pairs produce different keys", () => {
    expect(computeConversationKey(1, 2)).not.toBe(computeConversationKey(1, 3))
  })

  it("throws on self (from === to)", () => {
    expect(() => computeConversationKey(5, 5)).toThrow(MessagingValidationError)
  })

  it("throws on invalid userId (0, negative, non-integer)", () => {
    expect(() => computeConversationKey(0, 1)).toThrow()
    expect(() => computeConversationKey(-1, 1)).toThrow()
    expect(() => computeConversationKey(1.5, 2)).toThrow()
  })
})

// ────────────────────────────────────────────────────────────────
// canMessage
// ────────────────────────────────────────────────────────────────

describe("canMessage", () => {
  it("self message rejected", async () => {
    const r = await canMessage(5, 5)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("selfMessage")
  })

  it("ADMIN can message anyone (no patient pivot)", async () => {
    prismaMock.user.findUnique.mockImplementation(((args: any) => {
      if (args.where.id === 1) {
        return Promise.resolve({ id: 1, role: "ADMIN", patient: null })
      }
      return Promise.resolve({ id: 2, role: "DOCTOR", patient: null })
    }) as any)
    const r = await canMessage(1, 2)
    expect(r.allowed).toBe(true)
    expect(r.patientId).toBe(null)
  })

  it("patient → PS allowed when PS manages patient via referent", async () => {
    prismaMock.user.findUnique.mockImplementation(((args: any) => {
      if (args.where.id === 9) {
        return Promise.resolve({
          id: 9, role: "VIEWER",
          patient: { id: 42, deletedAt: null },
        })
      }
      return Promise.resolve({ id: 5, role: "DOCTOR", patient: null })
    }) as any)
    prismaMock.healthcareMember.findUnique.mockResolvedValue({
      id: 100, serviceId: 7,
    } as any)
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    const r = await canMessage(9, 5)
    expect(r.allowed).toBe(true)
    expect(r.patientId).toBe(42)
  })

  it("patient → PS rejected when PS not managing", async () => {
    prismaMock.user.findUnique.mockImplementation(((args: any) => {
      if (args.where.id === 9) {
        return Promise.resolve({
          id: 9, role: "VIEWER",
          patient: { id: 42, deletedAt: null },
        })
      }
      return Promise.resolve({ id: 5, role: "DOCTOR", patient: null })
    }) as any)
    prismaMock.healthcareMember.findUnique.mockResolvedValue({
      id: 100, serviceId: 7,
    } as any)
    prismaMock.patient.findFirst.mockResolvedValue(null) // pas de lien
    const r = await canMessage(9, 5)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("psNotManaging")
  })

  it("staff ↔ staff allowed when same cabinet (serviceId)", async () => {
    prismaMock.user.findUnique.mockImplementation(((args: any) => {
      if (args.where.id === 1) {
        return Promise.resolve({ id: 1, role: "DOCTOR", patient: null })
      }
      return Promise.resolve({ id: 2, role: "NURSE", patient: null })
    }) as any)
    prismaMock.healthcareMember.findUnique.mockResolvedValue({
      serviceId: 7,
    } as any)
    const r = await canMessage(1, 2)
    expect(r.allowed).toBe(true)
    expect(r.patientId).toBe(null)
  })

  it("staff ↔ staff rejected when different cabinets", async () => {
    prismaMock.user.findUnique.mockImplementation(((args: any) => {
      if (args.where.id === 1) {
        return Promise.resolve({ id: 1, role: "DOCTOR", patient: null })
      }
      return Promise.resolve({ id: 2, role: "NURSE", patient: null })
    }) as any)
    let call = 0
    prismaMock.healthcareMember.findUnique.mockImplementation((() => {
      call++
      return Promise.resolve({ serviceId: call === 1 ? 7 : 8 } as any)
    }) as any)
    const r = await canMessage(1, 2)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("notInSameCabinet")
  })

  it("patient → patient rejected", async () => {
    prismaMock.user.findUnique.mockImplementation(((args: any) => {
      if (args.where.id === 9) {
        return Promise.resolve({
          id: 9, role: "VIEWER",
          patient: { id: 42, deletedAt: null },
        })
      }
      return Promise.resolve({
        id: 11, role: "VIEWER",
        patient: { id: 43, deletedAt: null },
      })
    }) as any)
    const r = await canMessage(9, 11)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("patientToPatient")
  })
})

// ────────────────────────────────────────────────────────────────
// send
// ────────────────────────────────────────────────────────────────

describe("send", () => {
  beforeEach(() => {
    // Stub canMessage path : ADMIN → any.
    prismaMock.user.findUnique.mockImplementation(((args: any) => {
      if (args.where.id === 1) {
        return Promise.resolve({ id: 1, role: "ADMIN", patient: null })
      }
      return Promise.resolve({ id: 2, role: "DOCTOR", patient: null })
    }) as any)
  })

  it("encrypts body, persists, audits, dispatches FCM", async () => {
    const created = {
      id: "msg-1",
      conversationKey: "a".repeat(64),
      fromUserId: 1, toUserId: 2,
      patientId: null, createdAt: new Date(),
    }
    prismaMock.message.create.mockResolvedValue(created as any)

    const out = await messagingService.send(1, {
      toUserId: 2, body: "Hello",
    }, ctx)

    expect(out.id).toBe("msg-1")
    expect(out.fcm.sent).toBe(1)

    // Audit
    const auditCalls = prismaMock.auditLog.create.mock.calls
    expect(auditCalls.length).toBeGreaterThanOrEqual(1)
    const lastAudit = auditCalls.at(-1)![0].data as any
    expect(lastAudit.resource).toBe("MESSAGE")
    expect(lastAudit.action).toBe("CREATE")
    expect(lastAudit.metadata.kind).toBe("message.send")

    // FCM body sanitized (no PHI).
    expect(vi.mocked(fcmService.sendToUser)).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "[message chiffré]",
        title: "Nouveau message",
        data: expect.objectContaining({ type: "message", messageId: "msg-1" }),
      }),
      ctx,
    )

    // Verify body in DB call is encrypted (Buffer)
    const createArgs = prismaMock.message.create.mock.calls[0]![0]!
    expect(createArgs.data.bodyEncrypted).toBeInstanceOf(Buffer)
  })

  it("rejects empty body (422 validation)", async () => {
    await expect(messagingService.send(1, { toUserId: 2, body: "" }, ctx))
      .rejects.toBeInstanceOf(MessagingValidationError)
  })

  it("rejects body > MAX_BODY_CHARS", async () => {
    const tooLong = "a".repeat(MESSAGING_BOUNDS.MAX_BODY_CHARS + 1)
    await expect(messagingService.send(1, { toUserId: 2, body: tooLong }, ctx))
      .rejects.toBeInstanceOf(MessagingValidationError)
  })

  it("rejects when canMessage denies", async () => {
    prismaMock.user.findUnique.mockImplementation(((args: any) => {
      if (args.where.id === 9) {
        return Promise.resolve({
          id: 9, role: "VIEWER",
          patient: { id: 42, deletedAt: null },
        })
      }
      return Promise.resolve({
        id: 11, role: "VIEWER",
        patient: { id: 43, deletedAt: null },
      })
    }) as any)
    await expect(messagingService.send(9, { toUserId: 11, body: "x" }, ctx))
      .rejects.toBeInstanceOf(MessagingAccessError)
  })

  it("rate limit triggers MessagingRateLimitError after RATE_LIMIT_PER_MIN", async () => {
    const created = {
      id: "msg-x", conversationKey: "a".repeat(64),
      fromUserId: 1, toUserId: 2, patientId: null, createdAt: new Date(),
    }
    prismaMock.message.create.mockResolvedValue(created as any)
    // Premier batch dans la limite — OK.
    for (let i = 0; i < MESSAGING_BOUNDS.RATE_LIMIT_PER_MIN; i++) {
      await messagingService.send(1, { toUserId: 2, body: "x" }, ctx)
    }
    // Suivant déclenche 429.
    await expect(messagingService.send(1, { toUserId: 2, body: "x" }, ctx))
      .rejects.toBeInstanceOf(MessagingRateLimitError)
  })

  it("FCM failure does NOT block message persist", async () => {
    vi.mocked(fcmService.sendToUser).mockRejectedValue(new Error("fcm down"))
    const created = {
      id: "msg-1", conversationKey: "a".repeat(64),
      fromUserId: 1, toUserId: 2, patientId: null, createdAt: new Date(),
    }
    prismaMock.message.create.mockResolvedValue(created as any)
    const out = await messagingService.send(1, { toUserId: 2, body: "x" }, ctx)
    expect(out.id).toBe("msg-1") // persisté quand même
    expect(out.fcm).toEqual({ sent: 0, failed: 0 })
  })
})

// ────────────────────────────────────────────────────────────────
// unreadCount
// ────────────────────────────────────────────────────────────────

describe("unreadCount", () => {
  it("counts toUserId=me AND readAt NULL AND deletedAt NULL", async () => {
    prismaMock.message.count.mockResolvedValue(7 as any)
    const r = await messagingService.unreadCount(42)
    expect(r.count).toBe(7)
    const where = prismaMock.message.count.mock.calls[0]![0]!.where as any
    expect(where.toUserId).toBe(42)
    expect(where.readAt).toBe(null)
    expect(where.deletedAt).toBe(null)
  })
})

// ────────────────────────────────────────────────────────────────
// listThreads
// ────────────────────────────────────────────────────────────────

describe("listThreads", () => {
  it("dedup by conversationKey via DISTINCT ON, returns latest per thread", async () => {
    const encryptedBody = Buffer.from(encrypt("Hello world"))
    const k1 = "a".repeat(64)
    const k2 = "b".repeat(64)
    // C4 review : le service utilise maintenant $queryRaw avec DISTINCT ON,
    // pas findMany + dédup JS. Le mock retourne déjà les rows dédupliquées.
    ;(prismaMock.$queryRaw as any).mockResolvedValue([
      { id: "m1", conversation_key: k1, from_user_id: 5, to_user_id: 1, body_encrypted: encryptedBody, patient_id: null, created_at: new Date(3000), read_at: null },
      { id: "m3", conversation_key: k2, from_user_id: 7, to_user_id: 1, body_encrypted: encryptedBody, patient_id: 42, created_at: new Date(1000), read_at: null },
    ])
    ;(prismaMock.message.groupBy as any).mockResolvedValue([
      { conversationKey: k1, _count: { _all: 1 } },
      { conversationKey: k2, _count: { _all: 1 } },
    ])
    // H3 review : patient_id=42 → check live patient ; mock comme "actif".
    prismaMock.patient.findMany.mockResolvedValue([{ id: 42 }] as any)
    const out = await messagingService.listThreads(1, ctx)
    expect(out).toHaveLength(2)
    expect(out[0]!.lastMessage.id).toBe("m1")
    expect(out[0]!.unreadCount).toBe(1)
    expect(out[0]!.lastMessage.bodyPreview).toContain("Hello")
    expect(out[1]!.patientId).toBe(42)
  })

  it("returns [] when no messages", async () => {
    ;(prismaMock.$queryRaw as any).mockResolvedValue([])
    const out = await messagingService.listThreads(1, ctx)
    expect(out).toEqual([])
  })

  it("preview truncates to 80 codepoints", async () => {
    const long = "x".repeat(200)
    const encryptedBody = Buffer.from(encrypt(long))
    const k = "c".repeat(64)
    ;(prismaMock.$queryRaw as any).mockResolvedValue([
      { id: "m1", conversation_key: k, from_user_id: 5, to_user_id: 1, body_encrypted: encryptedBody, patient_id: null, created_at: new Date(), read_at: null },
    ])
    ;(prismaMock.message.groupBy as any).mockResolvedValue([])
    const out = await messagingService.listThreads(1, ctx)
    expect(out[0]!.lastMessage.bodyPreview).toHaveLength(80)
  })

  it("audit kind=message.inbox + threadCount=0 + empty=true when no messages", async () => {
    ;(prismaMock.$queryRaw as any).mockResolvedValue([])
    await messagingService.listThreads(1, ctx)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("message.inbox")
    expect(meta.metadata.threadCount).toBe(0)
    expect(meta.metadata.empty).toBe(true)
  })

  // H2 review : audit doit lister les patientIds vus (forensique CNIL).
  it("audit metadata.patientIds inclut les patients soft-delete-filtrés", async () => {
    const encryptedBody = Buffer.from(encrypt("hi"))
    ;(prismaMock.$queryRaw as any).mockResolvedValue([
      { id: "m1", conversation_key: "a".repeat(64), from_user_id: 5, to_user_id: 1, body_encrypted: encryptedBody, patient_id: 42, created_at: new Date(), read_at: null },
      { id: "m2", conversation_key: "b".repeat(64), from_user_id: 7, to_user_id: 1, body_encrypted: encryptedBody, patient_id: 43, created_at: new Date(), read_at: null },
    ])
    ;(prismaMock.message.groupBy as any).mockResolvedValue([])
    // Patient 43 est soft-deleted → exclu du Set.
    prismaMock.patient.findMany.mockResolvedValue([{ id: 42 }] as any)
    await messagingService.listThreads(1, ctx)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.patientIds).toEqual([42]) // 43 filtered out
  })
})

// ────────────────────────────────────────────────────────────────
// getThread
// ────────────────────────────────────────────────────────────────

describe("getThread", () => {
  const VALID_KEY = "a".repeat(64)

  it("rejects invalid conversationKey shape", async () => {
    await expect(messagingService.getThread(1, "not-hex", {}, ctx))
      .rejects.toBeInstanceOf(MessagingValidationError)
  })

  it("404 if user not participant (anti-énumération)", async () => {
    prismaMock.message.findFirst.mockResolvedValue(null)
    await expect(messagingService.getThread(1, VALID_KEY, {}, ctx))
      .rejects.toBeInstanceOf(MessagingNotFoundError)
  })

  it("returns decrypted messages when user is participant (staff↔staff, patientId null)", async () => {
    const encryptedBody = Buffer.from(encrypt("Bonjour"))
    prismaMock.message.findFirst.mockResolvedValue({
      id: "m1", fromUserId: 1, toUserId: 2, patientId: null,
    } as any)
    prismaMock.message.findMany.mockResolvedValue([
      { id: "m1", fromUserId: 1, toUserId: 2, bodyEncrypted: encryptedBody, createdAt: new Date(), readAt: null },
    ] as any)
    const out = await messagingService.getThread(1, VALID_KEY, {}, ctx)
    expect(out.items[0]!.body).toBe("Bonjour")
    expect(out.nextCursor).toBe(null)
  })

  // H1 review : audit metadata.patientId pivot doit être posé si thread
  // patient-scoped + caller re-vérifié (H9).
  it("audit metadata.patientId pivot quand thread patient-scoped (ADMIN bypass)", async () => {
    const encryptedBody = Buffer.from(encrypt("hello"))
    prismaMock.message.findFirst.mockResolvedValue({
      id: "m1", fromUserId: 1, toUserId: 9, patientId: 42,
    } as any)
    // Patient 42 actif.
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    // Caller = ADMIN → bypass canMessage re-check.
    prismaMock.user.findUnique.mockResolvedValue({
      role: "ADMIN", patient: null,
    } as any)
    prismaMock.message.findMany.mockResolvedValue([
      { id: "m1", fromUserId: 1, toUserId: 9, bodyEncrypted: encryptedBody, createdAt: new Date(), readAt: null },
    ] as any)
    await messagingService.getThread(1, VALID_KEY, {}, ctx)
    const auditMeta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(auditMeta.metadata.patientId).toBe(42)
  })

  // H3 review : si patient soft-deleted, thread orphelin → 404.
  it("404 si patient soft-deleted (thread orphelin)", async () => {
    prismaMock.message.findFirst.mockResolvedValue({
      id: "m1", fromUserId: 1, toUserId: 9, patientId: 99,
    } as any)
    prismaMock.patient.findFirst.mockResolvedValue(null) // soft-deleted
    await expect(messagingService.getThread(1, VALID_KEY, {}, ctx))
      .rejects.toBeInstanceOf(MessagingNotFoundError)
  })

  // H9 review : ex-référent post-rupture → refus.
  it("404 si caller PS ne manage plus le patient (lien rompu post-rupture)", async () => {
    prismaMock.message.findFirst.mockResolvedValue({
      id: "m1", fromUserId: 5, toUserId: 9, patientId: 42,
    } as any)
    prismaMock.patient.findFirst.mockResolvedValueOnce({ id: 42 } as any) // 1er check (live patient)
    prismaMock.user.findUnique.mockResolvedValue({
      role: "DOCTOR", patient: null,
    } as any)
    prismaMock.healthcareMember.findUnique.mockResolvedValue({
      id: 100, serviceId: 7,
    } as any)
    prismaMock.patient.findFirst.mockResolvedValueOnce(null) // 2nd check (isPsManagingPatient) → no link
    await expect(messagingService.getThread(5, VALID_KEY, {}, ctx))
      .rejects.toBeInstanceOf(MessagingNotFoundError)
  })

  it("hasMore + nextCursor when results exceed limit", async () => {
    const enc = Buffer.from(encrypt("x"))
    prismaMock.message.findFirst.mockResolvedValue({
      id: "any", fromUserId: 1, toUserId: 2, patientId: null,
    } as any)
    const items = Array.from({ length: MESSAGING_BOUNDS.MAX_MESSAGES_PER_PAGE + 1 }, (_, i) => ({
      id: `m${i}`, fromUserId: 1, toUserId: 2, bodyEncrypted: enc,
      createdAt: new Date(1000 - i), readAt: null,
    }))
    prismaMock.message.findMany.mockResolvedValue(items as any)
    const out = await messagingService.getThread(1, VALID_KEY, {}, ctx)
    expect(out.items).toHaveLength(MESSAGING_BOUNDS.MAX_MESSAGES_PER_PAGE)
    expect(out.nextCursor).toBeTruthy()
  })
})

// ────────────────────────────────────────────────────────────────
// markRead
// ────────────────────────────────────────────────────────────────

describe("markRead", () => {
  it("marks message as read (count=1)", async () => {
    prismaMock.message.updateMany.mockResolvedValue({ count: 1 } as any)
    const out = await messagingService.markRead(2, "msg-1", ctx)
    expect(out.alreadyRead).toBe(false)
    expect(out.readAt).toBeInstanceOf(Date)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("message.markRead")
  })

  it("idempotent — alreadyRead=true if message already read", async () => {
    prismaMock.message.updateMany.mockResolvedValue({ count: 0 } as any)
    const previousReadAt = new Date(Date.now() - 60_000)
    prismaMock.message.findFirst.mockResolvedValue({
      id: "msg-1", toUserId: 2, readAt: previousReadAt,
    } as any)
    const out = await messagingService.markRead(2, "msg-1", ctx)
    expect(out.alreadyRead).toBe(true)
    expect(out.readAt).toEqual(previousReadAt)
  })

  it("throws NotFound when message doesn't exist", async () => {
    prismaMock.message.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.message.findFirst.mockResolvedValue(null)
    await expect(messagingService.markRead(2, "msg-99", ctx))
      .rejects.toBeInstanceOf(MessagingNotFoundError)
  })

  it("anti-énumération — non-recipient gets 404 + accessDenied audit", async () => {
    prismaMock.message.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.message.findFirst.mockResolvedValue({
      id: "msg-1", toUserId: 99, readAt: null,
    } as any)
    await expect(messagingService.markRead(2, "msg-1", ctx))
      .rejects.toBeInstanceOf(MessagingNotFoundError)
    // accessDenied audit row émis.
    const calls = prismaMock.auditLog.create.mock.calls
    const accessDenied = calls.find((c) => {
      const d = c[0].data as any
      return d.action === "UNAUTHORIZED" && d.resource === "MESSAGE"
    })
    expect(accessDenied).toBeDefined()
    const meta = (accessDenied![0].data as any).metadata
    expect(meta.kind).toBe("message.markRead.notRecipient")
    expect(meta.actualRecipientId).toBe(99)
  })
})
