import { test, expect } from "@playwright/test"
import { loginAs } from "../e2e/helpers/auth"

/**
 * Test manuel — wizard /patients/new (DOCTOR connecté).
 *
 * **Attendu métier** (cf. §6 fichier de session) : `POST /api/patients`
 * retourne **201 Created** avec `{ id, pathology }` puis le front
 * redirige sur `/patients/<id>`.
 *
 * **État backend actuel** : la route `/api/patients/route.ts` n'expose
 * que `GET`. Le POST renvoie 405 et le front affiche "Erreur serveur.
 * Réessayez.". Ce test **EST DONC ATTENDU EN ROUGE** tant que le
 * pipeline backend (User + chiffrement email + emailHmac + Patient +
 * PatientMedicalData + audit + RBAC + workflow d'invitation) n'est
 * pas livré.
 *
 * Le test reste en place pour servir de garde-fou contractuel : il
 * passera automatiquement vert quand la route POST sera implémentée
 * conformément à l'attendu métier (201 + redirect /patients/<id>).
 *
 * Lancement : `pnpm exec playwright test tests/manual/patients-new.spec.ts --headed`
 */

test.describe("Wizard /patients/new — DOCTOR (attendu métier 201)", () => {
  test("flow complet — i18n + wizard + 201 sur soumission", async ({
    page,
    context,
    request,
  }) => {
    // ─── Setup : login DOCTOR ────────────────────────────────────────
    await loginAs(context, request, "doctor")

    // ─── Capture des erreurs console (MISSING_MESSAGE, etc.) ─────────
    const consoleErrors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })

    // ─── Capture des requêtes /api/patients ──────────────────────────
    const postResponses: { url: string; status: number }[] = []
    page.on("response", (res) => {
      if (
        res.url().endsWith("/api/patients")
        && res.request().method() === "POST"
      ) {
        postResponses.push({ url: res.url(), status: res.status() })
      }
    })

    // ─── Navigation ─────────────────────────────────────────────────
    await page.goto("/patients/new")
    await expect(page).toHaveURL(/\/patients\/new$/)

    // ─── Step 1 : header i18n FR ─────────────────────────────────────
    // `getByRole heading level:1` matche 2 H1 (sidebar "Diabeo" + wizard).
    // On cible le H1 du wizard via son nom traduit.
    await expect(
      page.getByRole("heading", { level: 1, name: "Nouveau patient" }),
    ).toBeVisible()
    await expect(page.getByText("Etape 1 sur 2 — Identite")).toBeVisible()

    // ─── Step 1 : bouton "Suivant" désactivé tant que champs vides ──
    const nextBtn = page.getByRole("button", { name: "Suivant" })
    await expect(nextBtn).toBeDisabled()

    // ─── Step 1 : remplit identité ──────────────────────────────────
    const uniqueEmail = `test.patient.${Date.now()}@diabeo.test`
    await page.locator("#patient-email").fill(uniqueEmail)
    await page.locator("#patient-firstname").fill("Jean")
    await page.locator("#patient-lastname").fill("Test")
    await page.locator("#patient-sex").selectOption("M")
    await page.locator("#patient-birthday").fill("1985-03-15")

    // ─── Step 1 → 2 : Suivant activé ─────────────────────────────────
    await expect(nextBtn).toBeEnabled()
    await nextBtn.click()

    // ─── Step 2 : header progress bar ────────────────────────────────
    await expect(page.getByText("Etape 2 sur 2 — Pathologie")).toBeVisible()

    // ─── Step 2 : pathologie + année diag ───────────────────────────
    const dt1 = page.locator('input[name="pathology"][value="DT1"]')
    await expect(dt1).toBeChecked() // défaut DT1
    await page.locator("#patient-yeardiag").fill("2020")

    // ─── Soumission ─────────────────────────────────────────────────
    const submitBtn = page.getByRole("button", { name: "Creer le patient" })
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // ─── Backend : POST attendu en 201 (attendu métier) ─────────────
    // Note : la route POST n'existe pas encore (§6) — le serveur renvoie
    // 405. Ce test est donc ROUGE par design jusqu'à implémentation
    // backend. Quand la route POST renverra 201 avec body { id, pathology },
    // ce test passera vert sans modification supplémentaire.
    await page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/patients")
        && res.request().method() === "POST",
    )
    expect(postResponses).toHaveLength(1)
    expect(postResponses[0].status).toBe(201)

    // ─── Front : redirection vers la fiche patient créée ────────────
    // La page wizard fait `router.push(\`/patients/\${patient.id}\`)` après
    // un POST réussi. On vérifie que l'URL match `/patients/<id>`.
    await expect(page).toHaveURL(/\/patients\/\d+$/, { timeout: 5_000 })

    // ─── Garde-fou i18n : aucun MISSING_MESSAGE pendant le scénario ─
    const missingMsgErrors = consoleErrors.filter((e) =>
      e.includes("MISSING_MESSAGE"),
    )
    expect(
      missingMsgErrors,
      `${missingMsgErrors.length} clés i18n manquantes :\n${missingMsgErrors.join("\n")}`,
    ).toEqual([])
  })
})
