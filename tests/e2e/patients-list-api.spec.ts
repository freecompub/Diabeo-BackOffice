import { test, expect } from "@playwright/test"
import { loginAs } from "./helpers/auth"

/**
 * E2E tests for `/patients` — patient list page connected to real backend API.
 *
 * Asserts the page fetches PatientListItemDto[] from `GET /api/patients`
 * (no more DEMO_PATIENTS hardcoded) and renders the seeded patients with
 * their real names.
 *
 * Prerequisites: the test database is seeded with the standard data
 * (prisma/seed.ts). The seed creates 5 patients linked via PatientReferent
 * to `memberDoctor` (Dr Sophie Martin). `memberNurse` (Marie Dupont IDE)
 * has no PatientReferent rows by default — nurse sees the empty state.
 */
test.describe("Patients list — /patients (real API connection)", () => {
  test("DOCTOR → sees the 5 seeded patients with real names", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")
    await page.goto("/patients")

    const rows = page.locator("table tbody tr")
    await expect(rows).toHaveCount(5, { timeout: 10_000 })

    // Real names come from prisma/seed.ts encUserPII calls.
    await expect(page.getByText("Jean Durand")).toBeVisible()
    await expect(page.getByText("Claire Bernard")).toBeVisible()
    await expect(page.getByText("Lucas Petit")).toBeVisible()
    await expect(page.getByText("Hélène Moreau")).toBeVisible()
    await expect(page.getByText("Amélie Rousseau")).toBeVisible()

    // Pathology badges present (DT1 ×2, DT2 ×2, GD ×1).
    await expect(page.getByText("Type 1").first()).toBeVisible()
    await expect(page.getByText("Type 2").first()).toBeVisible()
    await expect(page.getByText("Gestationnel").first()).toBeVisible()
  })

  test("NURSE → sees empty list (no PatientReferent in seed)", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "nurse")
    await page.goto("/patients")

    // The seed only wires PatientReferent to memberDoctor. memberNurse has
    // none → listByDoctor() returns []. The table shows the empty-state row.
    // Once a nurse referent seed is added (V1.5), this test should mirror
    // the DOCTOR assertions above.
    // Locale-agnostic match: fr "Aucun patient trouve" or en "No patients found".
    await expect(
      page.getByText(/Aucun patient trouv|No patients found/).first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  test("VIEWER (patient) → sees only own patient", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "patient_dt1")
    await page.goto("/patients")

    const rows = page.locator("table tbody tr")
    await expect(rows).toHaveCount(1, { timeout: 5_000 })

    // Patient DT1 is Jean Durand per the seed.
    await expect(page.getByText("Jean Durand")).toBeVisible()

    // Should NOT see other seeded patients (RGPD scope).
    await expect(page.getByText("Claire Bernard")).not.toBeVisible()
    await expect(page.getByText("Lucas Petit")).not.toBeVisible()
    await expect(page.getByText("Amélie Rousseau")).not.toBeVisible()
  })
})
