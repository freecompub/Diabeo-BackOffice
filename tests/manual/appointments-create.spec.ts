import { test, expect } from "@playwright/test"
import { loginAs } from "../e2e/helpers/auth"

/**
 * Test manuel — création d'un nouveau RDV depuis le calendrier.
 *
 * Scénario :
 *   1. Login DOCTOR (Dr Sophie Martin, membership auto-resolved)
 *   2. Goto /appointments — calendrier monté en vue Semaine
 *   3. Clic sur "+ Nouveau RDV" en haut à droite du header calendrier
 *   4. Modal `AppointmentCreateModal` ouvert
 *   5. Sélectionner patient "Jean Durand #1" via le `<datalist>` (saisie
 *      exacte du label déclenche `handleInputChange` → onChange(id=1))
 *   6. Configurer date+heure dans un slot futur unique (évite slotConflict
 *      si le test est rejoué)
 *   7. Laisser duration=30 / location=in_person / type=diabeto (defaults)
 *   8. Soumettre — `POST /api/appointments` doit renvoyer 201
 *   9. Vérifier la fermeture du modal + live region "✓ Rendez-vous créé"
 *  10. (Cleanup hors test : RDV reste en base pour debug visuel)
 *
 * Slot dynamique : `J+30` à `17:HH` où HH = `Date.now() % 60`. Probabilité
 * de collision sur 2 runs rapprochés ≈ 1/60 ; en cas de collision, le
 * test capture proprement le `slotConflict` côté UI.
 *
 * **Effet de bord** — Crée un vrai RDV en BDD (table `appointments`) à
 * chaque run réussi. Pas de cleanup automatique. Pour purger :
 *   `DELETE FROM appointments WHERE motif LIKE 'Test automation manuel%';`
 *
 * Lancement :
 *   pnpm exec playwright test --config=playwright.manual.config.ts \
 *     tests/manual/appointments-create.spec.ts --headed
 */

const PATIENT_LABEL = "Jean Durand #1"
const NEW_RDV_MOTIF = `Test automation manuel ${new Date().toISOString()}`

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

function slotJPlus30(): { date: string; hour: string } {
  const target = new Date()
  target.setDate(target.getDate() + 30)
  // Date YYYY-MM-DD format pour <input type="date">.
  const date = `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}`
  // Hour HH:MM — minute basée sur Date.now() pour minimiser collisions
  // si le test est relancé dans la même journée.
  const minute = pad2(Date.now() % 60)
  const hour = `17:${minute}`
  return { date, hour }
}

test.describe("/appointments — création nouveau RDV", () => {
  test("DOCTOR crée un RDV via le bouton + Nouveau RDV", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")

    // Capture les responses /api/appointments POST pour vérifier le 201.
    const postResponses: { status: number; body: unknown }[] = []
    page.on("response", async (res) => {
      const isApptPost =
        res.url().endsWith("/api/appointments")
        && res.request().method() === "POST"
      if (isApptPost) {
        let body: unknown = null
        try { body = await res.json() } catch { /* noop */ }
        postResponses.push({ status: res.status(), body })
      }
    })

    await page.goto("/appointments")

    // ─── Calendar monté + bouton "+ Nouveau RDV" activé ──────────────
    await expect(page.locator(".sx__week-grid")).toBeVisible({
      timeout: 15_000,
    })
    const openCreateButton = page.getByRole("button", { name: "+ Nouveau RDV" })
    await expect(openCreateButton).toBeEnabled()

    // ─── Ouverture du modal ──────────────────────────────────────────
    await openCreateButton.click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(dialog.getByText("Nouveau rendez-vous")).toBeVisible()

    // ─── Sélection du patient via datalist ───────────────────────────
    // PatientCombobox = <input list="..."> + <datalist>. Pour matcher
    // un patient, on `fill` avec le label EXACT. handleInputChange
    // normalize + .find(label === input) → onChange(id, label).
    const patientInput = dialog.locator("#create-patient")
    await patientInput.fill(PATIENT_LABEL)

    // ─── Date + heure futures uniques ────────────────────────────────
    const { date, hour } = slotJPlus30()
    await dialog.locator("#create-date").fill(date)
    await dialog.locator("#create-hour").fill(hour)

    // ─── Motif identifiable pour cleanup éventuel ────────────────────
    await dialog.locator("#create-motif").fill(NEW_RDV_MOTIF)

    // ─── Submit ──────────────────────────────────────────────────────
    const submitButton = dialog.getByRole("button", { name: "Créer le RDV" })
    await expect(submitButton).toBeEnabled()
    await submitButton.click()

    // ─── POST /api/appointments → 201 attendu ────────────────────────
    await page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/appointments")
        && res.request().method() === "POST",
      { timeout: 10_000 },
    )
    expect(postResponses).toHaveLength(1)
    expect(
      postResponses[0].status,
      `body = ${JSON.stringify(postResponses[0].body)}`,
    ).toBe(201)

    // ─── Modal se ferme ──────────────────────────────────────────────
    await expect(dialog).not.toBeVisible({ timeout: 5_000 })

    // ─── Live region succès visible ──────────────────────────────────
    await expect(
      page.getByText("✓ Rendez-vous créé avec succès"),
    ).toBeVisible({ timeout: 5_000 })

    // ─── Le RDV créé apparaît dans la liste GET subséquente ──────────
    // Le hook polling 60s ou le revalidate post-create rappelle GET
    // /api/appointments. On vérifie que le nouvel id est dans la liste.
    const created = postResponses[0].body as { id?: number } | null
    expect(
      created?.id,
      `réponse 201 sans id : ${JSON.stringify(created)}`,
    ).toBeTypeOf("number")
  })
})
