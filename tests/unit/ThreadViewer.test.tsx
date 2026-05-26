/**
 * @vitest-environment jsdom
 *
 * Tests pour `ThreadViewer` (US-2076-UI iter 3).
 *
 * Couvre uniquement la logique UI shell + composer (hooks mockés).
 * Tests fetch/send/markRead dans leurs propres test files (hooks).
 *
 * Couvre :
 *   - conversationKey=null → empty state
 *   - error gdprConsentRevoked → loadError message
 *   - error notFound → threadNotFound message
 *   - Rendering messages avec bubble alignement isFromMe vs received
 *   - Status sent / sending / failed / readAt
 *   - Composer : disabled si vide, enabled si non-vide
 *   - Composer : Cmd+Enter → submit
 *   - Composer : byte counter (visible > 80% cap)
 *   - Composer : byte counter rouge si > MAX
 *   - LoadMore button visible si nextCursor
 *   - Banner stale-while-error si messages.length > 0 && error
 *   - send → optimistic append + clear composer + refetch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ThreadViewer } from "@/components/diabeo/messaging/ThreadViewer"
import * as useThreadMessagesModule from "@/components/diabeo/messaging/useThreadMessages"
import * as useSendMessageModule from "@/components/diabeo/messaging/useSendMessage"
import * as useMarkAsReadModule from "@/components/diabeo/messaging/useMarkAsRead"
import type { ThreadMessageItem } from "@/components/diabeo/messaging/useThreadMessages"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => {
    if (v && "time" in v) return `${k}:${v.time}`
    if (v && "current" in v) return `${k}:${v.current}/${v.max}`
    return k
  },
  useLocale: () => "fr",
}))

// IntersectionObserver polyfill stub (jsdom n'a pas l'API native).
// ThreadViewer utilise IntersectionObserver pour auto-mark-on-scroll.
beforeEach(() => {
  if (typeof IntersectionObserver === "undefined") {
    class IntersectionObserverStub {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      takeRecords = vi.fn().mockReturnValue([])
      root = null
      rootMargin = ""
      thresholds = []
    }
    ;(globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }).IntersectionObserver = IntersectionObserverStub
  }
})

function makeMessage(overrides: Partial<ThreadMessageItem> = {}): ThreadMessageItem {
  return {
    id: "m1",
    fromUserId: 7,
    toUserId: 1,
    body: "Hello",
    createdAt: "2026-05-26T10:00:00Z",
    readAt: null,
    ...overrides,
  }
}

function setupHooks(opts?: {
  messages?: ThreadMessageItem[]
  isInitialLoading?: boolean
  error?: "gdprConsentRevoked" | "notFound" | "networkError" | "unexpectedError" | null
  nextCursor?: string | null
  sendOutcome?: "ok" | "forbidden"
  sendLoading?: boolean
}) {
  const refetch = vi.fn().mockResolvedValue(undefined)
  const loadMore = vi.fn().mockResolvedValue(undefined)
  vi.spyOn(useThreadMessagesModule, "useThreadMessages").mockReturnValue({
    messages: opts?.messages ?? [],
    isInitialLoading: opts?.isInitialLoading ?? false,
    isLoadingMore: false,
    error: opts?.error ?? null,
    nextCursor: opts?.nextCursor ?? null,
    refetch,
    loadMore,
    lastFetchedAt: new Date("2026-05-26T10:00:00Z"),
  })

  const send = vi.fn().mockResolvedValue(
    opts?.sendOutcome === "forbidden"
      ? { ok: false, code: "forbidden" }
      : {
          ok: true,
          data: {
            id: "msg-new",
            conversationKey: "abc",
            fromUserId: 1,
            toUserId: 7,
            patientId: null,
            createdAt: new Date().toISOString(),
            fcm: { sent: 1, failed: 0 },
          },
        },
  )
  vi.spyOn(useSendMessageModule, "useSendMessage").mockReturnValue({
    loading: opts?.sendLoading ?? false,
    error: null,
    send,
    reset: vi.fn(),
  })

  const markAsRead = vi.fn().mockResolvedValue({ ok: true })
  vi.spyOn(useMarkAsReadModule, "useMarkAsRead").mockReturnValue({
    loading: false,
    error: null,
    markAsRead,
    reset: vi.fn(),
  })

  return { refetch, loadMore, send, markAsRead }
}

describe("ThreadViewer (iter 3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("empty / error states", () => {
    it("conversationKey=null → empty placeholder", () => {
      setupHooks()
      render(<ThreadViewer conversationKey={null} currentUserId={1} />)
      expect(screen.getByText("foundationPlaceholderEmpty")).toBeTruthy()
    })

    it("error gdprConsentRevoked → loadError", () => {
      setupHooks({ error: "gdprConsentRevoked" })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      expect(screen.getByText("loadError")).toBeTruthy()
    })

    it("error notFound → threadNotFound", () => {
      setupHooks({ error: "notFound" })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      expect(screen.getByText("threadNotFound")).toBeTruthy()
    })

    it("isInitialLoading=true → loading text", () => {
      setupHooks({ isInitialLoading: true })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      // role=status pour le inner loading + role=region (aria-live) pour outer
      const statuses = screen.getAllByRole("status")
      expect(statuses.length).toBeGreaterThan(0)
    })

    it("messages vide + pas d'erreur → threadEmptyNoMessage", () => {
      setupHooks({ messages: [] })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      expect(screen.getByText("threadEmptyNoMessage")).toBeTruthy()
    })
  })

  describe("messages rendering", () => {
    it("render message reçu (fromUserId !== currentUserId)", () => {
      setupHooks({
        messages: [makeMessage({ body: "Bonjour docteur", fromUserId: 7, toUserId: 1 })],
      })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      expect(screen.getByText("Bonjour docteur")).toBeTruthy()
    })

    it("render message envoyé (fromUserId === currentUserId) avec status Envoyé", () => {
      setupHooks({
        messages: [makeMessage({ body: "Hello patient", fromUserId: 1, toUserId: 7 })],
      })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      expect(screen.getByText("Hello patient")).toBeTruthy()
      expect(screen.getByText(/statusSent/)).toBeTruthy()
    })

    it("render message envoyé lu → statusReadAt avec timestamp", () => {
      setupHooks({
        messages: [
          makeMessage({
            body: "Lu test",
            fromUserId: 1,
            toUserId: 7,
            readAt: "2026-05-26T10:05:00Z",
          }),
        ],
      })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      expect(screen.getByText(/statusReadAt/)).toBeTruthy()
    })

    it("loadMore button visible si nextCursor", () => {
      setupHooks({
        messages: [makeMessage()],
        nextCursor: "page2",
      })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      expect(screen.getByText("loadMoreMessages")).toBeTruthy()
    })

    it("clic loadMore → appel hook loadMore", () => {
      const { loadMore } = setupHooks({
        messages: [makeMessage()],
        nextCursor: "page2",
      })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      fireEvent.click(screen.getByText("loadMoreMessages"))
      expect(loadMore).toHaveBeenCalledTimes(1)
    })

    it("loadMore button hidden si nextCursor null", () => {
      setupHooks({ messages: [makeMessage()], nextCursor: null })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      expect(screen.queryByText("loadMoreMessages")).toBeNull()
    })
  })

  describe("composer", () => {
    it("send button disabled si textarea vide", () => {
      setupHooks({ messages: [makeMessage()] })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      const sendBtn = screen.getByRole("button", { name: "composerSendAria" })
      expect((sendBtn as HTMLButtonElement).disabled).toBe(true)
    })

    it("send button enabled si textarea non-vide", () => {
      setupHooks({ messages: [makeMessage()] })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      const textarea = screen.getByLabelText("composerLabel") as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: "Hello" } })
      const sendBtn = screen.getByRole("button", { name: "composerSendAria" })
      expect((sendBtn as HTMLButtonElement).disabled).toBe(false)
    })

    it("clic send → optimistic + clear composer", async () => {
      const { send, refetch } = setupHooks({
        messages: [makeMessage({ fromUserId: 7, toUserId: 1 })],
      })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      const textarea = screen.getByLabelText("composerLabel") as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: "Réponse" } })
      const sendBtn = screen.getByRole("button", { name: "composerSendAria" })
      fireEvent.click(sendBtn)
      await waitFor(() => {
        expect(send).toHaveBeenCalledWith({ toUserId: 7, body: "Réponse" })
      })
      // composer clear (optimistic success)
      expect(textarea.value).toBe("")
      expect(refetch).toHaveBeenCalled()
    })

    it("byte counter visible > 80% du cap (8164 × 0.8 = 6531)", () => {
      setupHooks({ messages: [makeMessage()] })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      const textarea = screen.getByLabelText("composerLabel") as HTMLTextAreaElement
      const longBody = "a".repeat(7000)
      fireEvent.change(textarea, { target: { value: longBody } })
      expect(screen.getByText(/composerByteCount:7000/)).toBeTruthy()
    })

    it("byte counter hidden < 80% du cap", () => {
      setupHooks({ messages: [makeMessage()] })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      const textarea = screen.getByLabelText("composerLabel") as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: "short" } })
      expect(screen.queryByText(/composerByteCount/)).toBeNull()
    })

    it("byte counter > MAX → invalid + send disabled", () => {
      setupHooks({ messages: [makeMessage()] })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      const textarea = screen.getByLabelText("composerLabel") as HTMLTextAreaElement
      const tooLong = "a".repeat(9000)
      fireEvent.change(textarea, { target: { value: tooLong } })
      expect(textarea.getAttribute("aria-invalid")).toBe("true")
      const sendBtn = screen.getByRole("button", { name: "composerSendAria" })
      expect((sendBtn as HTMLButtonElement).disabled).toBe(true)
    })

    it("Cmd+Enter dans textarea → submit", async () => {
      const { send } = setupHooks({
        messages: [makeMessage({ fromUserId: 7, toUserId: 1 })],
      })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      const textarea = screen.getByLabelText("composerLabel") as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: "Quick reply" } })
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true })
      await waitFor(() => {
        expect(send).toHaveBeenCalled()
      })
    })

    it("send error forbidden → optimistic rollback + restore composer value", async () => {
      setupHooks({
        messages: [makeMessage({ fromUserId: 7, toUserId: 1 })],
        sendOutcome: "forbidden",
      })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      const textarea = screen.getByLabelText("composerLabel") as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: "Test error" } })
      fireEvent.click(screen.getByRole("button", { name: "composerSendAria" }))
      await waitFor(() => {
        // Restore composer value après échec pour permettre retry rapide.
        expect(textarea.value).toBe("Test error")
        expect(screen.getByText("composerErrorForbidden")).toBeTruthy()
      })
    })
  })

  describe("stale-while-error banner", () => {
    it("error + messages non-vide → banner syncInterrupted", () => {
      setupHooks({
        messages: [makeMessage()],
        error: "networkError",
      })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      expect(screen.getByText("syncInterrupted")).toBeTruthy()
    })

    it("error + messages vide → loadError full (pas banner)", () => {
      setupHooks({ messages: [], error: "gdprConsentRevoked" })
      render(<ThreadViewer conversationKey="abc" currentUserId={1} />)
      expect(screen.queryByText("syncInterrupted")).toBeNull()
    })
  })
})
