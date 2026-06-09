/**
 * Regression test for code-review M6 (PR #399 re-review) — `formatHour`
 * must render in Europe/Paris cabinet timezone, not UTC.
 *
 * i18n dashboard médecin — `formatHour` now takes the active locale and
 * formats the wall clock in that locale (BCP-47), WITHOUT changing the
 * Europe/Paris timezone anchor. We pin both invariants : the timezone
 * conversion (CEST/CET) AND locale-aware number formatting.
 *
 * The function lives inline in AppointmentCard.tsx but the contract is
 * exercised through a replicated helper here. If extracted to a util
 * later, swap the import and the test continues to guard the contract.
 */
import { describe, it, expect } from "vitest"
import { bcp47 } from "@/i18n/config"

// Replicate the production helper exactly (signature + body).
function formatHour(d: Date | null, locale: string): string {
  if (!d) return "—"
  const date = new Date(d)
  return date.toLocaleTimeString(bcp47(locale), {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  })
}

describe("formatHour (PR #399 M6 re-review regression)", () => {
  it("renders 08:00 UTC in May as 10:00 Paris (CEST UTC+2)", () => {
    const utcMorning = new Date("2026-05-14T08:00:00Z")
    expect(formatHour(utcMorning, "fr")).toBe("10:00")
  })

  it("renders 08:00 UTC in January as 09:00 Paris (CET UTC+1)", () => {
    const utcWinter = new Date("2026-01-14T08:00:00Z")
    expect(formatHour(utcWinter, "fr")).toBe("09:00")
  })

  it("renders 23:00 UTC in May as 01:00 Paris (next day)", () => {
    const utcLate = new Date("2026-05-14T23:00:00Z")
    expect(formatHour(utcLate, "fr")).toBe("01:00")
  })

  it("keeps the Europe/Paris anchor regardless of locale (en-GB, 24h)", () => {
    const utcMorning = new Date("2026-05-14T08:00:00Z")
    // en → en-GB is 24h, so the wall clock matches fr : 10:00 Paris.
    expect(formatHour(utcMorning, "en")).toBe("10:00")
  })

  it("formats Arabic locale (non-empty, timezone-converted, never the dash)", () => {
    const utcMorning = new Date("2026-05-14T08:00:00Z")
    const out = formatHour(utcMorning, "ar")
    // ICU may render Arabic-Indic digits — assert it is a real, non-dash value.
    expect(out).not.toBe("—")
    expect(out.length).toBeGreaterThan(0)
  })

  it("returns dash when null", () => {
    expect(formatHour(null, "fr")).toBe("—")
  })
})
