/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le composant `<MemberFilter>` (stateless display).
 *
 * Fix M-8 round 2 review PR #432 — couvre les 3 branches conditionnelles
 * (0/1/≥2 memberships) + loading + error + a11y.
 *
 * Le composant est devenu stateless (fix CR-1/H-4 round 2) : items,
 * loading, error sont fournis par le parent via props (pas de hook
 * propre, plus de useEffect mutant le state parent).
 *
 * Pattern projet : mock direct `next-intl` (cf. tests/pages/patient-dashboard.test.tsx).
 * `t(key)` retourne `key` — on assert sur les clés i18n.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"

// Mock next-intl avant import du composant (pattern projet).
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}))

const { MemberFilter } = await import("@/components/diabeo/appointments/MemberFilter")
import type { Membership } from "@/components/diabeo/appointments/useMyMemberships"

function renderFilter(props: Parameters<typeof MemberFilter>[0]) {
  return render(<MemberFilter {...props} />)
}

const membership1: Membership = {
  memberId: 1,
  memberName: "Dr Sophie Martin",
  serviceId: 1,
  serviceName: "Service Diabetologie",
  establishment: "CHU Paris Test",
}

const membership2: Membership = {
  memberId: 2,
  memberName: "Marie Dupont (IDE)",
  serviceId: 1,
  serviceName: "Service Diabetologie",
  establishment: "CHU Paris Test",
}

describe("<MemberFilter>", () => {
  const onMemberChange = vi.fn()
  const onRetry = vi.fn()

  beforeEach(() => {
    onMemberChange.mockClear()
    onRetry.mockClear()
  })

  describe("loading state", () => {
    it("affiche skeleton avec role=status + aria-busy + aria-live (M-7 a11y)", () => {
      const { container } = renderFilter({
        items: [],
        loading: true,
        error: null,
        value: null,
        onMemberChange,
      })
      const skeleton = container.querySelector("[role='status']")
      expect(skeleton).not.toBeNull()
      expect(skeleton!.getAttribute("aria-busy")).toBe("true")
      expect(skeleton!.getAttribute("aria-live")).toBe("polite")
      // i18n key "loading" — `t(k) => k` mock.
      expect(skeleton!.getAttribute("aria-label")).toBe("loading")
    })

    it("PAS de callback fire pendant loading", () => {
      renderFilter({
        items: [],
        loading: true,
        error: null,
        value: null,
        onMemberChange,
      })
      expect(onMemberChange).not.toHaveBeenCalled()
    })
  })

  describe("error state", () => {
    it("affiche message d'erreur avec role=alert", () => {
      const { container } = renderFilter({
        items: [],
        loading: false,
        error: "networkError",
        value: null,
        onMemberChange,
      })
      const alert = container.querySelector("[role='alert']")
      expect(alert).not.toBeNull()
      expect(alert!.textContent).toContain("memberFilterError")
    })

    it("affiche bouton 'Réessayer' (M-11) si onRetry fourni + click fire callback", () => {
      const { container } = renderFilter({
        items: [],
        loading: false,
        error: "serverError",
        value: null,
        onMemberChange,
        onRetry,
      })
      const btn = container.querySelector("button") as HTMLButtonElement | null
      expect(btn).not.toBeNull()
      expect(btn!.textContent).toContain("retry")
      btn!.click()
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it("PAS de bouton 'Réessayer' si onRetry absent (prop optional)", () => {
      const { container } = renderFilter({
        items: [],
        loading: false,
        error: "serverError",
        value: null,
        onMemberChange,
      })
      expect(container.querySelector("button")).toBeNull()
    })
  })

  describe("0 memberships", () => {
    it("affiche message 'noMembership' (pas de dropdown)", () => {
      const { container } = renderFilter({
        items: [],
        loading: false,
        error: null,
        value: null,
        onMemberChange,
      })
      expect(container.textContent).toContain("noMembership")
      // Pas de Select trigger (Base UI rend un button).
      expect(container.querySelector("button")).toBeNull()
    })

    it("PAS de callback fire (auto-select logic déplacée au parent H-4)", () => {
      renderFilter({
        items: [],
        loading: false,
        error: null,
        value: null,
        onMemberChange,
      })
      expect(onMemberChange).not.toHaveBeenCalled()
    })
  })

  describe("1 membership", () => {
    it("affiche label statique 'Dr X · Service Y' (pas de dropdown)", () => {
      const { container } = renderFilter({
        items: [membership1],
        loading: false,
        error: null,
        value: 1,
        onMemberChange,
      })
      expect(container.textContent).toContain("Dr Sophie Martin")
      expect(container.textContent).toContain("Service Diabetologie")
      // Pas de Select trigger.
      expect(container.querySelector("button")).toBeNull()
    })

    it("Fix H-4 round 2 — PAS de callback fire (lift state up au parent)", () => {
      renderFilter({
        items: [membership1],
        loading: false,
        error: null,
        value: null,
        onMemberChange,
      })
      // Avant fix H-4, un useEffect interne aurait fire onMemberChange.
      // Après fix : auto-resolve est dans le parent, le composant est
      // pur display. Aucun side-effect.
      expect(onMemberChange).not.toHaveBeenCalled()
    })
  })

  describe("≥ 2 memberships (cas défensif US-2118)", () => {
    it("affiche dropdown trigger + label visible", () => {
      const { container } = renderFilter({
        items: [membership1, membership2],
        loading: false,
        error: null,
        value: 1,
        onMemberChange,
      })
      expect(container.textContent).toContain("memberLabel")
      // Base UI Select trigger = <button id="member-filter">
      const trigger = container.querySelector("#member-filter")
      expect(trigger).not.toBeNull()
    })

    it("aria-labelledby pointe vers le label parent (M-7 a11y)", () => {
      const { container } = renderFilter({
        items: [membership1, membership2],
        loading: false,
        error: null,
        value: null,
        onMemberChange,
      })
      const trigger = container.querySelector("#member-filter")
      expect(trigger).not.toBeNull()
      expect(trigger!.getAttribute("aria-labelledby")).toBe("member-filter-label")
    })

    it("label DOM porte id='member-filter-label' (cible aria-labelledby)", () => {
      const { container } = renderFilter({
        items: [membership1, membership2],
        loading: false,
        error: null,
        value: null,
        onMemberChange,
      })
      const label = container.querySelector("#member-filter-label")
      expect(label).not.toBeNull()
      expect(label!.tagName.toLowerCase()).toBe("label")
    })
  })
})
