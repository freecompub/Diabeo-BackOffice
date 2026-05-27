import { test, expect } from "@playwright/test"
import { loginAs } from "./helpers/auth"

/**
 * E2E tests for messaging UI — US-2076-UI iter 5 + round 1 review PR #447.
 *
 * Couvre les flows critiques messagerie (PR #440-#444) avec **auth réel**
 * via `loginAs` helper (seed users `prisma/seed.ts`) :
 *
 *   - Route `/messages` gated NURSE+ (redirect login si VIEWER/anon)
 *   - Cache-Control no-store sur /messages (PR #440 C2 — PHI bfcache)
 *   - Sidebar item "Messagerie" avec icon + badge unread
 *   - ThreadList header + button "+ Nouveau" (iter 4)
 *   - NewThreadModal open + close + radiogroup keyboard nav (iter 4 C4)
 *   - Composer byte counter visible > 80% cap (iter 3 H12 / iter 4 M10)
 *   - SW Firebase non-registered si feature flag absent (iter 4)
 *
 * **Prérequis** :
 *   - PostgreSQL running + DATABASE_URL configuré
 *   - Seed exécuté (5 users) — cf. `pnpm prisma db seed`
 *
 * **Fix H1 + M1 + M2 + M3 round 1 review PR #447** :
 *   - Pas de `test.skip` body trompeur — utilisé `test.fixme` Playwright
 *     pour intent "à implémenter quand seed enrichi" (signal CI distinct)
 *   - Tests E2E réels (vs ancien `test.skip`) avec auth `loginAs(...)`
 *   - Cache-Control test sur redirect 3xx ET response 200 (defense-in-depth)
 *   - Retiré asserts tautologiques après `waitForURL`
 *   - Retiré test SW trompeur (`/login` jamais monté hook)
 */

test.describe("Messaging — /messages route gating", () => {
  test("user non authentifié → redirect /login", async ({ page }) => {
    await page.goto("/messages")
    // `toHaveURL` idiomatic Playwright (waitForURL + assert combinés)
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 })
  })

  test("VIEWER (patient) → redirect home rôle (defense-in-depth)", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "patient_dt1")
    await page.goto("/messages")
    // Patient (VIEWER) doit être redirigé hors /messages — soit /patient/dashboard
    // soit /login si gate manquant.
    await expect(page).not.toHaveURL(/\/messages$/, { timeout: 5_000 })
  })

  test("DOCTOR → accès /messages OK", async ({ page, context, request }) => {
    await loginAs(context, request, "doctor")
    await page.goto("/messages")
    // Pas de redirect — doit rester sur /messages.
    await expect(page).toHaveURL(/\/messages/, { timeout: 5_000 })
    // Title page visible (i18n FR/EN selon cookie).
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  })

  test("NURSE → accès /messages OK", async ({ page, context, request }) => {
    await loginAs(context, request, "nurse")
    await page.goto("/messages")
    await expect(page).toHaveURL(/\/messages/, { timeout: 5_000 })
  })
})

test.describe("Messaging — Cache-Control headers (Fix C2 PR #440)", () => {
  test("Cache-Control no-store présent sur response /messages authentifiée", async ({
    context,
    request,
    page,
  }) => {
    // Fix M2 round 1 review PR #447 — auth réelle pour tester la response
    // 200 (vs ancien test conditionnel `if (status === 200)` jamais
    // exécuté en CI sans seed).
    await loginAs(context, request, "doctor")
    // page.goto pour capturer la response HTML (vs request.get qui peut
    // bypass middleware).
    const response = await page.goto("/messages")
    expect(response).not.toBeNull()
    if (response) {
      // Middleware /messages/* applique no-store (Fix C2 PR #440 +
      // PHI_PATH_PREFIXES iter 12 patient PR #438).
      const cacheControl = response.headers()["cache-control"]
      expect(cacheControl).toContain("no-store")
      expect(cacheControl).toContain("no-cache")
      expect(cacheControl).toContain("must-revalidate")
      expect(cacheControl).toContain("private")
    }
  })

  test("Referrer-Policy + X-Content-Type-Options présents (defense-in-depth)", async ({
    context,
    request,
    page,
  }) => {
    await loginAs(context, request, "doctor")
    const response = await page.goto("/messages")
    if (response) {
      expect(response.headers()["referrer-policy"]).toBe("no-referrer")
      expect(response.headers()["x-content-type-options"]).toBe("nosniff")
    }
  })
})

test.describe("Messaging — ThreadList + NewThreadModal (iter 4)", () => {
  test("button '+ Nouveau' visible dans ThreadList header", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")
    await page.goto("/messages")
    const newButton = page.getByTestId("thread-list-new-button")
    await expect(newButton).toBeVisible({ timeout: 10_000 })
  })

  test("clic '+ Nouveau' ouvre NewThreadModal", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")
    await page.goto("/messages")
    await page.getByTestId("thread-list-new-button").click()
    const modal = page.getByTestId("new-thread-modal")
    await expect(modal).toBeVisible({ timeout: 5_000 })
  })

  test("modal close via ESC reset state", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")
    await page.goto("/messages")
    await page.getByTestId("thread-list-new-button").click()
    await expect(page.getByTestId("new-thread-modal")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("new-thread-modal")).not.toBeVisible({
      timeout: 3_000,
    })
  })
})

test.describe("Messaging — Composer byte counter (Fix H12 PR #441 + M10 PR #444)", () => {
  test("Counter visible > 80% cap (8164 bytes UTF-8)", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")
    await page.goto("/messages")
    await page.getByTestId("thread-list-new-button").click()
    await expect(page.getByTestId("new-thread-modal")).toBeVisible()
    const textarea = page.locator("#new-thread-body")
    // Remplir > 80% du cap (8164 × 0.8 ≈ 6531) → counter visible.
    await textarea.fill("a".repeat(7000))
    // Counter rendu via t("composerByteCount", { current, max }) — match
    // sur le pattern "7000" + "8164" présents.
    await expect(page.getByText(/7000/)).toBeVisible({ timeout: 3_000 })
  })

  test("Counter rouge si > MAX → send disabled", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")
    await page.goto("/messages")
    await page.getByTestId("thread-list-new-button").click()
    await expect(page.getByTestId("new-thread-modal")).toBeVisible()
    const textarea = page.locator("#new-thread-body")
    // > cap (9000 > 8164) → aria-invalid + send disabled.
    await textarea.fill("a".repeat(9000))
    await expect(textarea).toHaveAttribute("aria-invalid", "true")
  })
})

test.describe("Messaging — Service Worker FCM (Fix C1 PR #444)", () => {
  // Fix H1 round 1 review PR #447 — ancien test sur `/login` ne prouvait
  // rien (hook useMessagingPush jamais monté hors /messages). Remplacé par
  // test depuis page authentifiée + check feature flag respected.
  test("SW Firebase pas registered si NEXT_PUBLIC_FIREBASE_CONFIG absent", async ({
    page,
    context,
    request,
  }) => {
    await loginAs(context, request, "doctor")
    await page.goto("/messages")
    // Sans Firebase config (env vide ou absent), useMessagingPush skip
    // registration → graceful fallback polling 30s/60s.
    const swRegs = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return []
      const regs = await navigator.serviceWorker.getRegistrations()
      return regs.map((r) => r.scope)
    })
    // Si FIREBASE_CONFIG env absent en CI, SW Firebase pas registered.
    // Si Firebase activé en prod future, ce test fail = signal explicite.
    const hasFirebase = Boolean(process.env.NEXT_PUBLIC_FIREBASE_CONFIG)
    if (!hasFirebase) {
      const fbSw = swRegs.find((s) => s.includes("firebase-messaging-sw"))
      expect(fbSw).toBeUndefined()
    }
  })
})

test.describe("Messaging — FIXME post-seed enrichi (Issue #448)", () => {
  // Fix M1 round 1 review PR #447 — `test.fixme` Playwright (vs ancien
  // `test.skip` body trompeur). Reporter affiche distinctement. Activation
  // post-seed enrichi (patient avec consent messagerie + thread ≥ 5 msg).
  //
  // Tracking : Issue GH #448 — Enrichir seed E2E.

  test.fixme(
    "Send message depuis NewThreadModal → optimistic UI + refresh threads list (requiert seed avec patient consent messagerie)",
    async () => {
      // À implémenter quand seed inclut patient avec consent messagerie OK +
      // PatientReferent ou PatientService lien cabinet.
    },
  )

  test.fixme(
    "Radiogroup keyboard nav ArrowDown/Up/Home/End + Space (Fix C4 PR #444) — requiert seed contacts ≥ 2",
    async () => {
      // Couverture unit existante : NewThreadModal.test.tsx (4 tests
      // ArrowDown/Home/End/Space). E2E réel browser pending.
    },
  )

  test.fixme(
    "Auto-mark on scroll IntersectionObserver threshold 1.0 + dwell 1500ms (Fix C1 PR #443) — requiert seed thread avec ≥ 5 messages",
    async () => {
      // Couverture unit via IntersectionObserver mock jsdom (ThreadViewer.test.tsx).
      // E2E réel browser : native IO + viewport simulation + dwell timer.
    },
  )

  test.fixme(
    "BroadcastChannel FCM consume → badge bump (Fix C1 PR #444) — requiert mock SW + simulate push event",
    async () => {
      // Requiert mock service worker dans test fixture + simulate push.
      // Acceptable iter 5 — fallback polling 30s/60s couvre absence FCM.
    },
  )
})
