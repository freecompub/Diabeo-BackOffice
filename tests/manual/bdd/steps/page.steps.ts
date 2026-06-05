import { expect } from "@playwright/test"
import { createBdd } from "playwright-bdd"

const { When, Then } = createBdd()

// --- Présence / absence par data-testid ---

Then("je vois l'élément {string}", async ({ page }, testId: string) => {
  await expect(page.getByTestId(testId)).toBeVisible()
})

Then("l'élément {string} est absent", async ({ page }, testId: string) => {
  await expect(page.getByTestId(testId)).toHaveCount(0)
})

// --- Interactions ---

When(
  "je remplis le champ {string} avec {string}",
  async ({ page }, selector: string, value: string) => {
    await page.locator(selector).fill(value)
  },
)

When("je clique l'élément {string}", async ({ page }, testId: string) => {
  await page.getByTestId(testId).click()
})

// --- Texte ---

Then("je vois le texte {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible()
})
