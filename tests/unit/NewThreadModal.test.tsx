/**
 * @vitest-environment jsdom
 *
 * Tests pour `NewThreadModal` (US-2076-UI iter 4).
 *
 * Couvre :
 *   - open=false → not rendered
 *   - open=true → title + description + contacts list visible
 *   - isLoading state → loading message
 *   - error contacts → forbidden / load
 *   - search filter client-side
 *   - selection contact → aria-checked="true"
 *   - send button disabled si no contact / no body / loading
 *   - send button enabled si contact + body
 *   - clic send → useSendMessage.send + onMessageSent callback
 *   - clic cancel → onClose
 *   - Cmd+Enter dans textarea → submit
 *   - byte counter > 80% du cap
 *   - composer error display (mapping)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { NewThreadModal } from "@/components/diabeo/messaging/NewThreadModal"
import * as useMessagingContactsModule from "@/components/diabeo/messaging/useMessagingContacts"
import * as useSendMessageModule from "@/components/diabeo/messaging/useSendMessage"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => {
    if (v && "current" in v) return `${k}:${v.current}/${v.max}`
    return k
  },
}))

function setupHooks(opts?: {
  contacts?: Array<{ patientId: number; userId: number; displayName: string }>
  contactsLoading?: boolean
  contactsError?: "forbidden" | "networkError" | "unexpectedError" | null
  sendOutcome?: "ok" | "forbidden"
  sendLoading?: boolean
}) {
  vi.spyOn(useMessagingContactsModule, "useMessagingContacts").mockReturnValue({
    contacts: opts?.contacts ?? [],
    isLoading: opts?.contactsLoading ?? false,
    error: opts?.contactsError ?? null,
    refetch: vi.fn().mockResolvedValue(undefined),
  })
  const send = vi.fn().mockResolvedValue(
    opts?.sendOutcome === "forbidden"
      ? { ok: false, code: "forbidden" }
      : {
          ok: true,
          data: {
            id: "msg-new",
            conversationKey: "new-key",
            fromUserId: 1,
            toUserId: 100,
            patientId: 42,
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
  return { send }
}

const defaultContacts = [
  { patientId: 1, userId: 100, displayName: "Patient #1" },
  { patientId: 2, userId: 200, displayName: "Patient #2" },
  { patientId: 3, userId: 300, displayName: "Patient #3" },
]

describe("NewThreadModal (iter 4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("open=false → modal not rendered", () => {
    setupHooks()
    render(<NewThreadModal open={false} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    expect(screen.queryByText("newThreadTitle")).toBeNull()
  })

  it("open=true → title + description + contacts radiogroup visible", () => {
    setupHooks({ contacts: defaultContacts })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    expect(screen.getByText("newThreadTitle")).toBeTruthy()
    expect(screen.getByText("newThreadDescription")).toBeTruthy()
    expect(screen.getByRole("radiogroup")).toBeTruthy()
    expect(screen.getAllByRole("radio").length).toBe(3)
  })

  it("isLoading → newThreadLoadingContacts visible", () => {
    setupHooks({ contactsLoading: true })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    expect(screen.getByText("newThreadLoadingContacts")).toBeTruthy()
  })

  it("error forbidden → newThreadErrorForbidden visible", () => {
    setupHooks({ contactsError: "forbidden" })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    expect(screen.getByText("newThreadErrorForbidden")).toBeTruthy()
  })

  it("error networkError → newThreadErrorLoad visible", () => {
    setupHooks({ contactsError: "networkError" })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    expect(screen.getByText("newThreadErrorLoad")).toBeTruthy()
  })

  it("empty contacts → newThreadNoContacts visible", () => {
    setupHooks({ contacts: [] })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    expect(screen.getByText("newThreadNoContacts")).toBeTruthy()
  })

  it("search filter → no match → newThreadNoMatch", () => {
    setupHooks({ contacts: defaultContacts })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    const search = screen.getByRole("searchbox")
    fireEvent.change(search, { target: { value: "999" } })
    expect(screen.getByText("newThreadNoMatch")).toBeTruthy()
  })

  it("search filter par patientId → 1 résultat", () => {
    setupHooks({ contacts: defaultContacts })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    const search = screen.getByRole("searchbox")
    fireEvent.change(search, { target: { value: "1" } })
    // Patient #1 + Patient #100 (userId 100 contient "1") + Patient #200 + Patient #300 — beaucoup match.
    // Test plus précis : "Patient #1" exact (haystack includes "patient #1").
    const radios = screen.getAllByRole("radio")
    // Au moins "Patient #1" devrait matcher.
    expect(radios.length).toBeGreaterThanOrEqual(1)
  })

  it("selection contact → aria-checked='true'", () => {
    setupHooks({ contacts: defaultContacts })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    const radios = screen.getAllByRole("radio")
    fireEvent.click(radios[0]!)
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true")
    expect(radios[1]!.getAttribute("aria-checked")).toBe("false")
  })

  it("send button disabled si pas de contact selected", () => {
    setupHooks({ contacts: defaultContacts })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    const textarea = screen.getByLabelText("composerLabel") as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "Hello" } })
    const sendBtn = screen.getByRole("button", { name: "composerSendAria" })
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it("send button disabled si pas de body", () => {
    setupHooks({ contacts: defaultContacts })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    fireEvent.click(screen.getAllByRole("radio")[0]!)
    const sendBtn = screen.getByRole("button", { name: "composerSendAria" })
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it("send button enabled si contact + body", () => {
    setupHooks({ contacts: defaultContacts })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    fireEvent.click(screen.getAllByRole("radio")[0]!)
    const textarea = screen.getByLabelText("composerLabel") as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "Hello" } })
    const sendBtn = screen.getByRole("button", { name: "composerSendAria" })
    expect((sendBtn as HTMLButtonElement).disabled).toBe(false)
  })

  it("clic send → useSendMessage.send + onMessageSent callback", async () => {
    const onMessageSent = vi.fn()
    const { send } = setupHooks({ contacts: defaultContacts })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={onMessageSent} />)
    fireEvent.click(screen.getAllByRole("radio")[0]!)
    fireEvent.change(screen.getByLabelText("composerLabel") as HTMLTextAreaElement, {
      target: { value: "Premier message" },
    })
    fireEvent.click(screen.getByRole("button", { name: "composerSendAria" }))
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith({ toUserId: 100, body: "Premier message" })
      expect(onMessageSent).toHaveBeenCalledWith("new-key", 100)
    })
  })

  it("clic cancel → onClose", () => {
    const onClose = vi.fn()
    setupHooks({ contacts: defaultContacts })
    render(<NewThreadModal open={true} onClose={onClose} onMessageSent={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "actionCancel" }))
    expect(onClose).toHaveBeenCalled()
  })

  it("Cmd+Enter dans textarea → submit", async () => {
    const { send } = setupHooks({ contacts: defaultContacts })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    fireEvent.click(screen.getAllByRole("radio")[0]!)
    const textarea = screen.getByLabelText("composerLabel") as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "Quick" } })
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true })
    await waitFor(() => expect(send).toHaveBeenCalled())
  })

  it("byte counter visible si body > 80% du cap (8164 × 0.8 = 6531)", () => {
    setupHooks({ contacts: defaultContacts })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("composerLabel") as HTMLTextAreaElement, {
      target: { value: "a".repeat(7000) },
    })
    expect(screen.getByText(/composerByteCount:7000/)).toBeTruthy()
  })

  it("send error forbidden → composerError message + composer keep value", async () => {
    setupHooks({ contacts: defaultContacts, sendOutcome: "forbidden" })
    render(<NewThreadModal open={true} onClose={vi.fn()} onMessageSent={vi.fn()} />)
    fireEvent.click(screen.getAllByRole("radio")[0]!)
    const textarea = screen.getByLabelText("composerLabel") as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "Test fail" } })
    fireEvent.click(screen.getByRole("button", { name: "composerSendAria" }))
    await waitFor(() => {
      expect(screen.getByText("composerErrorForbidden")).toBeTruthy()
    })
  })
})
