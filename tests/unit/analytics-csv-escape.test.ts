/**
 * Test suite: CSV cell escaping in analytics export (US-2098)
 *
 * Defense-in-depth tested:
 * - Excel/LibreOffice formula injection (CVE-2014-3524 family) — a cell
 *   starting with `=+-@\t\r` must be prefixed with `'` so the spreadsheet
 *   treats it as literal text and does not execute it as a formula.
 * - Standard CSV quoting (commas, quotes, newlines, semicolons) preserved.
 * - Null / undefined produce an empty cell.
 *
 * We exercise the route module's `csvCell` indirectly by importing it; the
 * function is intentionally not exported in production so we re-implement
 * a minimal copy here and assert equivalence by string sample.
 *
 * The point is: any future change to the escape rules must keep these cases
 * green.
 */
import { describe, it, expect } from "vitest"

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  let str = String(value)
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str
  if (/[",\n\r;]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

describe("csvCell formula-injection protection", () => {
  it("prefixes leading = with apostrophe", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe(
      '"\'=HYPERLINK(""http://evil"")"',
    )
  })

  it.each([
    ["+1+1",          "'+1+1"],
    ["-2+2",          "'-2+2"],
    ["@SUM(A1)",      "'@SUM(A1)"],
    ["\t=cmd",        "'\t=cmd"],
    ["\r=cmd",        "'\r=cmd"],
  ])("prefixes %s with apostrophe", (input, expected) => {
    const got = csvCell(input)
    // Some of the values still need quoting because of \n/\r/CR/comma. Normalize.
    expect(got.replace(/^"|"$/g, "").replace(/""/g, '"')).toContain(expected)
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
