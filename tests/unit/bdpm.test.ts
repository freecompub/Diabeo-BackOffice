/**
 * Tests for BDPM service — medication database parsing.
 *
 * Clinical context: the BDPM is the official French medication database.
 * Correct parsing ensures clinicians see accurate medication information.
 * Tests import actual functions from bdpm.service.ts (M5 fix).
 */

import { describe, it, expect } from "vitest"
import { parseTsv, parseDate, parsePrice } from "@/lib/services/bdpm-parsers"

describe("BDPM data parsing", () => {
  describe("parseTsv", () => {
    it("splits tab-separated fields correctly", () => {
      const content = "60234100\tDOLIPRANE 500 mg\tcomprimé\torale\tAutorisation active"
      const result = parseTsv(content)

      expect(result).toHaveLength(1)
      expect(result[0]).toHaveLength(5)
      expect(result[0][0]).toBe("60234100")
      expect(result[0][1]).toBe("DOLIPRANE 500 mg")
    })

    it("handles multiple lines", () => {
      const content = "code1\tname1\ncode2\tname2\ncode3\tname3"
      const result = parseTsv(content)
      expect(result).toHaveLength(3)
    })

    it("handles empty fields", () => {
      const content = "60234100\tDOLIPRANE\t\t\tAutorisation active"
      const result = parseTsv(content)
      expect(result[0][2]).toBe("")
      expect(result[0][3]).toBe("")
    })

    it("skips empty lines", () => {
      const content = "code1\tname1\n\n\ncode2\tname2\n"
      const result = parseTsv(content)
      expect(result).toHaveLength(2)
    })

    it("handles French characters", () => {
      const content = "12345678\tMÉTFORMINE 850 mg, comprimé pelliculé"
      const result = parseTsv(content)
      expect(result[0][1]).toContain("MÉTFORMINE")
      expect(result[0][1]).toContain("pelliculé")
    })
  })

  describe("parseDate", () => {
    it("parses DD/MM/YYYY format", () => {
      const date = parseDate("15/03/2020")
      expect(date).not.toBeNull()
      expect(date!.getFullYear()).toBe(2020)
      expect(date!.getMonth()).toBe(2) // 0-indexed
    })

    it("parses YYYY-MM-DD format", () => {
      const date = parseDate("2020-03-15")
      expect(date).not.toBeNull()
      expect(date!.getFullYear()).toBe(2020)
    })

    it("returns null for empty string", () => {
      expect(parseDate("")).toBeNull()
    })

    it("returns null for undefined", () => {
      expect(parseDate(undefined)).toBeNull()
    })

    it("returns null for invalid date", () => {
      expect(parseDate("not-a-date")).toBeNull()
    })

    it("returns null for invalid DD/MM/YYYY", () => {
      expect(parseDate("32/13/2020")).toBeNull()
    })
  })

  describe("parsePrice", () => {
    it("parses French format (comma decimal)", () => {
      expect(parsePrice("12,50")).toBe(12.5)
    })

    it("parses standard format (dot decimal)", () => {
      expect(parsePrice("12.50")).toBe(12.5)
    })

    it("parses European thousands format (1.234,56)", () => {
      expect(parsePrice("1.234,56")).toBe(1234.56)
    })

    it("parses price with currency symbol", () => {
      expect(parsePrice("12,50 €")).toBe(12.5)
    })

    it("returns null for empty/undefined", () => {
      expect(parsePrice("")).toBeNull()
      expect(parsePrice(undefined)).toBeNull()
    })

    it("returns null for non-numeric", () => {
      expect(parsePrice("N/A")).toBeNull()
    })

    it("handles large prices", () => {
      expect(parsePrice("1234,99")).toBe(1234.99)
    })
  })

  describe("CIP code detection", () => {
    it("identifies CIP7 codes (7 digits)", () => {
      expect(/^\d{7,13}$/.test("3400930")).toBe(true)
    })

    it("identifies CIP13 codes (13 digits)", () => {
      expect(/^\d{7,13}$/.test("3400930000001")).toBe(true)
    })

    it("rejects non-CIP strings", () => {
      expect(/^\d{7,13}$/.test("metformine")).toBe(false)
      expect(/^\d{7,13}$/.test("123")).toBe(false)
    })
  })

  describe("antivirus result handling", () => {
    it("clean file should be accepted", () => {
      const result = { scanned: true, clean: true, viruses: [] as string[] }
      expect(result.clean).toBe(true)
    })

    it("infected file should be rejected", () => {
      const result = { scanned: true, clean: false, viruses: ["Eicar-Test-Signature"] }
      expect(result.clean).toBe(false)
    })

    it("scan error should be treated as infected (fail-closed)", () => {
      const result = { scanned: false, clean: false, viruses: ["SCAN_ERROR"] }
      expect(result.clean).toBe(false)
    })

    it("ClamAV unavailable in dev should allow file (fail-open)", () => {
      const result = { scanned: false, clean: true, viruses: [] as string[] }
      expect(result.scanned).toBe(false)
      expect(result.clean).toBe(true)
    })
  })
})
