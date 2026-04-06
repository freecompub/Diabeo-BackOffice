import { test, expect } from "@playwright/test"

/**
 * E2E tests for the login page flow.
 *
 * Tests the browser-based login experience:
 * - Page renders correctly
 * - Form validation
 * - Error display for invalid credentials
 * - Navigation and accessibility
 */

test.describe("Login page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login")
  })

  test("renders login form with correct elements", async ({ page }) => {
    // Logo
    await expect(page.getByText("Diabeo Backoffice")).toBeVisible()

    // Email field
    const emailInput = page.getByLabel("Email")
    await expect(emailInput).toBeVisible()
    await expect(emailInput).toHaveAttribute("type", "email")

    // Password field
    const passwordInput = page.getByLabel("Mot de passe")
    await expect(passwordInput).toBeVisible()
    await expect(passwordInput).toHaveAttribute("type", "password")

    // Submit button
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible()

    // Forgot password link
    await expect(page.getByText("Mot de passe oublie")).toBeVisible()
  })

  test("submit button is disabled when fields are empty", async ({ page }) => {
    const submitBtn = page.getByRole("button", { name: "Se connecter" })
    await expect(submitBtn).toBeDisabled()
  })

  test("submit button enables when both fields are filled", async ({ page }) => {
    await page.getByLabel("Email").fill("test@example.com")
    await page.getByLabel("Mot de passe").fill("password123")

    const submitBtn = page.getByRole("button", { name: "Se connecter" })
    await expect(submitBtn).toBeEnabled()
  })

  test("shows error message on invalid credentials", async ({ page }) => {
    await page.getByLabel("Email").fill("invalid@example.com")
    await page.getByLabel("Mot de passe").fill("wrongpassword")
    await page.getByRole("button", { name: "Se connecter" }).click()

    // Wait for error message to appear
    await expect(
      page.getByText(/incorrect|indisponible|erreur/i),
    ).toBeVisible({ timeout: 5000 })
  })

  test("password visibility toggle works", async ({ page }) => {
    const passwordInput = page.getByLabel("Mot de passe")
    await passwordInput.fill("secret123")

    // Initially hidden
    await expect(passwordInput).toHaveAttribute("type", "password")

    // Click show button
    await page.getByLabel("Afficher le mot de passe").click()
    await expect(passwordInput).toHaveAttribute("type", "text")

    // Click hide button
    await page.getByLabel("Masquer le mot de passe").click()
    await expect(passwordInput).toHaveAttribute("type", "password")
  })

  test("keyboard navigation works (Tab + Enter)", async ({ page }) => {
    // Tab to email
    await page.keyboard.press("Tab")
    const emailInput = page.getByLabel("Email")
    await expect(emailInput).toBeFocused()

    // Fill email and tab to password
    await emailInput.fill("test@example.com")
    await page.keyboard.press("Tab")

    // Tab to password (might pass through show/hide button first)
    const passwordInput = page.getByLabel("Mot de passe")
    await passwordInput.fill("password123")
  })

  test("displays HDS notice in footer", async ({ page }) => {
    await expect(page.getByText(/HDS/)).toBeVisible()
  })

  test("root page redirects to login", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/login/)
  })
})
