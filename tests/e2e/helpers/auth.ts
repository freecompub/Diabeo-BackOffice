import type { BrowserContext, Page, APIRequestContext } from "@playwright/test"

/**
 * E2E auth helpers — login via API + cookie injection.
 *
 * Seed users (cf. `prisma/seed.ts`) :
 *   - admin@diabeo.test       / DEV-ONLY-Admin123!
 *   - docteur@diabeo.test     / DEV-ONLY-Doctor123!
 *   - infirmiere@diabeo.test  / DEV-ONLY-Nurse123!
 *   - patient.dt1@diabeo.test / DEV-ONLY-Patient123!
 *   - patient.dt2@diabeo.test / DEV-ONLY-Patient123!
 *
 * Pattern : POST /api/auth/login (JSON) → reçoit Set-Cookie httpOnly
 * `diabeo_token` → inject dans context Playwright pour requêtes
 * authentifiées (page.goto + request.get héritent du cookie).
 *
 * Plus rapide + plus fiable que form fill (évite flake CSS/timing).
 */

export type SeedUserRole = "admin" | "doctor" | "nurse" | "patient_dt1" | "patient_dt2"

interface SeedUser {
  email: string
  password: string
  role: "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"
}

const SEED_USERS: Record<SeedUserRole, SeedUser> = {
  admin: {
    email: "admin@diabeo.test",
    password: "DEV-ONLY-Admin123!",
    role: "ADMIN",
  },
  doctor: {
    email: "docteur@diabeo.test",
    password: "DEV-ONLY-Doctor123!",
    role: "DOCTOR",
  },
  nurse: {
    email: "infirmiere@diabeo.test",
    password: "DEV-ONLY-Nurse123!",
    role: "NURSE",
  },
  patient_dt1: {
    email: "patient.dt1@diabeo.test",
    password: "DEV-ONLY-Patient123!",
    role: "VIEWER",
  },
  patient_dt2: {
    email: "patient.dt2@diabeo.test",
    password: "DEV-ONLY-Patient123!",
    role: "VIEWER",
  },
}

/**
 * Login un user seed via POST /api/auth/login + inject cookie dans le
 * BrowserContext courant. Toutes les pages/requests subséquentes seront
 * authentifiées.
 *
 * @example
 *   test("...", async ({ page, context, request }) => {
 *     await loginAs(context, request, "doctor")
 *     await page.goto("/messages")
 *     // page maintenant authentifiée
 *   })
 */
export async function loginAs(
  context: BrowserContext,
  request: APIRequestContext,
  role: SeedUserRole,
): Promise<{ email: string; role: SeedUser["role"] }> {
  const user = SEED_USERS[role]
  // X-Requested-With requis par middleware CSRF (state-changing requests).
  const res = await request.post("/api/auth/login", {
    data: { email: user.email, password: user.password },
    headers: { "X-Requested-With": "XMLHttpRequest" },
  })
  if (!res.ok()) {
    throw new Error(
      `loginAs(${role}) failed : status ${res.status()} — ${await res.text()}`,
    )
  }
  // Récupère le cookie diabeo_token du Set-Cookie + inject dans le context
  // (partagé entre `page` et `request` pour requêtes subséquentes).
  const cookies = await request.storageState()
  const tokenCookie = cookies.cookies.find((c) => c.name === "diabeo_token")
  if (tokenCookie) {
    await context.addCookies([
      {
        name: "diabeo_token",
        value: tokenCookie.value,
        domain: tokenCookie.domain,
        path: tokenCookie.path,
        httpOnly: tokenCookie.httpOnly,
        secure: tokenCookie.secure,
        sameSite: tokenCookie.sameSite,
        expires: tokenCookie.expires,
      },
    ])
  }
  return { email: user.email, role: user.role }
}

/**
 * Navigate to a page AND wait for it to settle (loading completes).
 * Helper utilitaire pour tests qui dépendent du SSR + hydration.
 */
export async function gotoAuthenticated(
  page: Page,
  context: BrowserContext,
  request: APIRequestContext,
  role: SeedUserRole,
  path: string,
): Promise<void> {
  await loginAs(context, request, role)
  await page.goto(path)
}
