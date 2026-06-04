import { test, expect } from "@playwright/test"
import { loginAs } from "../e2e/helpers/auth"

/**
 * Test manuel — ouverture du modal détail d'un RDV en attente de validation.
 *
 * Scénario :
 *   1. Login DOCTOR (Dr Sophie Martin)
 *   2. Goto /appointments — vue Semaine par défaut, semaine courante
 *      contient le RDV seed id=14 (2026-06-04, 14:00, pending_validation,
 *      type "diabeto", patient 1, durée 30 min)
 *   3. Cliquer sur la carte event `[data-event-id="14"]`
 *   4. Vérifier que le `<Dialog>` (`role="dialog"`) s'ouvre avec :
 *      - title "Diabétologie" (i18n appointments.type.diabeto)
 *      - badge "En attente de validation" (i18n appointments.status.pending_validation)
 *      - durée "30 min"
 *      - lien vers /patients/1
 *
 * Data : RDV id=14 vient du seed. S'il a été modifié/supprimé, lancer
 * `pnpm prisma db seed` pour le restaurer.
 *
 * Lancement :
 *   pnpm exec playwright test --config=playwright.manual.config.ts \
 *     tests/manual/appointments-detail-modal.spec.ts --headed
 */

test.describe("/appointments — modal détail RDV", () => {
  test("DOCTOR ouvre le modal d'un RDV en attente de validation", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")

    const consoleErrors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })

    await page.goto("/appointments")

    // ─── Attendre que le calendrier soit monté ───────────────────────
    await expect(page.locator(".sx__week-grid")).toBeVisible({
      timeout: 15_000,
    })

    // ─── Cibler l'event RDV id=14 (pending_validation aujourd'hui) ──
    // Schedule-X v4 ajoute `data-event-id={String(event.id)}` sur la
    // carte event. L'adapter renvoie `id: String(appt.id)` → "14".
    const eventCard = page.locator('[data-event-id="14"]')
    await expect(eventCard).toBeVisible({ timeout: 10_000 })

    // ─── Clic sur la carte → ouvre le modal ──────────────────────────
    await eventCard.click()

    // ─── Modal `<Dialog>` ouvert ─────────────────────────────────────
    // shadcn/ui Dialog rend un overlay + `role="dialog"`.
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // ─── Titre : type "Diabétologie" + badge "En attente de validation"
    await expect(dialog.getByText("Diabétologie")).toBeVisible()
    await expect(dialog.getByText("En attente de validation")).toBeVisible()

    // ─── Durée 30 min ───────────────────────────────────────────────
    // Le champ Field rend `<dt>{label}</dt><dd>{value}</dd>`. On
    // assert sur le texte combiné contenu dans le dialog.
    await expect(dialog.getByText(/30\s*min/)).toBeVisible()

    // ─── Lien vers le dossier patient ────────────────────────────────
    const patientLink = dialog.getByRole("link").filter({
      hasText: /patient/i,
    })
    await expect(patientLink).toBeVisible()
    await expect(patientLink).toHaveAttribute("href", "/patients/1")
    // Defense-in-depth security : noopener noreferrer (cf. HSA-2 PR #433)
    await expect(patientLink).toHaveAttribute("rel", /noopener/)
    await expect(patientLink).toHaveAttribute("rel", /noreferrer/)

    // ─── Garde-fou : pas d'erreur console ────────────────────────────
    const relevantErrors = consoleErrors.filter(
      (e) =>
        !e.includes("Schedule-X") || e.includes("[Schedule-X error]"),
    )
    expect(
      relevantErrors,
      `Erreurs console pendant le test :\n${relevantErrors.join("\n")}`,
    ).toEqual([])
  })
})
