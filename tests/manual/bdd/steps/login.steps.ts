import { expect } from "@playwright/test"
import { createBdd } from "playwright-bdd"

const { Given, When, Then } = createBdd()

Given("je suis sur la page de connexion", async ({ page }) => {
  await page.goto("/login")
  await expect(page.getByTestId("login-screen")).toBeVisible()
})

When("je saisis l'email {string}", async ({ page }, email: string) => {
  await page.locator("#login-email").fill(email)
})

When("je saisis le mot de passe {string}", async ({ page }, password: string) => {
  await page.locator("#login-password").fill(password)
})

When("je clique sur le bouton de connexion", async ({ page }) => {
  await page.getByTestId("login-button").click()
})

Then("le bouton de connexion est désactivé", async ({ page }) => {
  await expect(page.getByTestId("login-button")).toBeDisabled()
})

Then("le bouton de connexion est activé", async ({ page }) => {
  await expect(page.getByTestId("login-button")).toBeEnabled()
})

Then("je reste sur la page de connexion", async ({ page }) => {
  await expect(page).toHaveURL(/\/login\/?(\?.*)?$/)
})

Then("je vois une alerte d'erreur", async ({ page }) => {
  // AlertBanner severity="warning" → role="alert" (cf. AlertBanner.tsx).
  await expect(page.getByRole("alert")).toBeVisible()
})
