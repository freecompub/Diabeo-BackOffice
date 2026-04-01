import { test, expect } from "@playwright/test"

test.describe("Home page", () => {
  test("loads and displays heading", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveTitle(/Diabeo|Next/i)
    // Default Next.js page has the h1 with "get started"
    const heading = page.locator("h1")
    await expect(heading).toBeVisible()
  })

  test("has correct meta viewport for responsive", async ({ page }) => {
    await page.goto("/")
    const viewport = page.locator('meta[name="viewport"]')
    await expect(viewport).toHaveAttribute("content", /width=device-width/)
  })
})
