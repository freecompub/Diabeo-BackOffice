import "dotenv/config"
import { Pool } from "pg"
import { expect } from "@playwright/test"
import { createBdd } from "playwright-bdd"
// Source de vérité unique du HMAC email (évite toute divergence avec le code).
// `dotenv/config` ci-dessus charge HMAC_SECRET avant le 1er appel (lecture lazy).
import { hmacEmail } from "../../../../src/lib/crypto/hmac"

const { Then } = createBdd()

/**
 * Steps de vérification « effet base » — interrogent directement PostgreSQL.
 *
 * C'est ce qui distingue ces tests d'un simple test d'UI : on valide la ligne
 * `# Effet base:` des scénarios du plan QA (`docs/qa/`) contre la vraie base.
 *
 * Pré-requis : `.env` (DATABASE_URL + HMAC_SECRET) + Postgres seedé + dev server.
 * `dotenv/config` charge le `.env` à l'import du fichier de steps.
 */

let pool: Pool | null = null
function db(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      idleTimeoutMillis: 1000,
      allowExitOnIdle: true, // laisse le process Playwright se terminer
    })
  }
  return pool
}

const SEED_EMAIL: Record<string, string> = {
  ADMIN: "admin@diabeo.test",
  DOCTOR: "docteur@diabeo.test",
  NURSE: "infirmiere@diabeo.test",
  VIEWER: "patient.dt1@diabeo.test",
}

Then(
  "une session active existe en base pour {string}",
  // 1er param destructuré (même vide) — requis par playwright-bdd pour
  // inférer les fixtures ; ce step n'utilise aucune fixture Playwright.
  async ({}, role: string) => {
    const email = SEED_EMAIL[role]
    if (!email) throw new Error(`Rôle QA inconnu : "${role}"`)
    const { rows } = await db().query<{ n: string }>(
      `SELECT COUNT(*)::int AS n
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE u.email_hmac = $1 AND s.expires > NOW()`,
      [hmacEmail(email)],
    )
    expect(Number(rows[0].n)).toBeGreaterThan(0)
  },
)
