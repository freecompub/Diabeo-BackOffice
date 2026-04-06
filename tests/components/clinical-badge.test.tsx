/**
 * @vitest-environment jsdom
 */

/**
 * Tests for ClinicalBadge component.
 *
 * Clinical safety context: badges display pathology type and quality
 * indicators. Wrong badge type could lead to incorrect treatment decisions.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ClinicalBadge } from "@/components/diabeo"

describe("ClinicalBadge", () => {
  describe("pathology badges", () => {
    it("renders DT1 badge with correct label", () => {
      render(<ClinicalBadge type="pathology" value="DT1" />)
      expect(screen.getByText("Type 1")).toBeTruthy()
    })

    it("renders DT1 badge with correct ARIA label", () => {
      const { container } = render(<ClinicalBadge type="pathology" value="DT1" />)
      expect(container.querySelector("[aria-label='Diabete Type 1']")).toBeTruthy()
    })

    it("renders DT2 badge", () => {
      render(<ClinicalBadge type="pathology" value="DT2" />)
      expect(screen.getByText("Type 2")).toBeTruthy()
    })

    it("renders GD badge", () => {
      render(<ClinicalBadge type="pathology" value="GD" />)
      expect(screen.getByText("Gestationnel")).toBeTruthy()
    })
  })

  describe("quality badges", () => {
    it("renders excellent quality", () => {
      render(<ClinicalBadge type="quality" value="excellent" />)
      expect(screen.getByText(/Excellent/i)).toBeTruthy()
    })

    it("renders good quality", () => {
      render(<ClinicalBadge type="quality" value="good" />)
      expect(screen.getByText(/Bon/i)).toBeTruthy()
    })

    it("renders moderate quality", () => {
      render(<ClinicalBadge type="quality" value="moderate" />)
      expect(screen.getByText(/Modere/i)).toBeTruthy()
    })

    it("renders poor quality", () => {
      render(<ClinicalBadge type="quality" value="poor" />)
      expect(screen.getByText(/Insuffisant/i)).toBeTruthy()
    })
  })
})
