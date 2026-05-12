/**
 * @module env
 * @description Validate les variables d'environnement requises au démarrage.
 *
 * **Pourquoi** : sans ça, un secret manquant ou mal formé produit un 503 ou
 * un crash mystérieux loin du point d'origine — typiquement au moment d'un
 * `encrypt()` qui throw "Invalid key length", ou d'un `hmacEmail()` qui
 * remonte "HMAC_SECRET is not set". L'opérateur (ou un dev local) ne sait pas
 * tout de suite quoi fixer.
 *
 * Solution : valider tout au boot et crasher avec un message clair pointant
 * vers `docs/local-development.md`. Branché via `src/instrumentation.ts`
 * (hook Next.js exécuté une fois au démarrage du runtime).
 *
 * Deux entry points :
 *  - `assertRequiredEnv()` — exigence FULL (serveur Next.js : tous les secrets)
 *  - `assertSeedEnv()` — exigence MINIMALE pour `prisma db seed` (HMAC +
 *    HEALTH_DATA_ENCRYPTION_KEY, pas de JWT)
 *
 * En tests Vitest, ces helpers ne sont PAS appelés automatiquement —
 * les tests injectent leurs propres env vars via `tests/helpers/setup.ts`.
 *
 * **Validators are not allowed to interpolate the secret value into their
 * error messages** — risque de leak dans les logs. Les tests vérifient ce
 * contrat.
 */

import { createPrivateKey, createPublicKey } from "node:crypto"

interface EnvSpec {
  name: string
  /**
   * Validation supplémentaire après vérif de présence.
   * Throw avec un message clair (jamais interpoler la valeur — risque leak).
   */
  validate?: (value: string) => void
}

/**
 * Heuristique de validation d'entropy minimale (Shannon).
 * Une chaîne de 32+ chars avec moins de ~3 bits/char (= ~12 chars uniques sur
 * 32) est probablement un pattern trivial (`"a".repeat(32)`, `"abc".repeat`,
 * date string, etc.). Empêche les configs prod faibles sans imposer un format
 * strict (permet passphrases dictionnaires multi-mots qui restent OK).
 */
function shannonEntropyBits(s: string): number {
  if (s.length === 0) return 0
  const freq = new Map<string, number>()
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let H = 0
  for (const count of freq.values()) {
    const p = count / s.length
    H -= p * Math.log2(p)
  }
  return H * s.length
}

const HMAC_MIN_BYTES = 32
const HMAC_MIN_ENTROPY_BITS = 96 // ~3 bits/char × 32 chars min

const PEM_PRIVATE_RE =
  /^-----BEGIN ([A-Z]+ )?PRIVATE KEY-----\s*[\s\S]+?\s*-----END ([A-Z]+ )?PRIVATE KEY-----\s*$/
const PEM_PUBLIC_RE =
  /^-----BEGIN ([A-Z]+ )?PUBLIC KEY-----\s*[\s\S]+?\s*-----END ([A-Z]+ )?PUBLIC KEY-----\s*$/

const SPEC_DATABASE_URL: EnvSpec = { name: "DATABASE_URL" }

const SPEC_ENCRYPTION_KEY: EnvSpec = {
  name: "HEALTH_DATA_ENCRYPTION_KEY",
  validate: (v) => {
    if (!/^[0-9a-fA-F]{64}$/.test(v)) {
      throw new Error(
        "HEALTH_DATA_ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes). " +
          "Generate via: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      )
    }
  },
}

const SPEC_HMAC_SECRET: EnvSpec = {
  name: "HMAC_SECRET",
  validate: (v) => {
    // M7 — compte les bytes UTF-8, pas les UTF-16 code units (qui peuvent
    // sur-estimer pour les chars multi-byte).
    const bytes = Buffer.byteLength(v, "utf8")
    if (bytes < HMAC_MIN_BYTES) {
      throw new Error(
        `HMAC_SECRET must be at least ${HMAC_MIN_BYTES} bytes UTF-8 (32 bytes recommended). ` +
          "Generate via: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      )
    }
    // M1 — entropy floor : refuse "a".repeat(64) ou "0".repeat(64).
    if (shannonEntropyBits(v) < HMAC_MIN_ENTROPY_BITS) {
      throw new Error(
        `HMAC_SECRET has insufficient entropy (< ${HMAC_MIN_ENTROPY_BITS} bits Shannon). ` +
          "Looks like a low-entropy pattern. Generate via crypto.randomBytes(32).toString('hex').",
      )
    }
  },
}

const SPEC_JWT_PRIVATE_KEY: EnvSpec = {
  name: "JWT_PRIVATE_KEY",
  validate: (v) => {
    if (!PEM_PRIVATE_RE.test(v)) {
      throw new Error(
        "JWT_PRIVATE_KEY must be a PEM-encoded private key with proper BEGIN/END markers. " +
          "Generate via: openssl genrsa -out private.pem 2048",
      )
    }
    // M2 — parse réel via Node crypto : refuse les PEMs syntaxiquement OK
    // mais sémantiquement invalides (b64 corrompu, ASN.1 mal formé, etc.).
    try {
      createPrivateKey(v)
    } catch {
      // Pas de re-throw avec le message original (peut leak des fragments PEM).
      throw new Error(
        "JWT_PRIVATE_KEY could not be parsed as a valid private key " +
          "(check BEGIN/END markers, base64 integrity, key type).",
      )
    }
  },
}

const SPEC_JWT_PUBLIC_KEY: EnvSpec = {
  name: "JWT_PUBLIC_KEY",
  validate: (v) => {
    if (!PEM_PUBLIC_RE.test(v)) {
      throw new Error(
        "JWT_PUBLIC_KEY must be a PEM-encoded public key with proper BEGIN/END markers. " +
          "Generate via: openssl rsa -in private.pem -pubout -out public.pem",
      )
    }
    try {
      createPublicKey(v)
    } catch {
      throw new Error(
        "JWT_PUBLIC_KEY could not be parsed as a valid public key " +
          "(check BEGIN/END markers, base64 integrity, key type).",
      )
    }
  },
}

/** Full server-side requirement (Next.js boot via instrumentation.ts). */
const REQUIRED_FULL: readonly EnvSpec[] = [
  SPEC_DATABASE_URL,
  SPEC_ENCRYPTION_KEY,
  SPEC_HMAC_SECRET,
  SPEC_JWT_PRIVATE_KEY,
  SPEC_JWT_PUBLIC_KEY,
]

/**
 * Subset minimal pour `prisma db seed` : pas besoin de JWT (le seed ne signe
 * pas de tokens) mais HMAC_SECRET + HEALTH_DATA_ENCRYPTION_KEY OBLIGATOIRES :
 * sans eux, le seed produirait des `emailHmac` avec une clé fallback
 * prévisible et du PHI non-chiffré (RGPD Art. 32 violation).
 */
const REQUIRED_SEED: readonly EnvSpec[] = [
  SPEC_DATABASE_URL,
  SPEC_HMAC_SECRET,
  SPEC_ENCRYPTION_KEY,
]

function assertSpecs(specs: readonly EnvSpec[]): void {
  const problems: string[] = []

  for (const spec of specs) {
    const raw = process.env[spec.name]
    if (raw === undefined || raw.trim() === "") {
      problems.push(`  ✗ ${spec.name} is missing or empty`)
      continue
    }
    if (spec.validate) {
      try {
        spec.validate(raw)
      } catch (err) {
        // Le message d'erreur du validator est conçu pour ne PAS contenir
        // la valeur (testé). Si un futur dev casse ce contrat, le test
        // env.test.ts "validator messages must not echo the secret value"
        // capture la régression.
        const msg = err instanceof Error ? err.message : String(err)
        problems.push(`  ✗ ${spec.name}: ${msg}`)
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      [
        "Required environment variables are missing or invalid:",
        ...problems,
        "",
        "See docs/local-development.md §3 for setup instructions.",
      ].join("\n"),
    )
  }
}

/**
 * Validation complète des secrets serveur — appelée au boot Next.js
 * via `src/instrumentation.ts`.
 *
 * @throws {Error} Avec liste détaillée des problèmes + lien vers la doc.
 */
export function assertRequiredEnv(): void {
  assertSpecs(REQUIRED_FULL)
}

/**
 * C1 + C2 fix — validation minimale pour `prisma db seed`.
 *
 * Le seed est un entrypoint Node séparé, donc `instrumentation.ts` ne le
 * couvre pas. Sans cet appel, un opérateur qui run `pnpm prisma db seed`
 * sans `HMAC_SECRET` exporté obtient des users avec `emailHmac` calculé
 * via la clé fallback `"dev-seed-hmac-key-not-for-production"` — clé
 * publique du repo, donc emailHmac dérivable offline = RGPD Art. 32 cassée.
 *
 * Cet helper hard-fail au démarrage du seed avant toute écriture DB.
 */
export function assertSeedEnv(): void {
  assertSpecs(REQUIRED_SEED)
}
