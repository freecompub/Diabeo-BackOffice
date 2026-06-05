import { expect } from "@playwright/test"
import { createBdd } from "playwright-bdd"

const { Given, When, Then } = createBdd()

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

Given("je suis sur {string}", async ({ page }, path: string) => {
  await page.goto(path)
})

When("je vais sur {string}", async ({ page }, path: string) => {
  await page.goto(path)
})

Then("je suis redirigé vers {string}", async ({ page }, path: string) => {
  // Ancré sur l'origine pour distinguer "/" des sous-chemins ("/admin"…),
  // tolère un slash final + une query string éventuelle.
  await expect(page).toHaveURL(
    new RegExp(`^https?://[^/]+${escapeRegExp(path)}/?(\\?.*)?$`),
  )
})

Then("je vois le titre {string}", async ({ page }, title: string) => {
  await expect(
    page.getByRole("heading", { name: title }),
  ).toBeVisible()
})

Then("je ne vois pas le titre {string}", async ({ page }, title: string) => {
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0)
})

Then("je reste sur {string}", async ({ page }, path: string) => {
  await expect(page).toHaveURL(
    new RegExp(`^https?://[^/]+${escapeRegExp(path)}/?(\\?.*)?$`),
  )
})
