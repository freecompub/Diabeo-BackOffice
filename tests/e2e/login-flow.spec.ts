import { test, expect } from "@playwright/test"

/**
 * E2E tests for the login page flow.
 * Robust tests that work in headless CI environments.
 */

test.describe("Login page", () => {
  test("login page loads and contains form elements", async ({ page }) => {
    await page.goto("/login")

    // Title
    await expect(page.locator("text=Diabeo Backoffice")).toBeVisible()

    // Email input exists
    const emailInput = page.locator("#email")
    await expect(emailInput).toBeVisible()

    // Password input exists
    const passwordInput = page.locator("#password")
    await expect(passwordInput).toBeVisible()

    // Submit button exists
    await expect(page.locator("button[type='submit']")).toBeVisible()
  })

  test("submit button is disabled when fields are empty", async ({ page }) => {
    await page.goto("/login")
    const submitBtn = page.locator("button[type='submit']")
    await expect(submitBtn).toBeDisabled()
  })

  test("submit button enables when both fields are filled", async ({ page }) => {
    await page.goto("/login")
    await page.locator("#email").fill("test@example.com")
    await page.locator("#password").fill("password123")

    const submitBtn = page.locator("button[type='submit']")
    await expect(submitBtn).toBeEnabled()
  })

  test("shows error after submitting invalid credentials", async ({ page }) => {
    await page.goto("/login")
    await page.locator("#email").fill("invalid@example.com")
    await page.locator("#password").fill("wrongpassword")
    await page.locator("button[type='submit']").click()

    // Wait for error to appear (API response or timeout)
    await page.waitForTimeout(2000)

    // Should show some error feedback (alert banner or message)
    const pageContent = await page.textContent("body")
    expect(
      pageContent?.includes("incorrect") ||
      pageContent?.includes("indisponible") ||
      pageContent?.includes("erreur") ||
      pageContent?.includes("Erreur"),
    ).toBeTruthy()
  })

  test("password toggle switches input type", async ({ page }) => {
    await page.goto("/login")
    const passwordInput = page.locator("#password")
    await passwordInput.fill("secret123")

    // Initially password type
    await expect(passwordInput).toHaveAttribute("type", "password")

    // Click toggle
    const toggleBtn = page.locator("button[aria-label*='mot de passe' i]").first()
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
})
