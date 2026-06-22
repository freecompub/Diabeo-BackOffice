/**
 * Test suite: dashboard greeting name formatting (buildGreetingName)
 *
 * Behavior tested:
 * - Honorific ("Dr", "Mme"…) prefixed only for fr/en (FR label) — never for ar,
 *   to avoid a Latin honorific inside a translated/RTL greeting.
 * - Falls back to firstname when lastname is absent, then null (caller shows
 *   the date alone).
 *
 * Risk: a wrong locale gate would render "Dr Martin" (Latin) inside an Arabic
 * greeting, or drop the honorific in French — both degrade the UI politeness
 * and consistency.
 */
import { describe, it, expect } from "vitest"
import { buildGreetingName } from "@/components/diabeo/dashboard/greeting-name"

describe("buildGreetingName", () => {
  const martin = { title: "Dr", firstname: "Camille", lastname: "Martin" }

  it("prefixes the honorific in French", () => {
    expect(buildGreetingName(martin, "fr")).toBe("Dr Martin")
  })

  it("prefixes the honorific in English", () => {
    expect(buildGreetingName(martin, "en")).toBe("Dr Martin")
  })

  it("omits the (Latin) honorific in Arabic — bare name", () => {
    expect(buildGreetingName(martin, "ar")).toBe("Martin")
  })

  it("uses the lastname alone when there is no title", () => {
    expect(
      buildGreetingName({ title: null, firstname: "Camille", lastname: "Martin" }, "fr"),
    ).toBe("Martin")
  })

  it("falls back to the firstname when the lastname is missing", () => {
    expect(
      buildGreetingName({ title: "Dr", firstname: "Camille", lastname: null }, "fr"),
    ).toBe("Camille")
  })

  it("returns null when the name is null (caller renders the date alone)", () => {
    expect(buildGreetingName(null, "fr")).toBeNull()
  })

  it("returns null when all name parts are empty", () => {
    expect(
      buildGreetingName({ title: null, firstname: null, lastname: null }, "fr"),
    ).toBeNull()
  })
})
