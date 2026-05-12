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
 * En tests Vitest, `assertRequiredEnv` n'est PAS appelé automatiquement —
 * les tests injectent leurs propres env vars via `setup.ts`.
 */

interface EnvSpec {
  name: string
  /** Validation supplémentaire après vérif de présence. Throw avec un message clair. */
  validate?: (value: string) => void
}

const REQUIRED: readonly EnvSpec[] = [
  { name: "DATABASE_URL" },
  {
    name: "HEALTH_DATA_ENCRYPTION_KEY",
    validate: (v) => {
      if (!/^[0-9a-fA-F]{64}$/.test(v)) {
        throw new Error(
          "HEALTH_DATA_ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes). " +
            "Generate via: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        )
      }
    },
  },
  {
    name: "HMAC_SECRET",
    validate: (v) => {
      // 32+ bytes en hex → 64+ chars. Pas d'enforcement strict du format pour
      // permettre passphrases en prod, mais on refuse les valeurs trop courtes.
      if (v.length < 32) {
        throw new Error(
          "HMAC_SECRET must be at least 32 characters (32 bytes recommended).",
        )
      }
    },
  },
  {
    name: "JWT_PRIVATE_KEY",
    validate: (v) => {
      if (!v.includes("BEGIN") || !v.includes("PRIVATE KEY")) {
        throw new Error(
          "JWT_PRIVATE_KEY must be a PEM-encoded RSA private key. " +
            "Generate via: openssl genrsa -out private.pem 2048",
        )
      }
    },
  },
  {
    name: "JWT_PUBLIC_KEY",
    validate: (v) => {
      if (!v.includes("BEGIN") || !v.includes("PUBLIC KEY")) {
        throw new Error(
          "JWT_PUBLIC_KEY must be a PEM-encoded RSA public key. " +
            "Generate via: openssl rsa -in private.pem -pubout -out public.pem",
        )
      }
    },
  },
]

/**
 * Throw avec un message clair si une variable requise est manquante ou invalide.
 * Idempotent — peut être appelé plusieurs fois sans effet de bord.
 *
 * @throws {Error} Avec liste détaillée des problèmes + lien vers la doc.
 */
export function assertRequiredEnv(): void {
  const problems: string[] = []

  for (const spec of REQUIRED) {
    const raw = process.env[spec.name]
    if (raw === undefined || raw.trim() === "") {
      problems.push(`  ✗ ${spec.name} is missing or empty`)
      continue
    }
    if (spec.validate) {
      try {
        spec.validate(raw)
      } catch (err) {
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
