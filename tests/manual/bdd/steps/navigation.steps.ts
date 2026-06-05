import { expect } from "@playwright/test"
import { createBdd } from "playwright-bdd"

const { When, Then } = createBdd()

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

When("je vais sur {string}", async ({ page }, path: string) => {
  await page.goto(path)
})

Then("je suis redirigé vers {string}", async ({ page }, path: string) => {
  // Tolère un slash final éventuel.
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(path)}/?(\\?.*)?$`))
})

Then("je vois le titre {string}", async ({ page }, title: string) => {
  await expect(
    page.getByRole("heading", { name: title }),
  ).toBeVisible()
})
