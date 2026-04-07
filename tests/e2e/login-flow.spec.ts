import { test, expect } from "@playwright/test"

/**
 * E2E tests for the login page flow.
 * Uses data-testid and semantic locators for resilience against i18n changes.
 */

test.describe("Login page", () => {
  test("login page loads and contains form elements", async ({ page }) => {
    await page.goto("/login")

    // Title heading exists
    await expect(page.locator("h1")).toBeVisible()

    // Email input exists (DiabeoTextField uses id="login-email")
    const emailInput = page.locator("#login-email")
    await expect(emailInput).toBeVisible()

    // Password input exists
    const passwordInput = page.locator("#login-password")
    await expect(passwordInput).toBeVisible()

    // Submit button exists
    await expect(page.getByTestId("login-button")).toBeVisible()
  })

  test("submit button is disabled when fields are empty", async ({ page }) => {
    await page.goto("/login")
    const submitBtn = page.getByTestId("login-button")
    await expect(submitBtn).toBeDisabled()
  })

  test("submit button enables when both fields are filled", async ({ page }) => {
    await page.goto("/login")
    await page.locator("#login-email").fill("test@example.com")
    await page.locator("#login-password").fill("password123")

    const submitBtn = page.getByTestId("login-button")
    await expect(submitBtn).toBeEnabled()
  })

  test("shows error after submitting invalid credentials", async ({ page }) => {
    await page.goto("/login")
    await page.locator("#login-email").fill("invalid@example.com")
    await page.locator("#login-password").fill("wrongpassword")
    await page.getByTestId("login-button").click()

    // Wait for error to appear (API response or timeout)
    await page.waitForTimeout(2000)

    // Should show some error feedback (alert banner or message)
    const pageContent = await page.textContent("body")
    expect(
      pageContent?.includes("incorrect") ||
      pageContent?.includes("indisponible") ||
      pageContent?.includes("erreur") ||
      pageContent?.includes("Erreur") ||
      pageContent?.includes("Invalid") ||
      pageContent?.includes("error"),
    ).toBeTruthy()
  })

  test("password toggle switches input type", async ({ page }) => {
    await page.goto("/login")
    const passwordInput = page.locator("#login-password")
    await passwordInput.fill("secret123")

    // Initially password type
    await expect(passwordInput).toHaveAttribute("type", "password")

    // Click toggle — find the eye button inside the password field container
    const passwordContainer = page.locator("#login-password").locator("..")
    const toggleBtn = passwordContainer.locator("button")
    await toggleBtn.click()
    await expect(passwordInput).toHaveAttribute("type", "text")

    // Click again
    await toggleBtn.click()
    await expect(passwordInput).toHaveAttribute("type", "password")
  })

  test("HDS notice is visible in footer", async ({ page }) => {
    await page.goto("/login")
    await expect(page.locator("text=HDS")).toBeVisible()
  })

  test("root page redirects to login", async ({ page }) => {
    await page.goto("/")
    await page.waitForURL("**/login")
    expect(page.url()).toContain("/login")
  })

  test("forgot password link exists", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByTestId("forgot-password-button")).toBeVisible()
  })

  test("create account link exists", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByTestId("create-account-button")).toBeVisible()
  })
})
