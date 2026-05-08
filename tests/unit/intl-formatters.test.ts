/**
 * Test suite : US-2115 — Helpers Intl FR / EN / AR.
 *
 * Behavior tested :
 *  - Date format style + locale-correct separators
 *  - Number format with locale separators
 *  - Currency uses correct symbol per locale
 *  - Glucose conversion mg/dL ↔ g/L ↔ mmol/L precision
 *  - Insulin / carbs formatting
 *  - Arabic numbering systems (latn vs arab)
 *  - Relative time auto-unit selection
 *
 * Risks mitigated :
 *  - Wrong unit shown to clinician (e.g. mg/dL displayed as mmol/L)
 *  - Number drift across components (1234.5 vs 1 234,5 vs 1,234.5)
 *  - Empty/NaN rendering catastrophes (NaN as visible "NaN")
 */
import { describe, it, expect } from "vitest"
import {
  formatDate,
  formatTime,
  formatRelativeTime,
  formatNumber,
  formatPercent,
  formatCurrency,
  formatGlucose,
  formatInsulinUnits,
  formatCarbs,
} from "@/lib/intl/formatters"

describe("formatDate", () => {
  const date = new Date("2026-03-15T10:30:00Z")

  it("FR uses '15 mars 2026' format", () => {
    const out = formatDate(date, "fr")
    expect(out).toContain("2026")
    expect(out.toLowerCase()).toContain("mars")
  })

  it("EN uses 'Mar 15, 2026' or '15 Mar 2026' style", () => {
    const out = formatDate(date, "en")
    expect(out).toContain("2026")
    expect(out).toMatch(/Mar/i)
  })

  it("AR returns a date string (Arabic month name)", () => {
    const out = formatDate(date, "ar")
    expect(out).toContain("2026")
    // Arabic month name for March is "مارس" or similar
    expect(out.length).toBeGreaterThan(5)
  })

  it("returns empty for invalid date", () => {
    expect(formatDate("not-a-date", "fr")).toBe("")
    expect(formatDate(NaN, "fr")).toBe("")
  })

  it("withTime appends time", () => {
    const out = formatDate(date, "fr", { withTime: true })
    expect(out).toMatch(/\d{2}:\d{2}/)
  })

  it("AR with useArabicDigits=false uses latn digits", () => {
    const out = formatDate(date, "ar", { useArabicDigits: false })
    expect(out).toContain("2026") // latin "2026" not "٢٠٢٦"
  })
})

describe("formatTime", () => {
  it("formats HH:mm in FR", () => {
    const date = new Date("2026-03-15T14:45:00Z")
    expect(formatTime(date, "fr")).toMatch(/14:45/)
  })

  it("returns empty for invalid", () => {
    expect(formatTime("bad", "fr")).toBe("")
  })
})

describe("formatRelativeTime", () => {
  it("renders 'il y a' for past in FR", () => {
    const past = new Date(Date.now() - 5 * 60_000)
    const out = formatRelativeTime(past, "fr")
    // expected like "il y a 5 minutes"
    expect(out.toLowerCase()).toContain("il y a")
  })

  it("renders 'ago' for past in EN", () => {
    const past = new Date(Date.now() - 60 * 60_000)
    const out = formatRelativeTime(past, "en")
    expect(out.toLowerCase()).toContain("ago")
  })

  it("auto-selects unit (seconds < 1min)", () => {
    const past = new Date(Date.now() - 30_000)
    const out = formatRelativeTime(past, "fr", { baseDate: new Date() })
    expect(out.toLowerCase()).toMatch(/seconde|maintenant|ago/i)
  })

  it("auto-selects year for >1y", () => {
    const past = new Date(Date.now() - 400 * 86_400_000)
    const out = formatRelativeTime(past, "en")
    expect(out.toLowerCase()).toMatch(/year|an/i)
  })
})

describe("formatNumber", () => {
  it("FR uses comma decimal + space thousand separator", () => {
    const out = formatNumber(1234.56, "fr", { decimals: 2 })
    expect(out).toContain(",") // comma decimal
    // space (or NNBSP) between thousands
    expect(out.replace(/[\s  ]/g, "")).toBe("1234,56")
  })

  it("EN uses dot decimal + comma thousand separator", () => {
    const out = formatNumber(1234.56, "en", { decimals: 2 })
    expect(out).toBe("1,234.56")
  })

  it("returns empty for NaN/Infinity", () => {
    expect(formatNumber(NaN, "fr")).toBe("")
    expect(formatNumber(Infinity, "fr")).toBe("")
  })

  it("AR with useArabicDigits=false uses latn digits (no arab-indic ٠-٩)", () => {
    const out = formatNumber(1234, "ar", { useArabicDigits: false })
    // ar-MA latn separator may be "." or " " — assert digits are latin 0-9
    expect(out).toMatch(/[0-9]/)
    expect(out).not.toMatch(/[٠-٩]/)
  })

  it("AR with useArabicDigits=true uses arab digits", () => {
    const out = formatNumber(1234, "ar", { useArabicDigits: true })
    // Arab-Indic digits ٠١٢٣٤٥٦٧٨٩
    expect(out).toMatch(/[٠-٩]/)
  })
})

describe("formatPercent", () => {
  it("FR: 0.75 → '75 %'", () => {
    const out = formatPercent(0.75, "fr")
    expect(out).toMatch(/75/)
    expect(out).toContain("%")
  })
})

describe("formatCurrency", () => {
  it("FR EUR uses € symbol", () => {
    const out = formatCurrency(99.5, "fr")
    expect(out).toContain("€")
  })

  it("custom currency override works", () => {
    const out = formatCurrency(100, "en", { currency: "USD" })
    expect(out).toContain("$")
  })
})

describe("formatGlucose", () => {
  it("converts mg/dL to g/L (FR)", () => {
    // 127 mg/dL = 1.27 g/L
    const out = formatGlucose(127, "fr", "gl")
    expect(out).toContain("g/L")
    expect(out).toMatch(/1[,.]27/)
  })

  it("keeps mg/dL as integer", () => {
    const out = formatGlucose(127, "en", "mgdl")
    expect(out).toBe("127 mg/dL")
  })

  it("converts mg/dL to mmol/L (1 decimal)", () => {
    // 127 mg/dL ≈ 7.05 mmol/L → rounded to 7.0 or 7.1
    const out = formatGlucose(127, "en", "mmoll")
    expect(out).toContain("mmol/L")
    expect(out).toMatch(/7\.[01]/)
  })

  it("returns empty for invalid", () => {
    expect(formatGlucose(NaN, "fr", "gl")).toBe("")
  })
})

describe("formatInsulinUnits", () => {
  it("appends 'U' with 1 decimal", () => {
    const out = formatInsulinUnits(5.5, "fr")
    expect(out).toBe("5,5 U")
  })
})

describe("formatCarbs", () => {
  it("appends 'g' with 0 decimal", () => {
    const out = formatCarbs(45, "en")
    expect(out).toBe("45 g")
  })
})
