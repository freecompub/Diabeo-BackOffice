/**
 * Test suite: CSV cell escaping (US-2098, defense-in-depth)
 *
 * Imports the production `csvCell` from `src/lib/csv/cell.ts` so any future
 * change to the escape rules is exercised by these tests — no local re-impl.
 */
import { describe, it, expect } from "vitest"
import { csvCell } from "@/lib/csv/cell"

describe("csvCell formula-injection protection", () => {
  it("prefixes leading = with apostrophe + quotes the result", () => {
    // Cell starts with `=` (needs `'` prefix) AND contains `"` (needs quoting).
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe(
      '"\'=HYPERLINK(""http://evil"")"',
    )
  })

  it.each([
    ["+1+1", "'+1+1"],
    ["-2+2", "'-2+2"],
    ["@SUM(A1)", "'@SUM(A1)"],
  ])("prefixes %s with apostrophe (no quotes needed)", (input, expected) => {
    expect(csvCell(input)).toBe(expected)
  })

  it("prefixes tab-led cells with apostrophe (tab does not force quoting)", () => {
    expect(csvCell("\t=cmd")).toBe("'\t=cmd")
  })

  it("prefixes CR-led cells AND wraps them in quotes (CR triggers quote regex)", () => {
    expect(csvCell("\r=cmd")).toBe('"\'\r=cmd"')
  })

  it("leaves benign cells untouched", () => {
    expect(csvCell("DT1")).toBe("DT1")
    expect(csvCell(42)).toBe("42")
    expect(csvCell(null)).toBe("")
    expect(csvCell(undefined)).toBe("")
  })

  it("quotes embedded comma / quote / newline correctly", () => {
    expect(csvCell("a,b")).toBe('"a,b"')
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""')
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"')
  })
})
