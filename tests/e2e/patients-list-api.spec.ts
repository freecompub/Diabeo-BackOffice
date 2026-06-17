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
 * to `memberDoctor` (Dr Sophie Martin) AND via PatientService to the shared
 * "Service Diabétologie". US-2618/F6 : le DOCTOR voit ses patients référents ;
 * le NURSE (`memberNurse`, membre du service) voit les patients du service.
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

  test("NURSE → sees the service's patients (F6 service scope)", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "nurse")
    await page.goto("/patients")

    // US-2618/F6 : un infirmier n'est pas référent, mais garde le périmètre
    // SERVICE — il voit les patients du/des service(s) dont il est membre.
    // `memberNurse` est membre du "Service Diabétologie" qui porte les 5 patients.
    const rows = page.locator("table tbody tr")
    await expect(rows).toHaveCount(5, { timeout: 10_000 })
    await expect(page.getByText("Jean Durand")).toBeVisible()
    await expect(page.getByText("Amélie Rousseau")).toBeVisible()
  })

  test("VIEWER (patient) → redirected away from the pro patient list", async ({
    page,
    context,
    request,
  }) => {
    // RBAC (US-3356) — la liste pro `/patients` est interdite aux patients :
    // `(dashboard)/layout.tsx` redirige tout VIEWER vers `/patient/dashboard`.
    // Le patient ne voit donc JAMAIS la liste des autres patients (cloisonnement
    // PHI), il atterrit sur son propre tableau de bord (ses seules données).
    await loginAs(context, request, "patient_dt1")
    await page.goto("/patients")

    await expect(page).toHaveURL(/\/patient\/dashboard/, { timeout: 10_000 })

    // Garde-fou cloisonnement : aucun nom d'autre patient seedé n'est rendu.
    await expect(page.getByText("Claire Bernard")).not.toBeVisible()
    await expect(page.getByText("Lucas Petit")).not.toBeVisible()
    await expect(page.getByText("Amélie Rousseau")).not.toBeVisible()
  })
})
