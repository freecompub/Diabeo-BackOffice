/**
 * @vitest-environment jsdom
 *
 * Tests pour Fix B2 round 1 review PR #440 — `UnreadCountContext` partagé
 * entre desktop sidebar + mobile Sheet pour éviter le double polling.
 *
 * Couvre :
 *   - Provider monté UNE FOIS, useUnreadCount appelé UNE FOIS (single fetch)
 *   - useUnreadCountFromContext consume depuis n'importe quel descendant
 *   - Fallback null si Provider absent
 *   - skip prop propagé au hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, waitFor } from "@testing-library/react"
import {
  UnreadCountProvider,
  useUnreadCountFromContext,
} from "@/components/diabeo/messaging/UnreadCountContext"

function Consumer() {
  const ctx = useUnreadCountFromContext()
  if (ctx === null) return <span data-testid="result">no-provider</span>
  return <span data-testid="result">{ctx.count}</span>
}

describe("UnreadCountContext (Fix B2 PR #440)", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("Provider absent → consumer retourne null (fallback safe)", () => {
    render(<Consumer />)
    expect(screen.getByTestId("result").textContent).toBe("no-provider")
  })

  it("Provider monté → consumer reçoit le count après fetch", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: 5 }),
    } as Response)

    render(
      <UnreadCountProvider>
        <Consumer />
      </UnreadCountProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId("result").textContent).toBe("5")
    })
  })

  it("Provider avec skip=true → pas de fetch + count 0", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
    render(
      <UnreadCountProvider skip={true}>
        <Consumer />
      </UnreadCountProvider>,
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId("result").textContent).toBe("0")
  })

  it("Fix B2 : 2 consumers descendants partagent UN SEUL fetch (pas de double polling)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: 7 }),
    } as Response)

    render(
      <UnreadCountProvider>
        <Consumer />
        <Consumer />
      </UnreadCountProvider>,
    )
    await waitFor(() => {
      const results = screen.getAllByTestId("result")
      expect(results.length).toBe(2)
      expect(results[0].textContent).toBe("7")
      expect(results[1].textContent).toBe("7")
    })
    // KEY ASSERTION : un seul fetch malgré 2 consumers (hook unique au Provider).
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("Fix B2 : 2 Providers séparés = 2 fetchs (non-régression — chacun isolé)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: 3 }),
    } as Response)

    render(
      <>
        <UnreadCountProvider>
          <Consumer />
        </UnreadCountProvider>
        <UnreadCountProvider>
          <Consumer />
        </UnreadCountProvider>
      </>,
    )
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
  })
})
