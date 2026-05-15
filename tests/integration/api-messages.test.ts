/**
 * @description US-2076 scope A — Integration tests pour les 5 routes
 * messagerie (`/api/messages`, `/unread-count`, `/thread/[key]`, `/[id]/read`).
 *
 * Vérifie :
 *   - 401 sans JWT (headers x-user-id/x-user-role absents)
 *   - 400/422 validation Zod
 *   - 201 send success path
 *   - 200 unread count
 *   - 200 thread fetch
 *   - 403 RBAC fail
 *   - 429 rate limit
 *
 * Mocke `messagingService` pour éviter le besoin d'une DB Prisma réelle.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// Mock Prisma client to avoid DATABASE_URL requirement.
vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/messaging.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/messaging.service")>()
  return {
    ...actual,
    messagingService: {
      send: vi.fn(),
      unreadCount: vi.fn(),
      listThreads: vi.fn(),
      getThread: vi.fn(),
      markRead: vi.fn(),
    },
  }
})

import { messagingService } from "@/lib/services/messaging.service"
import {
  MessagingValidationError,
  MessagingAccessError,
  MessagingRateLimitError,
  MessagingNotFoundError,
} from "@/lib/services/messaging.service"

const { POST: sendPOST, GET: listGET } = await import("@/app/api/messages/route")
const { GET: unreadGET } = await import(
  "@/app/api/messages/unread-count/route"
)
const { GET: threadGET } = await import(
  "@/app/api/messages/thread/[conversationKey]/route"
)
const { PUT: markReadPUT } = await import("@/app/api/messages/[id]/read/route")

const authHeaders = {
  "x-user-id": "1",
  "x-user-role": "DOCTOR",
}

function makeReq(
  url: string,
  init: RequestInit & { auth?: boolean } = {},
): NextRequest {
  const headers = new Headers(init.headers)
  if (init.auth !== false) {
    headers.set("x-user-id", authHeaders["x-user-id"])
    headers.set("x-user-role", authHeaders["x-user-role"])
  }
  return new NextRequest(new URL(url, "http://test.local"), {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ────────────────────────────────────────────────────────────────
// Auth (401 without JWT headers)
// ────────────────────────────────────────────────────────────────

describe("auth", () => {
  it("GET /api/messages → 401 without JWT headers", async () => {
    const res = await listGET(makeReq("/api/messages", { auth: false }))
    expect(res.status).toBe(401)
  })

  it("POST /api/messages → 401 without JWT headers", async () => {
    const res = await sendPOST(
      makeReq("/api/messages", {
        auth: false,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toUserId: 2, body: "x" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("GET /api/messages/unread-count → 401 without JWT", async () => {
    const res = await unreadGET(
      makeReq("/api/messages/unread-count", { auth: false }),
    )
    expect(res.status).toBe(401)
  })
})

// ────────────────────────────────────────────────────────────────
// POST /api/messages
// ────────────────────────────────────────────────────────────────

describe("POST /api/messages", () => {
  it("201 on success", async () => {
    vi.mocked(messagingService.send).mockResolvedValue({
      id: "m1", conversationKey: "a".repeat(64),
      fromUserId: 1, toUserId: 2, patientId: null,
      createdAt: new Date(), fcm: { sent: 1, failed: 0 },
    } as any)
    const res = await sendPOST(
      makeReq("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toUserId: 2, body: "Hello" }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.message.id).toBe("m1")
  })

  it("400 on invalid body (missing toUserId)", async () => {
    const res = await sendPOST(
      makeReq("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Hello" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("415 on non-JSON Content-Type", async () => {
    const res = await sendPOST(
      makeReq("/api/messages", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "raw",
      }),
    )
    expect(res.status).toBe(415)
  })

  it("403 when canMessage denies (MessagingAccessError)", async () => {
    vi.mocked(messagingService.send).mockRejectedValue(
      new MessagingAccessError("psNotManaging"),
    )
    const res = await sendPOST(
      makeReq("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toUserId: 2, body: "x" }),
      }),
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.reason).toBe("psNotManaging")
  })

  it("422 on validation error from service (e.g. selfMessage)", async () => {
    vi.mocked(messagingService.send).mockRejectedValue(
      new MessagingValidationError("userId", "selfMessageForbidden"),
    )
    const res = await sendPOST(
      makeReq("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toUserId: 1, body: "x" }),
      }),
    )
    expect(res.status).toBe(422)
  })

  it("429 + Retry-After when rate limit hit", async () => {
    vi.mocked(messagingService.send).mockRejectedValue(
      new MessagingRateLimitError(42),
    )
    const res = await sendPOST(
      makeReq("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toUserId: 2, body: "x" }),
      }),
    )
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("42")
  })
})

// ────────────────────────────────────────────────────────────────
// GET /api/messages (inbox)
// ────────────────────────────────────────────────────────────────

describe("GET /api/messages", () => {
  it("200 returns items list", async () => {
    vi.mocked(messagingService.listThreads).mockResolvedValue([
      { conversationKey: "a".repeat(64), otherUserId: 2, patientId: null,
        lastMessage: { id: "m1", fromUserId: 2, bodyPreview: "Hi",
          createdAt: new Date(), isRead: false },
        unreadCount: 1 },
    ] as any)
    const res = await listGET(makeReq("/api/messages"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────────
// GET /api/messages/unread-count
// ────────────────────────────────────────────────────────────────

describe("GET /api/messages/unread-count", () => {
  it("200 returns count + no-cache header", async () => {
    vi.mocked(messagingService.unreadCount).mockResolvedValue({ count: 5 })
    const res = await unreadGET(makeReq("/api/messages/unread-count"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    const body = await res.json()
    expect(body.count).toBe(5)
  })
})

// ────────────────────────────────────────────────────────────────
// GET /api/messages/thread/[conversationKey]
// ────────────────────────────────────────────────────────────────

describe("GET /api/messages/thread/[conversationKey]", () => {
  const KEY = "a".repeat(64)

  it("200 returns thread items", async () => {
    vi.mocked(messagingService.getThread).mockResolvedValue({
      items: [
        { id: "m1", fromUserId: 2, toUserId: 1, body: "Hi",
          createdAt: new Date(), readAt: null },
      ],
      nextCursor: null,
    })
    const res = await threadGET(
      makeReq(`/api/messages/thread/${KEY}`),
      { params: Promise.resolve({ conversationKey: KEY }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
  })

  it("400 on invalid conversationKey shape", async () => {
    const res = await threadGET(
      makeReq("/api/messages/thread/invalid"),
      { params: Promise.resolve({ conversationKey: "invalid" }) },
    )
    expect(res.status).toBe(400)
  })

  it("404 when service throws NotFound", async () => {
    vi.mocked(messagingService.getThread).mockRejectedValue(
      new MessagingNotFoundError("threadNotFound"),
    )
    const res = await threadGET(
      makeReq(`/api/messages/thread/${KEY}`),
      { params: Promise.resolve({ conversationKey: KEY }) },
    )
    expect(res.status).toBe(404)
  })
})

// ────────────────────────────────────────────────────────────────
// PUT /api/messages/[id]/read
// ────────────────────────────────────────────────────────────────

describe("PUT /api/messages/[id]/read", () => {
  it("200 marks as read", async () => {
    vi.mocked(messagingService.markRead).mockResolvedValue({
      id: "msg-1", readAt: new Date(), alreadyRead: false,
    })
    const res = await markReadPUT(
      makeReq("/api/messages/msg-1/read", { method: "PUT" }),
      { params: Promise.resolve({ id: "msg-1" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alreadyRead).toBe(false)
  })

  it("404 when message not found", async () => {
    vi.mocked(messagingService.markRead).mockRejectedValue(
      new MessagingNotFoundError(),
    )
    const res = await markReadPUT(
      makeReq("/api/messages/msg-99/read", { method: "PUT" }),
      { params: Promise.resolve({ id: "msg-99" }) },
    )
    expect(res.status).toBe(404)
  })

  it("400 on invalid id shape (special chars)", async () => {
    const res = await markReadPUT(
      makeReq("/api/messages/bad!id/read", { method: "PUT" }),
      { params: Promise.resolve({ id: "bad!id" }) },
    )
    expect(res.status).toBe(400)
  })
})
