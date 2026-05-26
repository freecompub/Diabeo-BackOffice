/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour `MessagingInbox` (US-2076-UI iter 2 — ThreadList wired).
 *
 * Couvre la structure layout 2-col responsive + navigation thread :
 *   - Render 2 landmarks (aside threads + section viewer aria-labels)
 *   - Mobile : selectedKey=null → liste visible / viewer caché
 *   - Mobile : selectedKey set → viewer visible / liste cachée + bouton back
 *   - Sélection thread propage selectedKey via onSelect du ThreadList
 *   - Bouton "back to list" reset selectedKey
 *   - Fix H6 PR #440 : back button focus-visible classes
 *
 * Note iter 2 : `ThreadList` réel est mocké pour focus sur layout shell
 * uniquement. Tests dédiés ThreadList dans `ThreadList.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MessagingInbox } from "@/components/diabeo/messaging/MessagingInbox"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => {
    if (v && "id" in v) return `${k}#${v.id}`
    if (v && "key" in v) return `${k}:${v.key}`
    if (v && "role" in v) return `${k}:role=${v.role}`
    return k
  },
  useLocale: () => "fr",
}))

// Mock ThreadList + ThreadViewer pour isoler les tests shell de la logique fetch.
vi.mock("@/components/diabeo/messaging/ThreadList", () => ({
  ThreadList: ({
    currentUserId,
    selectedKey,
    onSelect,
  }: {
    currentUserId: number
    selectedKey: string | null
    onSelect: (key: string) => void
  }) => (
    <div data-testid="mocked-thread-list">
      <span data-testid="current-user-id">{currentUserId}</span>
      <span data-testid="selected-key">{selectedKey ?? "none"}</span>
      <button type="button" onClick={() => onSelect("thread-key-1")}>
        select-thread-1
      </button>
      <button type="button" onClick={() => onSelect("thread-key-2")}>
        select-thread-2
      </button>
    </div>
  ),
}))

vi.mock("@/components/diabeo/messaging/ThreadViewer", () => ({
  ThreadViewer: ({
    conversationKey,
    currentUserId,
  }: {
    conversationKey: string | null
    currentUserId: number
  }) => (
    <div data-testid="mocked-thread-viewer">
      {conversationKey === null ? (
        <span data-testid="thread-viewer-empty">no-thread</span>
      ) : (
        <span data-testid="thread-viewer-placeholder">
          viewer-key:{conversationKey}|user:{currentUserId}
        </span>
      )}
    </div>
  ),
}))

describe("MessagingInbox (iter 2 — ThreadList wired)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("render 2 landmarks (aside threads aria-labelledby + section viewer)", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    const aside = screen.getByRole("complementary")
    expect(aside).toBeTruthy()
    expect(aside.getAttribute("aria-labelledby")).toBe("messaging-thread-list-heading")
    const section = screen.getByRole("region", { name: "threadViewerLabel" })
    expect(section).toBeTruthy()
  })

  it("render ThreadList avec currentUserId propagé depuis prop", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    expect(screen.getByTestId("current-user-id").textContent).toBe("42")
  })

  it("initial state : selectedKey null → viewer empty", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    expect(screen.getByTestId("thread-viewer-empty")).toBeTruthy()
    expect(screen.queryByTestId("thread-viewer-placeholder")).toBeNull()
    expect(screen.getByTestId("selected-key").textContent).toBe("none")
  })

  it("clic thread #1 dans ThreadList → propage selectedKey → viewer affiche message", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    fireEvent.click(screen.getByText("select-thread-1"))
    const viewer = screen.getByTestId("thread-viewer-placeholder")
    expect(viewer.textContent).toContain("viewer-key:thread-key-1")
    expect(viewer.textContent).toContain("user:42")
    expect(screen.getByTestId("selected-key").textContent).toBe("thread-key-1")
  })

  it("bouton 'back to list' apparaît UNIQUEMENT quand thread sélectionné", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    expect(screen.queryByRole("button", { name: "backToList" })).toBeNull()
    fireEvent.click(screen.getByText("select-thread-1"))
    expect(screen.getByRole("button", { name: "backToList" })).toBeTruthy()
  })

  it("clic 'back to list' reset selectedKey → viewer empty + ThreadList sans selection", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    fireEvent.click(screen.getByText("select-thread-1"))
    expect(screen.getByTestId("thread-viewer-placeholder")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "backToList" }))
    expect(screen.queryByTestId("thread-viewer-placeholder")).toBeNull()
    expect(screen.getByTestId("thread-viewer-empty")).toBeTruthy()
    expect(screen.getByTestId("selected-key").textContent).toBe("none")
  })

  it("switch entre threads — selectedKey suit la dernière sélection", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    fireEvent.click(screen.getByText("select-thread-1"))
    expect(screen.getByTestId("selected-key").textContent).toBe("thread-key-1")
    fireEvent.click(screen.getByText("select-thread-2"))
    expect(screen.getByTestId("selected-key").textContent).toBe("thread-key-2")
  })

  it("Fix H6 PR #440 : back button focus-visible ring (RTL safe)", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    fireEvent.click(screen.getByText("select-thread-1"))
    const back = screen.getByRole("button", { name: "backToList" })
    expect(back.className).toContain("min-h-[44px]")
    expect(back.className).toContain("focus-visible:ring-2")
    expect(back.className).toContain("focus-visible:ring-primary")
  })

  it("userId propagé même pour ADMIN role", () => {
    render(<MessagingInbox userId={1} userRole="ADMIN" />)
    expect(screen.getByTestId("current-user-id").textContent).toBe("1")
  })

  it("userId propagé même pour NURSE role", () => {
    render(<MessagingInbox userId={100} userRole="NURSE" />)
    expect(screen.getByTestId("current-user-id").textContent).toBe("100")
  })
})
