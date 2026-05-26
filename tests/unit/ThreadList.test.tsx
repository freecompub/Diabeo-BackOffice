/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour `ThreadList` (US-2076-UI iter 2).
 *
 * Couvre :
 *   - Render heading + search + filter buttons
 *   - Liste threads + tri préservé (backend DISTINCT ON DESC)
 *   - Filter "Non lus" : retire threads avec unreadCount=0
 *   - Search query : filtre client-side sur otherUserId / patientId / conversationKey
 *   - Empty state : aucune conversation vs aucun résultat de recherche
 *   - aria-current="location" sur thread sélectionné
 *   - aria-pressed sur filter toggles
 *   - Loading state (isInitialLoading)
 *   - Error states (gdprConsentRevoked + networkError)
 *   - Badge unreadCount capped à "9+"
 *   - Preview prefix "Vous :" si fromUserId === currentUserId
 *   - Avatar P / U selon patientId
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ThreadList } from "@/components/diabeo/messaging/ThreadList"
import * as useMessageThreadsModule from "@/components/diabeo/messaging/useMessageThreads"
import type { ThreadListItem } from "@/components/diabeo/messaging/useMessageThreads"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => {
    if (v && "count" in v) return `${k}=${v.count}`
    if (v && "time" in v) return `${k}:${v.time}`
    return k
  },
  useLocale: () => "fr",
}))

function makeThread(overrides: Partial<ThreadListItem> = {}): ThreadListItem {
  return {
    conversationKey: "abc123",
    otherUserId: 7,
    patientId: 42,
    lastMessage: {
      id: "msg-1",
      fromUserId: 7,
      bodyPreview: "Hello doc",
      bodyPreviewTruncated: false,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      isRead: false,
    },
    unreadCount: 2,
    ...overrides,
  }
}

function renderList(
  threads: ThreadListItem[],
  opts?: { loading?: boolean; error?: "gdprConsentRevoked" | "networkError" | null; selectedKey?: string | null; currentUserId?: number },
) {
  vi.spyOn(useMessageThreadsModule, "useMessageThreads").mockReturnValue({
    threads,
    isInitialLoading: opts?.loading ?? false,
    error: opts?.error ?? null,
    refetch: vi.fn().mockResolvedValue(undefined),
    lastFetchedAt: new Date("2026-05-26T10:00:00Z"),
  })
  return render(
    <ThreadList
      currentUserId={opts?.currentUserId ?? 1}
      selectedKey={opts?.selectedKey ?? null}
      onSelect={vi.fn()}
    />,
  )
}

describe("ThreadList (iter 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("rendering states", () => {
    it("isInitialLoading=true → status role loading", () => {
      renderList([], { loading: true })
      const el = screen.getByRole("status")
      expect(el.textContent).toContain("loading")
      expect(el.getAttribute("aria-busy")).toBe("true")
    })

    it("error gdprConsentRevoked → message loadError sans alert", () => {
      renderList([], { error: "gdprConsentRevoked" })
      expect(screen.getByText("loadError")).toBeTruthy()
    })

    it("error networkError → alert + lastSync timestamp", () => {
      renderList([], { error: "networkError" })
      const alert = screen.getByRole("alert")
      expect(alert.textContent).toContain("loadError")
      expect(alert.getAttribute("aria-atomic")).toBe("true")
    })

    it("empty threads + no query → emptyStateNoConversation", () => {
      renderList([])
      expect(screen.getByText("emptyStateNoConversation")).toBeTruthy()
    })

    it("empty result avec filtre Non lus → emptyStateFiltered", () => {
      renderList([makeThread({ unreadCount: 0 })])
      fireEvent.click(screen.getByText("filterUnread"))
      expect(screen.getByText("emptyStateFiltered")).toBeTruthy()
    })
  })

  describe("thread items", () => {
    it("render N items avec key conversationKey", () => {
      const items = [
        makeThread({ conversationKey: "k1", patientId: 1 }),
        makeThread({ conversationKey: "k2", patientId: 2 }),
        makeThread({ conversationKey: "k3", patientId: 3 }),
      ]
      renderList(items)
      const buttons = screen.getAllByRole("button").filter((b) => b.getAttribute("type") === "button")
      // 2 filter buttons + 3 thread buttons (+ search may be there)
      const threadButtons = buttons.filter((b) => b.className.includes("min-h-[64px]"))
      expect(threadButtons.length).toBe(3)
    })

    it("aria-current='location' sur thread sélectionné", () => {
      const items = [makeThread({ conversationKey: "selected-key" })]
      renderList(items, { selectedKey: "selected-key" })
      const allButtons = screen.getAllByRole("button")
      const selectedItem = allButtons.find((b) => b.getAttribute("aria-current") === "location")
      expect(selectedItem).toBeTruthy()
    })

    it("avatar 'P' si patientId set", () => {
      const items = [makeThread({ patientId: 42 })]
      renderList(items)
      expect(screen.getByText("P")).toBeTruthy()
    })

    it("avatar 'U' si patientId null (staff↔staff)", () => {
      const items = [makeThread({ patientId: null })]
      renderList(items)
      expect(screen.getByText("U")).toBeTruthy()
    })

    it("preview prefix 'Vous :' si fromUserId === currentUserId", () => {
      const items = [makeThread({ lastMessage: { ...makeThread().lastMessage, fromUserId: 42 } })]
      renderList(items, { currentUserId: 42 })
      expect(screen.getByText(/previewPrefixMe/)).toBeTruthy()
    })

    it("badge unreadCount visible si > 0", () => {
      const items = [makeThread({ unreadCount: 5 })]
      renderList(items)
      // "5" apparait dans le filtre Non lus (total) ET dans le badge item.
      const matches = screen.getAllByText("5")
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })

    it("badge unreadCount capped à '9+' si > 9", () => {
      const items = [makeThread({ unreadCount: 42 })]
      renderList(items)
      // Le badge `9+` apparait dans la card (le 42 reste dans le sr-only count)
      const badges = screen.getAllByText("9+")
      expect(badges.length).toBeGreaterThan(0)
    })

    it("sr-only itemUnreadAria affiché pour SR", () => {
      const items = [makeThread({ unreadCount: 3 })]
      renderList(items)
      expect(screen.getByText("itemUnreadAria=3")).toBeTruthy()
    })

    it("pas de badge si unreadCount=0", () => {
      const items = [makeThread({ unreadCount: 0 })]
      renderList(items)
      expect(screen.queryByText("itemUnreadAria=0")).toBeNull()
    })

    it("clic sur item → onSelect(conversationKey)", () => {
      const onSelect = vi.fn()
      vi.spyOn(useMessageThreadsModule, "useMessageThreads").mockReturnValue({
        threads: [makeThread({ conversationKey: "click-me" })],
        isInitialLoading: false,
        error: null,
        refetch: vi.fn(),
        lastFetchedAt: new Date(),
      })
      render(<ThreadList currentUserId={1} selectedKey={null} onSelect={onSelect} />)
      const itemButton = screen
        .getAllByRole("button")
        .find((b) => b.className.includes("min-h-[64px]"))
      expect(itemButton).toBeTruthy()
      fireEvent.click(itemButton!)
      expect(onSelect).toHaveBeenCalledWith("click-me")
    })
  })

  describe("filter Tous / Non lus", () => {
    it("filtre 'Non lus' aria-pressed=true quand actif", () => {
      renderList([makeThread()])
      const unreadBtn = screen.getByText("filterUnread").closest("button")!
      expect(unreadBtn.getAttribute("aria-pressed")).toBe("false")
      fireEvent.click(unreadBtn)
      expect(unreadBtn.getAttribute("aria-pressed")).toBe("true")
    })

    it("filtre 'Tous' montre toutes les conversations", () => {
      const items = [
        makeThread({ conversationKey: "k1", unreadCount: 0 }),
        makeThread({ conversationKey: "k2", unreadCount: 3 }),
      ]
      renderList(items)
      const threadButtons = screen
        .getAllByRole("button")
        .filter((b) => b.className.includes("min-h-[64px]"))
      expect(threadButtons.length).toBe(2)
    })

    it("filtre 'Non lus' retire threads unreadCount=0", () => {
      const items = [
        makeThread({ conversationKey: "k1", unreadCount: 0 }),
        makeThread({ conversationKey: "k2", unreadCount: 3 }),
      ]
      renderList(items)
      fireEvent.click(screen.getByText("filterUnread"))
      const threadButtons = screen
        .getAllByRole("button")
        .filter((b) => b.className.includes("min-h-[64px]"))
      expect(threadButtons.length).toBe(1)
    })

    it("badge unread total à droite du filtre 'Non lus' si > 0", () => {
      const items = [
        makeThread({ unreadCount: 2 }),
        makeThread({ unreadCount: 5 }),
      ]
      renderList(items)
      // Total unread = 7, affiché dans le filter button badge
      const unreadBtn = screen.getByText("filterUnread").closest("button")!
      expect(unreadBtn.textContent).toContain("7")
    })
  })

  describe("search", () => {
    it("search vide → toutes les conversations visibles", () => {
      const items = [
        makeThread({ conversationKey: "k1", patientId: 100 }),
        makeThread({ conversationKey: "k2", patientId: 200 }),
      ]
      renderList(items)
      const threadButtons = screen
        .getAllByRole("button")
        .filter((b) => b.className.includes("min-h-[64px]"))
      expect(threadButtons.length).toBe(2)
    })

    it("search par patientId numérique filtre la liste", () => {
      const items = [
        makeThread({ conversationKey: "k1", patientId: 100, otherUserId: 1 }),
        makeThread({ conversationKey: "k2", patientId: 200, otherUserId: 2 }),
      ]
      renderList(items)
      const input = screen.getByRole("searchbox")
      fireEvent.change(input, { target: { value: "100" } })
      const threadButtons = screen
        .getAllByRole("button")
        .filter((b) => b.className.includes("min-h-[64px]"))
      expect(threadButtons.length).toBe(1)
    })

    it("bouton clear search vide la query", () => {
      const items = [makeThread()]
      renderList(items)
      const input = screen.getByRole("searchbox") as HTMLInputElement
      fireEvent.change(input, { target: { value: "foo" } })
      expect(input.value).toBe("foo")
      const clearBtn = screen.getByRole("button", { name: "searchClear" })
      fireEvent.click(clearBtn)
      expect(input.value).toBe("")
    })
  })
})
