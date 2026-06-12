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
 * Slot dynamique : étalé sur `J+30..J+89` × `08 h..19 h` × `00..59 min` à
 * partir de `Date.now()` → ~43 200 créneaux distincts. La probabilité de
 * collision entre 2 runs (qui diffèrent d'au moins une seconde) est
 * négligeable, ce qui rend le test idempotent (pas de 422 slotConflict au
 * rejeu). La réponse `POST` est lue directement via `waitForResponse`
 * (pas de listener `page.on("response")` asynchrone — sinon course entre
 * le `await res.json()` du handler et l'assertion).
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

/**
 * Génère un créneau futur quasi-unique pour rendre le test idempotent.
 * Étale sur J+30..J+89 × 08 h..19 h × 00..59 min à partir de `Date.now()`
 * → ~43 200 créneaux. 2 runs distants d'≥1 s tombent sur des créneaux
 * différents → pas de 422 slotConflict au rejeu.
 */
function uniqueFutureSlot(): { date: string; hour: string } {
  const now = Date.now()
  const target = new Date()
  target.setDate(target.getDate() + 30 + (now % 60)) // J+30..J+89
  // Date YYYY-MM-DD format pour <input type="date">.
  const date = `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}`
  // Heure HH:MM — h ∈ [08, 19], min ∈ [00, 59], dérivés de l'horloge.
  const hourOfDay = 8 + (Math.floor(now / 1000) % 12)
  const minute = now % 60
  const hour = `${pad2(hourOfDay)}:${pad2(minute)}`
  return { date, hour }
}

test.describe("/appointments — création nouveau RDV", () => {
  test("DOCTOR crée un RDV via le bouton + Nouveau RDV", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")

    await page.goto("/appointments")

    // ─── Calendar monté + bouton "+ Nouveau RDV" activé ──────────────
    await expect(page.locator(".sx__week-grid")).toBeVisible({
      timeout: 15_000,
    })
    const openCreateButton = page.getByRole("button", { name: "+ Nouveau rendez-vous" })
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
    const { date, hour } = uniqueFutureSlot()
    await dialog.locator("#create-date").fill(date)
    await dialog.locator("#create-hour").fill(hour)

    // ─── Motif identifiable pour cleanup éventuel ────────────────────
    await dialog.locator("#create-motif").fill(NEW_RDV_MOTIF)

    // ─── Submit ──────────────────────────────────────────────────────
    // On arme l'attente de la réponse AVANT le clic (best practice
    // Playwright) et on lit la réponse directement — pas de listener
    // `page.on("response")` dont le `await res.json()` courrait avec
    // l'assertion (faux négatif `toHaveLength(0)`).
    const postResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/appointments")
        && res.request().method() === "POST",
      { timeout: 10_000 },
    )
    const submitButton = dialog.getByRole("button", { name: "Créer le rendez-vous" })
    await expect(submitButton).toBeEnabled()
    await submitButton.click()

    // ─── POST /api/appointments → 201 attendu ────────────────────────
    const postResponse = await postResponsePromise
    const created = (await postResponse
      .json()
      .catch(() => null)) as { id?: number } | null
    expect(
      postResponse.status(),
      `body = ${JSON.stringify(created)}`,
    ).toBe(201)

    // ─── Modal se ferme ──────────────────────────────────────────────
    await expect(dialog).not.toBeVisible({ timeout: 5_000 })

    // ─── Live region succès visible ──────────────────────────────────
    await expect(
      page.getByText("✓ Rendez-vous créé avec succès"),
    ).toBeVisible({ timeout: 5_000 })

    // ─── La réponse 201 porte l'id du RDV créé ───────────────────────
    // `toBeTypeOf` est un matcher Vitest, absent de l'`expect` Playwright
    // (cassait `tsc -p tsconfig.json` car ce spec est typecheck par le projet).
    expect(
      typeof created?.id,
      `réponse 201 sans id : ${JSON.stringify(created)}`,
    ).toBe("number")
  })
})
