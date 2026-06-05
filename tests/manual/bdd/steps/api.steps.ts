import { expect } from "@playwright/test"
import { createBdd } from "playwright-bdd"
import { world } from "./world"

const { When, Then } = createBdd()

const JSON_HEADERS = { "Content-Type": "application/json" }
const CSRF_HEADERS = { ...JSON_HEADERS, "X-Requested-With": "XMLHttpRequest" }

// `page.request` partage les cookies du BrowserContext (cookie httpOnly
// `diabeo_token` injecté par loginAs dans le Given « je suis connecté »).

When("j'appelle GET {string}", async ({ page }, url: string) => {
  const res = await page.request.get(url)
  world.status = res.status()
  world.body = await res.json().catch(() => null)
})

When("je POST {string} avec le JSON:", async ({ page }, url: string, body: string) => {
  const res = await page.request.post(url, { headers: CSRF_HEADERS, data: JSON.parse(body) })
  world.status = res.status()
  world.body = await res.json().catch(() => null)
})

When(
  "je POST {string} sans en-tête CSRF avec le JSON:",
  async ({ page }, url: string, body: string) => {
    const res = await page.request.post(url, { headers: JSON_HEADERS, data: JSON.parse(body) })
    world.status = res.status()
    world.body = await res.json().catch(() => null)
  },
)

// Création patient avec email unique (idempotence des rejeux) + lien effet base.
When("je crée un patient avec un email unique", async ({ page }) => {
  world.createdEmail = `qa.bdd.${Date.now()}@diabeo.test`
  const res = await page.request.post("/api/patients", {
    headers: CSRF_HEADERS,
    data: {
      email: world.createdEmail,
      firstName: "QA",
      lastName: "BDD",
      pathology: "DT1",
    },
  })
  world.status = res.status()
  world.body = await res.json().catch(() => null)
})

Then("le statut de la réponse est {int}", async ({}, code: number) => {
  expect(world.status).toBe(code)
})

Then("le corps contient {string}", async ({}, text: string) => {
  expect(JSON.stringify(world.body)).toContain(text)
})
