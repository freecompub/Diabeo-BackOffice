import { test, expect } from "@playwright/test"
import { loginAs } from "../e2e/helpers/auth"

/**
 * Test manuel — affichage de l'axe horaire (vue Semaine).
 *
 * Scénario :
 *   1. Login DOCTOR (Dr Sophie Martin)
 *   2. Goto /appointments — vue Semaine par défaut
 *   3. Vérifier l'axe horaire à gauche du calendrier :
 *      - Le conteneur `.sx__week-grid__time-axis` est visible
 *      - 24 labels d'heure sont rendus (00 h → 23 h, défaut Schedule-X
 *        `dayBoundaries = { start: 0, end: 2400 }`)
 *      - Format horaire `fr-FR` cohérent (`HH h`, ex. "00 h", "14 h")
 *      - Heures triées en ordre croissant strict
 *      - Première heure = "00 h", dernière = "23 h"
 *
 * Note locale — Schedule-X v4 rend l'axe horaire en `fr-FR` sous la forme
 * `HH h` (et non `HH:MM`). Le test parse l'heure de tête de chaque label
 * et valide count/ordre/bornes sur cette base.
 *
 * Garde-fou non régression — si Schedule-X change le format des heures
 * ou si Diabeo override `dayBoundaries` à la baisse (ex: 08:00→20:00
 * pour réduire le scroll cabinet), le test cassera proprement.
 *
 * Lancement :
 *   pnpm exec playwright test --config=playwright.manual.config.ts \
 *     tests/manual/appointments-time-axis.spec.ts --headed
 */

test.describe("/appointments — axe horaire vue Semaine", () => {
  test("DOCTOR voit 24 heures sur l'axe gauche, format HH h ordonné", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")

    await page.goto("/appointments")

    // ─── Vue Semaine montée ──────────────────────────────────────────
    await expect(page.locator(".sx__week-grid")).toBeVisible({
      timeout: 15_000,
    })

    // ─── Time axis présent ───────────────────────────────────────────
    const timeAxis = page.locator(".sx__week-grid__time-axis")
    await expect(timeAxis).toBeVisible()

    // ─── Labels d'heure ──────────────────────────────────────────────
    const hourLabels = timeAxis.locator(".sx__week-grid__hour-text")
    const labelTexts = await hourLabels.allTextContents()

    // ─── Format : chaque label match le format horaire fr-FR `HH h` ──
    // Schedule-X v4 rend l'axe en `fr-FR` sous la forme "00 h" … "23 h".
    // Le groupe capture l'heure (2 chiffres, 00→23) pour la suite.
    const hourFormatRe = /^([01]\d|2[0-3])\s*h$/
    const hours = labelTexts.map((t) => {
      const trimmed = t.trim()
      const m = trimmed.match(hourFormatRe)
      expect(
        m,
        `label "${trimmed}" ne respecte pas le format fr-FR "HH h"`,
      ).not.toBeNull()
      return Number(m![1])
    })

    // ─── Count : 24 labels (0h → 23h, defaults Schedule-X) ───────────
    expect(
      hours.length,
      `attendu 24 labels (00 h → 23 h), trouvé ${hours.length}`,
    ).toBe(24)

    // ─── Première heure = 0 ("00 h"), dernière = 23 ("23 h") ─────────
    expect(hours[0]).toBe(0)
    expect(hours[hours.length - 1]).toBe(23)

    // ─── Ordre croissant strict (anti régression DST, anti reverse) ──
    for (let i = 1; i < hours.length; i++) {
      expect(
        hours[i],
        `ordre rompu à l'index ${i}: ${labelTexts[i - 1]} → ${labelTexts[i]}`,
      ).toBeGreaterThan(hours[i - 1])
    }

    // ─── Pas de doublons ─────────────────────────────────────────────
    expect(new Set(hours).size).toBe(hours.length)
  })
})
