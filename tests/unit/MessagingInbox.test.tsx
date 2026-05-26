/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour `MessagingInbox` (US-2076-UI iter 1 foundation +
 * round 1 review fixes PR #440).
 *
 * Couvre la structure layout 2-col responsive + placeholders + nav mobile :
 *   - Render 2 landmarks (aside threads aria-labelledby + section viewer)
 *   - Mobile : selectedKey=null → liste visible / viewer caché
 *   - Mobile : selectedKey set → viewer visible / liste cachée + bouton back
 *   - Sélection thread placeholder propage selectedKey
 *   - Bouton "back to list" reset selectedKey
 *   - Fix B3 PR #440 : demo buttons cachés en NODE_ENV=production
 *   - Fix L11 PR #440 : userId retiré des placeholders props
 *   - Fix CR M5 PR #440 : userId retiré du context placeholder
 *   - Fix A11y M2 PR #440 : aria-current="location" pour item sélectionné
 *   - Fix H5 PR #440 : aside aria-labelledby vers h2 enfant (pas aria-label)
 *   - Fix H6 PR #440 : back button focus-visible classes
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
}))

describe("MessagingInbox (iter 1 foundation + round 1 fixes)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Fix B3 round 1 — `process.env.NODE_ENV` est "test" dans Vitest par
    // défaut, donc `NODE_ENV !== "production"` → demo buttons visibles. OK.
  })

  it("render 2 landmarks (aside threads + section viewer) avec aria-labels", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    // Fix H5 PR #440 — aside utilise aria-labelledby vers le h2 (single-source).
    // NVDA lit le h2 "threadListTitle" comme label du landmark.
    const aside = screen.getByRole("complementary")
    expect(aside).toBeTruthy()
    expect(aside.getAttribute("aria-labelledby")).toBe("messaging-thread-list-heading")
    const heading = screen.getByRole("heading", { level: 2 })
    expect(heading.id).toBe("messaging-thread-list-heading")
    expect(heading.textContent).toContain("threadListTitle")

    const section = screen.getByRole("region", { name: "threadViewerLabel" })
    expect(section).toBeTruthy()
  })

  it("initial state : selectedKey null → empty placeholder dans viewer", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    expect(screen.getByText("foundationPlaceholderEmpty")).toBeTruthy()
    expect(screen.queryByTestId("thread-viewer-placeholder")).toBeNull()
  })

  it("clic démo thread #1 → viewer affiche placeholder avec conversationKey", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    fireEvent.click(screen.getByText("foundationPlaceholderDemoThread#1"))
    const viewer = screen.getByTestId("thread-viewer-placeholder")
    expect(viewer.textContent).toContain("foundationPlaceholderViewer:demo-key-1")
  })

  it("Fix A11y M2 PR #440 : clic démo thread #1 → aria-current='location' (pas 'true' string)", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    const btn1 = screen.getByText("foundationPlaceholderDemoThread#1")
    fireEvent.click(btn1)
    expect(btn1.getAttribute("aria-current")).toBe("location")
    const btn2 = screen.getByText("foundationPlaceholderDemoThread#2")
    expect(btn2.getAttribute("aria-current")).toBeNull()
  })

  it("bouton 'back to list' apparaît UNIQUEMENT quand thread sélectionné", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    expect(screen.queryByRole("button", { name: "backToList" })).toBeNull()
    fireEvent.click(screen.getByText("foundationPlaceholderDemoThread#1"))
    expect(screen.getByRole("button", { name: "backToList" })).toBeTruthy()
  })

  it("clic 'back to list' reset selectedKey → viewer empty placeholder", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    fireEvent.click(screen.getByText("foundationPlaceholderDemoThread#1"))
    expect(screen.getByTestId("thread-viewer-placeholder")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "backToList" }))
    expect(screen.queryByTestId("thread-viewer-placeholder")).toBeNull()
    expect(screen.getByText("foundationPlaceholderEmpty")).toBeTruthy()
  })

  it("Fix CR M5 PR #440 : context affiché AVEC role + SANS userId", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    expect(screen.getByText("foundationContextRole:role=DOCTOR")).toBeTruthy()
    // userId 42 ne doit PAS apparaître dans le DOM (anti-énumération).
    expect(screen.queryByText(/user=42/)).toBeNull()
    expect(screen.queryByText(/#42/)).toBeNull()
  })

  it("Fix CR M5 PR #440 : NURSE role → context sans userId", () => {
    render(<MessagingInbox userId={100} userRole="NURSE" />)
    expect(screen.getByText("foundationContextRole:role=NURSE")).toBeTruthy()
    expect(screen.queryByText(/100/)).toBeNull()
  })

  it("ADMIN role → context affiché correctement", () => {
    render(<MessagingInbox userId={1} userRole="ADMIN" />)
    expect(screen.getByText("foundationContextRole:role=ADMIN")).toBeTruthy()
  })

  it("Fix H6 PR #440 : back button focus-visible ring (RTL safe)", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    fireEvent.click(screen.getByText("foundationPlaceholderDemoThread#1"))
    const back = screen.getByRole("button", { name: "backToList" })
    expect(back.className).toContain("min-h-[44px]")
    expect(back.className).toContain("focus-visible:ring-2")
    expect(back.className).toContain("focus-visible:ring-primary")
  })

  it("touch target démo threads ≥ 44px + focus-visible ring", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    const btn = screen.getByText("foundationPlaceholderDemoThread#1")
    expect(btn.className).toContain("min-h-[44px]")
    expect(btn.className).toContain("focus-visible:ring-2")
  })
})
