/**
 * Test suite: Seed ↔ Runtime HMAC consistency
 *
 * Behavior tested:
 * - `prisma/seed.ts` importe `hmacEmail` du même module que le runtime
 *   (`src/lib/crypto/hmac.ts`) — pas de réplique locale.
 *
 * Risk mitigated:
 * - Si quelqu'un re-créé une fonction `hmacEmail` locale dans seed.ts (ex:
 *   pour ajouter un fallback fixe en dev), seed et runtime divergent →
 *   401 invalidCredentials au login après seed.
 *
 * Edge cases couverts par le runtime (`crypto/hmac.ts` tests):
 *  - lowercase + trim normalization
 *  - throw si HMAC_SECRET absent
 *  - HMAC-SHA256 hex output 64 chars
 *
 * Ce test garantit juste que le seed UTILISE ce helper, pas qu'il
 * implémente correctement le HMAC (couvert ailleurs).
 */
import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"

const SEED_FILE = path.join(__dirname, "..", "..", "prisma", "seed.ts")

describe("seed.ts uses the runtime hmacEmail (no local replica)", () => {
  const source = fs.readFileSync(SEED_FILE, "utf8")

  it("imports hmacEmail from src/lib/crypto/hmac", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bhmacEmail\b[^}]*\}\s*from\s*["'](?:\.\.\/)+src\/lib\/crypto\/hmac["']/,
    )
  })

  it("does NOT define a local hmacEmail function (would diverge from runtime)", () => {
    // Une seule mention du nom hmacEmail dans la fonction = OK.
    // Le motif "function hmacEmail" ou "const hmacEmail =" = divergence.
    expect(source).not.toMatch(/function\s+hmacEmail\s*\(/)
    expect(source).not.toMatch(/(?:const|let|var)\s+hmacEmail\s*=/)
  })

  it("does NOT define a fallback HMAC_KEY (RGPD violation if seed runs without HMAC_SECRET)", () => {
    expect(source).not.toMatch(/HMAC_KEY\s*=\s*process\.env\.HMAC_SECRET\s*\?\?/)
    expect(source).not.toMatch(/dev-seed-hmac-key-not-for-production/)
  })
})

/**
 * RR3 (review round 2 PR #479) — Depuis #474, le seed dépend aussi de
 * `hmacField` (firstnameHmac/lastnameHmac → recherche patient) et de
 * `encryptField` (chiffrement PII). Ces deux helpers ont la même criticité que
 * `hmacEmail` : une réplique locale accidentelle produirait un seed fonctionnel
 * mais incohérent avec le runtime (recherche cassée / champs indéchiffrables).
 */
describe("seed.ts uses the runtime hmacField + encryptField (no local replica)", () => {
  const source = fs.readFileSync(SEED_FILE, "utf8")

  it("imports hmacField from src/lib/crypto/hmac", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bhmacField\b[^}]*\}\s*from\s*["'](?:\.\.\/)+src\/lib\/crypto\/hmac["']/,
    )
  })

  it("imports encryptField from src/lib/crypto/fields", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\bencryptField\b[^}]*\}\s*from\s*["'](?:\.\.\/)+src\/lib\/crypto\/fields["']/,
    )
  })

  it("does NOT define a local hmacField / encryptField (would diverge from runtime)", () => {
    expect(source).not.toMatch(/function\s+hmacField\s*\(/)
    expect(source).not.toMatch(/(?:const|let|var)\s+hmacField\s*=/)
    expect(source).not.toMatch(/function\s+encryptField\s*\(/)
    expect(source).not.toMatch(/(?:const|let|var)\s+encryptField\s*=/)
  })
})
