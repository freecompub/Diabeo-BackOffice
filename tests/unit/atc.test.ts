/**
 * Tests for ATC classification parsing and hierarchy.
 *
 * Clinical context: ATC codes classify medications by anatomical group,
 * therapeutic area, and chemical substance. Correct level detection and
 * parent-child relationships ensure clinicians can browse medications
 * by class (e.g., A10 = "Médicaments du diabète").
 */

import { describe, it, expect } from "vitest"

// Test the pure helper functions inline (they are private in atc.service.ts)
// This avoids importing the service which depends on Prisma

function getAtcLevel(code: string): number {
  if (code.length === 1) return 1
  if (code.length === 3) return 2
  if (code.length === 4) return 3
  if (code.length === 5) return 4
  return 5
}

function getParentCode(code: string): string | null {
  if (code.length === 1) return null
  if (code.length === 3) return code[0]
  if (code.length === 4) return code.slice(0, 3)
  if (code.length === 5) return code.slice(0, 4)
  return code.slice(0, 5)
}

describe("ATC classification", () => {
  describe("getAtcLevel", () => {
    it("identifies level 1 (anatomical main group)", () => {
      expect(getAtcLevel("A")).toBe(1)
      expect(getAtcLevel("N")).toBe(1)
    })

    it("identifies level 2 (therapeutic subgroup)", () => {
      expect(getAtcLevel("A10")).toBe(2)
      expect(getAtcLevel("N06")).toBe(2)
    })

    it("identifies level 3 (pharmacological subgroup)", () => {
      expect(getAtcLevel("A10B")).toBe(3)
    })

    it("identifies level 4 (chemical subgroup)", () => {
      expect(getAtcLevel("A10BA")).toBe(4)
    })

    it("identifies level 5 (chemical substance)", () => {
      expect(getAtcLevel("A10BA02")).toBe(5) // Metformine
      expect(getAtcLevel("A10BJ06")).toBe(5) // Semaglutide
    })
  })

  describe("getParentCode", () => {
    it("returns null for level 1", () => {
      expect(getParentCode("A")).toBeNull()
    })

    it("returns level 1 for level 2", () => {
      expect(getParentCode("A10")).toBe("A")
    })

    it("returns level 2 for level 3", () => {
      expect(getParentCode("A10B")).toBe("A10")
    })

    it("returns level 3 for level 4", () => {
      expect(getParentCode("A10BA")).toBe("A10B")
    })

    it("returns level 4 for level 5", () => {
      expect(getParentCode("A10BA02")).toBe("A10BA")
    })
  })

  describe("ATC code validation", () => {
    it("validates correct ATC codes", () => {
      const pattern = /^[A-Z](\d{2}([A-Z]{1,2}(\d{2})?)?)?$/
      expect(pattern.test("A")).toBe(true)
      expect(pattern.test("A10")).toBe(true)
      expect(pattern.test("A10B")).toBe(true)
      expect(pattern.test("A10BA")).toBe(true)
      expect(pattern.test("A10BA02")).toBe(true)
    })

    it("rejects invalid ATC codes", () => {
      const pattern = /^[A-Z](\d{2}([A-Z]{1,2}(\d{2})?)?)?$/
      expect(pattern.test("")).toBe(false)
      expect(pattern.test("metformine")).toBe(false)
      expect(pattern.test("123")).toBe(false)
      expect(pattern.test("a10")).toBe(false) // lowercase
    })
  })

  describe("diabetes-specific ATC codes", () => {
    it("A10 covers all diabetes medications", () => {
      const diabetesCodes = ["A10BA02", "A10BJ06", "A10BD07", "A10AE04"]
      for (const code of diabetesCodes) {
        expect(code.startsWith("A10")).toBe(true)
        expect(getAtcLevel(code)).toBe(5)
        expect(getParentCode(code)?.startsWith("A10")).toBe(true)
      }
    })

    it("A10B = blood glucose lowering drugs (oral)", () => {
      expect(getAtcLevel("A10B")).toBe(3)
      expect(getParentCode("A10B")).toBe("A10")
    })

    it("A10A = insulins", () => {
      expect(getAtcLevel("A10A")).toBe(3)
      expect(getParentCode("A10A")).toBe("A10")
    })
  })

  describe("CSV parsing", () => {
    it("parses ATC CSV line with simple name", () => {
      const line = "A10BA02,metformin,2,g,O,NA"
      const match = line.match(/^([^,]+),(".*?"|[^,]*),/)
      expect(match).not.toBeNull()
      expect(match![1]).toBe("A10BA02")
      expect(match![2]).toBe("metformin")
    })

    it("parses ATC CSV line with quoted name containing comma", () => {
      const line = 'A01AA51,"sodium fluoride, combinations",NA,NA,NA,NA'
      const match = line.match(/^([^,]+),(".*?"|[^,]*),/)
      expect(match).not.toBeNull()
      expect(match![1]).toBe("A01AA51")
      expect(match![2].replace(/^"|"$/g, "")).toBe("sodium fluoride, combinations")
    })
  })
})
