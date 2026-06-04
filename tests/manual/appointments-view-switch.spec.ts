import { test, expect } from "@playwright/test"
import { loginAs } from "../e2e/helpers/auth"

/**
 * Test manuel — switch d'affichage Semaine → Mois sur /appointments.
 *
 * Scénario :
 *   1. Login DOCTOR (Dr Sophie Martin, membership cabinet auto-resolved)
 *   2. Goto /appointments — calendrier monte en vue Week par défaut
 *      (`@schedule-x/calendar` default = `InternalViewName.Week`)
 *   3. Vérifier que le sélecteur de vue affiche "Semaine"
 *   4. Cliquer sur le sélecteur → dropdown ouvre
 *   5. Cliquer sur "Mois"
 *   6. Vérifier que le bouton affiche maintenant "Mois" et que la
 *      grille mois (`.sx__month-grid-cell`) est rendue
 *
 * Verrouillage important : ce test n'écrit RIEN en base. Pas de drag&drop,
 * pas de création RDV. Read-only pur — re-jouable à volonté.
 *
 * Lancement : `pnpm exec playwright test tests/manual/appointments-view-switch.spec.ts --headed`
 */

test.describe("/appointments — switch d'affichage", () => {
  test("DOCTOR change Semaine → Mois via le sélecteur Schedule-X", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")

    // Capture erreurs console (Schedule-X aime throw des Errors verbeux).
    const consoleErrors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })

    await page.goto("/appointments")

    // ─── Calendar monté : attendre la vue Semaine initiale ───────────
    // `.sx__week-grid` est présent dès que createCalendar a fini.
    const weekGrid = page.locator(".sx__week-grid")
    await expect(weekGrid).toBeVisible({ timeout: 15_000 })

    // ─── Sélecteur de vue : affiche "Semaine" ────────────────────────
    const viewSelectorButton = page.locator(
      ".sx__view-selection-selected-item",
    )
    await expect(viewSelectorButton).toBeVisible()
    await expect(viewSelectorButton).toContainText("Semaine")

    // ─── Ouverture du dropdown ───────────────────────────────────────
    await viewSelectorButton.click()

    // Schedule-X applique la classe `is-open` sur `.sx__view-selection`
    // après le click. On attend ce flag plutôt que `data-testid` qui peut
    // varier selon la version (4.x packe parfois sans testid sur le UL).
    const viewSelection = page.locator(".sx__view-selection")
    await expect(viewSelection).toHaveClass(/is-open/, { timeout: 5_000 })

    // Les 3 options sont rendues sous `.sx__view-selection-item`.
    const dayOption = page.locator(".sx__view-selection-item", { hasText: "Jour" })
    const weekOption = page.locator(".sx__view-selection-item", { hasText: "Semaine" })
    const monthOption = page.locator(".sx__view-selection-item", { hasText: "Mois" })
    await expect(dayOption).toBeVisible()
    await expect(weekOption).toBeVisible()
    await expect(monthOption).toBeVisible()

    // ─── Sélection "Mois" ────────────────────────────────────────────
    await monthOption.click()

    // Dropdown se referme (classe `is-open` retirée).
    await expect(viewSelection).not.toHaveClass(/is-open/, { timeout: 5_000 })

    // Bouton sélecteur affiche maintenant "Mois".
    await expect(viewSelectorButton).toContainText("Mois", { timeout: 5_000 })

    // ─── Grille mois rendue dans le DOM ──────────────────────────────
    // `.sx__month-grid-cell` = chaque case du mois. Au moins 28
    // (mois court de 28 jours min) — souvent 35-42 avec semaines
    // partielles avant/après.
    const monthCells = page.locator(".sx__month-grid-cell")
    await expect(monthCells.first()).toBeVisible({ timeout: 5_000 })
    expect(await monthCells.count()).toBeGreaterThanOrEqual(28)

    // ─── L'ancienne grille semaine n'est plus rendue ─────────────────
    await expect(weekGrid).not.toBeVisible()

    // ─── Garde-fou : aucune erreur Schedule-X dans la console ────────
    const sxErrors = consoleErrors.filter((e) =>
      e.includes("[Schedule-X error]"),
    )
    expect(
      sxErrors,
      `${sxErrors.length} erreurs Schedule-X :\n${sxErrors.join("\n")}`,
    ).toEqual([])
  })
})
