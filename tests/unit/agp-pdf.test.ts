/**
 * Test suite: AGP PDF generator (US-2040)
 *
 * Behavior tested:
 * - The generator returns a non-empty Uint8Array whose first bytes are the
 *   PDF magic header `%PDF-`.
 * - No PII (name/email) is required as input — only the technical patient
 *   ID and pre-computed analytics.
 *
 * Risks mitigated:
 * - Returning an empty or corrupted PDF would prevent the doctor from
 *   reviewing the clinical report. Catching the magic header is a low-cost
 *   smoke test; full visual diff is out of scope at unit level.
 */
import { describe, it, expect } from "vitest"
import { generateAgpPdf } from "@/lib/pdf/agp-report"

function buildAgp() {
  return Array.from({ length: 96 }, (_, i) => ({
    timeMinutes: i * 15,
    p10: 0.7, p25: 0.9, p50: 1.2, p75: 1.6, p90: 2.0, count: 30,
  }))
}

describe("generateAgpPdf", () => {
  it("produces a PDF byte stream with the correct magic header", async () => {
    const bytes = await generateAgpPdf({
      patientId: 42,
      period: { from: "2026-01-01T00:00:00Z", to: "2026-01-14T00:00:00Z", days: 14 },
      metrics: { averageGlucoseMgdl: 140, gmi: 6.7, coefficientOfVariation: 32.5 },
      tir: { severeHypo: 1, hypo: 3, inRange: 70, elevated: 18, hyper: 8 },
      captureRate: 88.5,
      readingCount: 3500,
      agp: buildAgp(),
    })
    expect(bytes.byteLength).toBeGreaterThan(500)
    const header = new TextDecoder().decode(bytes.subarray(0, 5))
    expect(header).toBe("%PDF-")
  })
})
