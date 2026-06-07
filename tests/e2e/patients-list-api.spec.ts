import { test, expect } from "@playwright/test"
import { loginAs } from "./helpers/auth"

/**
 * E2E tests for `/patients` — patient list page connected to real backend API.
 *
 * These tests verify that the page fetches patient data from the API
 * instead of using hardcoded DEMO_PATIENTS data.
 *
 * Prerequisites: The test database must be seeded with the standard
 * seed data (see prisma/seed.ts).
 */
test.describe("Patients list — /patients (real API connection)", () => {
  test("DOCTOR → sees seeded patients from API", async ({
    page,
    context,
    request,
  }) => {
    // Log in as a doctor (can see all patients in their service)
    await loginAs(context, request, "doctor")
    await page.goto("/patients")

    // Wait for data to load from API
    // We expect to see the seeded patients from the database
    const rows = page.locator("table tbody tr")

    // Wait for the table to have rows (we'll check for at least 5 seeded patients)
    await expect(rows).toHaveCount(5, { timeout: 10_000 })

    // Verify specific seeded patient names are present
    await expect(page.getByText("Patient DT1-001")).toBeVisible() // Jean Durand
    await expect(page.getByText("Patient DT2-002")).toBeVisible() // Claire Bernard
    await expect(page.getByText("Patient DT1-003")).toBeVisible() // Lucas Petit (first extra DT1)
    await expect(page.getByText("Patient DT2-006")).toBeVisible() // Hélène Moreau (first extra DT2)
    await expect(page.getByText("Patient GD-005")).toBeVisible() // Amélie Rousseau

    // Verify pathology badges are present for each type
    await expect(page.getByText("Type 1").first()).toBeVisible() // DT1 badge
    await expect(page.getByText("Type 2").first()).toBeVisible() // DT2 badge
    await expect(page.getByText("Gestationnel").first()).toBeVisible() // GD badge
  })

  test("NURSE → sees same patients as DOCTOR (same service)", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "nurse")
    await page.goto("/patients")

    const rows = page.locator("table tbody tr")
    // Wait for the table to have rows (we'll check for at least 5 seeded patients)
    await expect(rows).toHaveCount(5, { timeout: 10_000 })
  })

  test("VIEWER (patient) → sees only own patient", async ({
    page,
    context,
    request,
  }) => {
    // Log in as patient DT1-001 (VIEWER role)
    await loginAs(context, request, "patient_dt1")
    await page.goto("/patients")

    const rows = page.locator("table tbody tr")
    // A VIEWER should only see their own patient
    await expect(rows).toHaveCount(1, { timeout: 5_000 })
    await expect(page.getByText("Patient DT1-001")).toBeVisible()

    // Should NOT see other patients
    await expect(page.getByText("Patient DT2-002")).not.toBeVisible()
    await expect(page.getByText("Patient DT1-003")).not.toBeVisible()
    await expect(page.getByText("Patient GD-005")).not.toBeVisible()
  })
})