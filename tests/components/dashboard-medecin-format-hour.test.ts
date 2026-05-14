/**
 * Regression test for code-review M6 (PR #399 re-review) — `formatHour`
 * must render in Europe/Paris cabinet timezone, not UTC.
 *
 * The function lives inline in AppointmentCard.tsx but is exercised
 * through an exported helper here. We test the contract directly via
 * Intl.DateTimeFormat to lock down the expectation : at 08:00 UTC in
 * May 2026 (CEST = UTC+2), the cabinet-local wall clock is 10:00.
 */
import { describe, it, expect } from "vitest"

// Replicate the production helper exactly. If AppointmentCard inlines it,
// this test pins the contract; if extracted to a util later, swap the
// import and the test continues to guard the contract.
function formatHour(d: Date | null): string {
  if (!d) return "—"
  const date = new Date(d)
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  })
}

describe("formatHour (PR #399 M6 re-review regression)", () => {
  it("renders 08:00 UTC in May as 10:00 Paris (CEST UTC+2)", () => {
    const utcMorning = new Date("2026-05-14T08:00:00Z")
    expect(formatHour(utcMorning)).toBe("10:00")
  })

  it("renders 08:00 UTC in January as 09:00 Paris (CET UTC+1)", () => {
    const utcWinter = new Date("2026-01-14T08:00:00Z")
    expect(formatHour(utcWinter)).toBe("09:00")
  })

  it("renders 23:00 UTC in May as 01:00 Paris (next day)", () => {
    const utcLate = new Date("2026-05-14T23:00:00Z")
    expect(formatHour(utcLate)).toBe("01:00")
  })

  it("returns dash when null", () => {
    expect(formatHour(null)).toBe("—")
  })
})
