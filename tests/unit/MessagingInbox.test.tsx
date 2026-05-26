/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour `MessagingInbox` (US-2076-UI iter 1 foundation).
 *
 * Couvre la structure layout 2-col responsive + placeholders + nav mobile :
 *   - Render 2 landmarks (aside threads + section viewer)
 *   - Mobile : selectedKey=null → liste visible / viewer caché
 *   - Mobile : selectedKey set → viewer visible / liste cachée + bouton back
 *   - Sélection thread placeholder propage selectedKey
 *   - Bouton "back to list" reset selectedKey
 *   - aria-label landmarks i18n
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MessagingInbox } from "@/components/diabeo/messaging/MessagingInbox"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => {
    if (v && "id" in v) return `${k}#${v.id}`
    if (v && "key" in v) return `${k}:${v.key}`
    if (v && "userId" in v) return `${k}:user=${v.userId}/role=${v.role}`
    return k
  },
}))

describe("MessagingInbox (iter 1 foundation)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("render 2 landmarks (aside threads + section viewer) avec aria-labels", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    const aside = screen.getByRole("complementary", { name: "threadListLabel" })
    expect(aside).toBeTruthy()
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

  it("clic démo thread #1 → aria-current=true sur button thread #1", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    const btn1 = screen.getByText("foundationPlaceholderDemoThread#1")
    fireEvent.click(btn1)
    expect(btn1.getAttribute("aria-current")).toBe("true")
    const btn2 = screen.getByText("foundationPlaceholderDemoThread#2")
    expect(btn2.getAttribute("aria-current")).toBeNull()
  })

  it("bouton 'back to list' apparaît UNIQUEMENT quand thread sélectionné (mobile)", () => {
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

  it("context user affiché dans placeholder list (userId + role)", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    expect(screen.getByText("foundationContextUser:user=42/role=DOCTOR")).toBeTruthy()
  })

  it("NURSE role → context affiché correctement", () => {
    render(<MessagingInbox userId={100} userRole="NURSE" />)
    expect(screen.getByText("foundationContextUser:user=100/role=NURSE")).toBeTruthy()
  })

  it("ADMIN role → context affiché correctement", () => {
    render(<MessagingInbox userId={1} userRole="ADMIN" />)
    expect(screen.getByText("foundationContextUser:user=1/role=ADMIN")).toBeTruthy()
  })

  it("touch target back-button ≥ 44px (WCAG 2.5.5)", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    fireEvent.click(screen.getByText("foundationPlaceholderDemoThread#1"))
    const back = screen.getByRole("button", { name: "backToList" })
    expect(back.className).toContain("min-h-[44px]")
  })

  it("touch target démo threads ≥ 44px", () => {
    render(<MessagingInbox userId={42} userRole="DOCTOR" />)
    const btn = screen.getByText("foundationPlaceholderDemoThread#1")
    expect(btn.className).toContain("min-h-[44px]")
  })
})
