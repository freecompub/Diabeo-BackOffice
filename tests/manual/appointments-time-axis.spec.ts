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
 *      - 24 labels d'heure sont rendus (00:00 → 23:00, défaut Schedule-X
 *        `dayBoundaries = { start: 0, end: 2400 }`)
 *      - Format `HH:MM` cohérent en `fr-FR`
 *      - Heures triées en ordre croissant strict
 *      - Première heure = "00:00", dernière = "23:00"
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
  test("DOCTOR voit 24 heures sur l'axe gauche, format HH:MM ordonné", async ({
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

    // ─── Format : chaque label match HH:MM strict ────────────────────
    const hourFormatRe = /^([01]\d|2[0-3]):([0-5]\d)$/
    for (const t of labelTexts) {
      const trimmed = t.trim()
      expect(
        trimmed,
        `label "${trimmed}" ne respecte pas le format HH:MM`,
      ).toMatch(hourFormatRe)
    }

    // ─── Count : 24 labels (0h → 23h, defaults Schedule-X) ───────────
    expect(
      labelTexts.length,
      `attendu 24 labels (00:00 → 23:00), trouvé ${labelTexts.length}`,
    ).toBe(24)

    // ─── Premier label = "00:00", dernier = "23:00" ──────────────────
    expect(labelTexts[0].trim()).toBe("00:00")
    expect(labelTexts[labelTexts.length - 1].trim()).toBe("23:00")

    // ─── Ordre croissant strict (anti régression DST, anti reverse) ──
    const minutesList = labelTexts.map((t) => {
      const [h, m] = t.trim().split(":").map(Number)
      return h * 60 + m
    })
    for (let i = 1; i < minutesList.length; i++) {
      expect(
        minutesList[i],
        `ordre rompu à l'index ${i}: ${labelTexts[i - 1]} → ${labelTexts[i]}`,
      ).toBeGreaterThan(minutesList[i - 1])
    }

    // ─── Pas de doublons ─────────────────────────────────────────────
    expect(new Set(labelTexts).size).toBe(labelTexts.length)
  })
})
