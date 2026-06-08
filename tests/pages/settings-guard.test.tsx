/**
 * @vitest-environment node
 */

/**
 * Tests for the /settings Server Component fail-closed role guard (#511 review M2).
 *
 * Security context:
 * - /settings was moved out of the `(dashboard)` route group (which bounces
 *   VIEWER) to a root-level route accepting all authenticated roles.
 * - The whole point of the move is to RELAX the role gate, so the fail-closed
 *   path (absent / invalid `x-user-role` → redirect to /login, never default a
 *   role) is exactly what a future refactor could silently break.
 * - This test pins that behavior: missing or bogus role MUST redirect, a valid
 *   role MUST render SettingsClient with that exact role (no `as` cast, no default).
 *
 * @see src/app/settings/page.tsx
 * @see src/lib/auth/role-home.ts (isKnownRoleString)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// redirect() in Next halts execution by throwing — mirror that so the page
// stops at the guard instead of falling through to the render.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectUrl: url })
  }),
}))

let roleHeader: string | null = null
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (k: string) => (k === "x-user-role" ? roleHeader : null),
  })),
}))

// Stub the heavy client form so importing the page doesn't pull the 1.4k-line
// component. It returns a sentinel element whose props we can assert on.
vi.mock("@/app/settings/SettingsClient", () => ({
  SettingsClient: (props: { role: string }) => ({ __stub: "SettingsClient", props }),
}))

import SettingsPage from "@/app/settings/page"
import { redirect } from "next/navigation"

beforeEach(() => {
  vi.clearAllMocks()
  roleHeader = null
})

describe("/settings page — fail-closed role guard", () => {
  it("redirects to /login when x-user-role is absent", async () => {
    roleHeader = null
    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/login")
  })

  it("redirects to /login when x-user-role is an unknown value", async () => {
    roleHeader = "SUPERADMIN"
    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/login")
  })

  it.each(["VIEWER", "NURSE", "DOCTOR", "ADMIN"])(
    "renders SettingsClient with the validated role %s",
    async (role) => {
      roleHeader = role
      const el = (await SettingsPage()) as { props: { role: string } }
      expect(redirect).not.toHaveBeenCalled()
      // The page returns <SettingsClient role={role} />; assert the prop is the
      // exact validated header value (no default, no cast).
      expect(el.props.role).toBe(role)
    },
  )
})
