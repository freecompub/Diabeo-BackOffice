/**
 * Test suite: shell display-name formatting (formatShellName)
 *
 * Behavior tested:
 * - "firstname lastname" for the shell avatar/dropdown (drives initials),
 *   empty/null parts dropped, no honorific.
 * - undefined when nothing usable → the shell falls back to default initials
 *   instead of rendering a blank/“U” for an empty string.
 *
 * Note: `prisma-mock` is imported first so that loading
 * `@/lib/auth/current-user-name` (which transitively pulls userService →
 * Prisma) is safe; `formatShellName` itself is pure and touches neither.
 */
import { describe, it, expect } from "vitest"
import "../helpers/prisma-mock"
import { formatShellName } from "@/lib/auth/current-user-name"

describe("formatShellName", () => {
  it("joins firstname and lastname", () => {
    expect(
      formatShellName({ title: "Dr", firstname: "Camille", lastname: "Martin" }),
    ).toBe("Camille Martin")
  })

  it("ignores the honorific (unlike the greeting)", () => {
    const out = formatShellName({ title: "Dr", firstname: "Camille", lastname: "Martin" })
    expect(out).not.toContain("Dr")
  })

  it("uses lastname alone when firstname is missing", () => {
    expect(
      formatShellName({ title: null, firstname: null, lastname: "Martin" }),
    ).toBe("Martin")
  })

  it("uses firstname alone when lastname is missing", () => {
    expect(
      formatShellName({ title: null, firstname: "Camille", lastname: null }),
    ).toBe("Camille")
  })

  it("returns undefined when both parts are empty (shell shows default initials)", () => {
    expect(
      formatShellName({ title: "Dr", firstname: null, lastname: null }),
    ).toBeUndefined()
  })

  it("returns undefined for a null lookup result", () => {
    expect(formatShellName(null)).toBeUndefined()
  })
})
