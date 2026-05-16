/**
 * Test suite: env early-fail validation
 *
 * Behavior tested:
 * - `assertRequiredEnv()` throws avec message clair quand une variable
 *   requise est manquante.
 * - Format validations (HEX 64 chars, PEM, length min) sont vérifiées
 *   après la présence.
 * - Messages d'erreur référencent docs/local-development.md §3 pour
 *   guider l'opérateur.
 *
 * Risk mitigated:
 * - Boot silencieux avec secret manquant → 503 au login (cause initiale
 *   du fix #7 de cette PR). Le helper doit attraper ça AU DÉMARRAGE.
 * - Un secret mal formé (hex trop court, PEM tronqué) doit throw avant
 *   le premier `encrypt()` ou `signJwt()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { generateKeyPairSync, randomBytes } from "node:crypto"
import { assertRequiredEnv } from "@/lib/env"

// Valeurs valides — utilisées comme baseline pour tester un seul champ
// invalide à la fois.
//
// HMAC + ENCRYPTION : vraie randomBytes(32) hex → matche les nouvelles
// validations (regex hex 64 chars + Shannon entropy floor).
// JWT : vraie paire RSA générée au module-load → matche createPrivateKey /
// createPublicKey de Node crypto utilisés dans env.ts.
const VALID_ENCRYPT_KEY = randomBytes(32).toString("hex")
const VALID_HMAC = randomBytes(32).toString("hex")

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
})
const VALID_PRIV_PEM = privateKey
const VALID_PUB_PEM = publicKey

function setupValidEnv() {
  vi.stubEnv("DATABASE_URL", "postgresql://x:y@localhost:5432/z")
  vi.stubEnv("HEALTH_DATA_ENCRYPTION_KEY", VALID_ENCRYPT_KEY)
  vi.stubEnv("HMAC_SECRET", VALID_HMAC)
  // US-2076 HIGH-2 round 5 — pepper HMAC conversation_key (64 hex chars).
  vi.stubEnv(
    "CONVERSATION_KEY_PEPPER",
    "a".repeat(32) + "b".repeat(16) + "c".repeat(16),
  )
  // US-2026 H1 round 2 — pepper HMAC audit anonymisation (64 hex chars).
  vi.stubEnv(
    "AUDIT_PEPPER",
    "d".repeat(16) + "e".repeat(32) + "f".repeat(16),
  )
  // US-2108 H10 round 2 — Bearer secret cron /api/cron/* (64 hex chars).
  vi.stubEnv(
    "CRON_SECRET",
    "a".repeat(16) + "b".repeat(32) + "c".repeat(16),
  )
  vi.stubEnv("JWT_PRIVATE_KEY", VALID_PRIV_PEM)
  vi.stubEnv("JWT_PUBLIC_KEY", VALID_PUB_PEM)
}

describe("assertRequiredEnv", () => {
  beforeEach(() => setupValidEnv())
  afterEach(() => vi.unstubAllEnvs())

  it("does not throw when all required vars are set and valid", () => {
    expect(() => assertRequiredEnv()).not.toThrow()
  })

  it("throws when DATABASE_URL is missing", () => {
    vi.stubEnv("DATABASE_URL", "")
    expect(() => assertRequiredEnv()).toThrow(/DATABASE_URL is missing or empty/)
  })

  it("throws when DATABASE_URL is only whitespace", () => {
    vi.stubEnv("DATABASE_URL", "   ")
    expect(() => assertRequiredEnv()).toThrow(/DATABASE_URL is missing or empty/)
  })

  it("rejects HEALTH_DATA_ENCRYPTION_KEY with wrong length (32 chars instead of 64)", () => {
    vi.stubEnv("HEALTH_DATA_ENCRYPTION_KEY", "a".repeat(32))
    expect(() => assertRequiredEnv()).toThrow(/64 hex chars/)
  })

  it("rejects HEALTH_DATA_ENCRYPTION_KEY with non-hex chars", () => {
    vi.stubEnv("HEALTH_DATA_ENCRYPTION_KEY", "z".repeat(64))
    expect(() => assertRequiredEnv()).toThrow(/64 hex chars/)
  })

  it("rejects HMAC_SECRET shorter than 32 bytes", () => {
    vi.stubEnv("HMAC_SECRET", "too-short")
    expect(() => assertRequiredEnv()).toThrow(/at least 32 bytes/)
  })

  it("rejects HMAC_SECRET with low entropy (M1 — refuses 'a'×64)", () => {
    vi.stubEnv("HMAC_SECRET", "a".repeat(64))
    expect(() => assertRequiredEnv()).toThrow(/insufficient entropy/)
  })

  // R6-LOW-1 review round 6 — US-2076 HIGH-2 conversation_key pepper.
  it("rejects CONVERSATION_KEY_PEPPER missing", () => {
    vi.stubEnv("CONVERSATION_KEY_PEPPER", "")
    expect(() => assertRequiredEnv()).toThrow(/CONVERSATION_KEY_PEPPER/)
  })

  it("rejects CONVERSATION_KEY_PEPPER too short (< 64 hex chars)", () => {
    vi.stubEnv("CONVERSATION_KEY_PEPPER", "a".repeat(32))
    expect(() => assertRequiredEnv()).toThrow(/at least 64 hex chars/)
  })

  it("rejects CONVERSATION_KEY_PEPPER non-hex chars", () => {
    vi.stubEnv("CONVERSATION_KEY_PEPPER", "z".repeat(64))
    expect(() => assertRequiredEnv()).toThrow(/at least 64 hex chars/)
  })

  // US-2026 H1 round 2 — AUDIT_PEPPER validation.
  it("rejects AUDIT_PEPPER missing", () => {
    vi.stubEnv("AUDIT_PEPPER", "")
    expect(() => assertRequiredEnv()).toThrow(/AUDIT_PEPPER/)
  })

  it("rejects AUDIT_PEPPER too short (< 64 hex chars)", () => {
    vi.stubEnv("AUDIT_PEPPER", "a".repeat(32))
    expect(() => assertRequiredEnv()).toThrow(/at least 64 hex chars/)
  })

  it("rejects AUDIT_PEPPER non-hex chars", () => {
    vi.stubEnv("AUDIT_PEPPER", "z".repeat(64))
    expect(() => assertRequiredEnv()).toThrow(/at least 64 hex chars/)
  })

  // US-2108 H10 round 2 — CRON_SECRET validation.
  it("rejects CRON_SECRET missing", () => {
    vi.stubEnv("CRON_SECRET", "")
    expect(() => assertRequiredEnv()).toThrow(/CRON_SECRET/)
  })

  it("rejects CRON_SECRET too short (< 64 hex chars)", () => {
    vi.stubEnv("CRON_SECRET", "a".repeat(32))
    expect(() => assertRequiredEnv()).toThrow(/at least 64 hex chars/)
  })

  it("rejects CRON_SECRET low entropy (all-same-char)", () => {
    vi.stubEnv("CRON_SECRET", "a".repeat(64))
    expect(() => assertRequiredEnv()).toThrow(/insufficient entropy/)
  })

  it("rejects JWT_PRIVATE_KEY without PEM markers", () => {
    vi.stubEnv("JWT_PRIVATE_KEY", "not-a-pem-key")
    expect(() => assertRequiredEnv()).toThrow(/PEM-encoded private key/)
  })

  it("rejects JWT_PRIVATE_KEY with PEM markers but invalid content (M2)", () => {
    vi.stubEnv(
      "JWT_PRIVATE_KEY",
      "-----BEGIN PRIVATE KEY-----\nXXX\n-----END PRIVATE KEY-----\n",
    )
    expect(() => assertRequiredEnv()).toThrow(/could not be parsed/)
  })

  it("rejects JWT_PUBLIC_KEY without PEM markers", () => {
    vi.stubEnv("JWT_PUBLIC_KEY", "not-a-pem-key")
    expect(() => assertRequiredEnv()).toThrow(/PEM-encoded public key/)
  })

  it("rejects JWT_PUBLIC_KEY with PEM markers but invalid content (M2)", () => {
    vi.stubEnv(
      "JWT_PUBLIC_KEY",
      "-----BEGIN PUBLIC KEY-----\nXXX\n-----END PUBLIC KEY-----\n",
    )
    expect(() => assertRequiredEnv()).toThrow(/could not be parsed/)
  })

  it("error message references docs/local-development.md §3", () => {
    vi.stubEnv("DATABASE_URL", "")
    // M9 — pattern uniforme expect().toThrow() (au lieu de try/catch + cast).
    expect(() => assertRequiredEnv()).toThrow(/docs\/local-development\.md/)
  })

  it("collects ALL problems before throwing (not just the first)", () => {
    vi.stubEnv("DATABASE_URL", "")
    vi.stubEnv("HMAC_SECRET", "")
    expect(() => assertRequiredEnv()).toThrow(/DATABASE_URL/)
    // Re-throw pour le second match — Vitest toThrow ne chain pas.
    expect(() => assertRequiredEnv()).toThrow(/HMAC_SECRET/)
  })

  it("L4 — validator error messages never echo the secret value", () => {
    // Si un futur dev interpole `v` dans le message d'erreur, le secret leak
    // dans les logs (boot + stack traces). Ce test verrouille le contrat.
    const sentinelSecret = "PR356-SENTINEL-DO-NOT-LEAK-abcdef123456789012345678"
    vi.stubEnv("HMAC_SECRET", sentinelSecret)
    // Le HMAC_SECRET ci-dessus est valide (>32 bytes, entropy OK) donc on
    // utilise un autre champ pour faire fail la validation : invalid hex
    // pour la clé d'encryption.
    vi.stubEnv("HEALTH_DATA_ENCRYPTION_KEY", "z".repeat(64))
    try {
      assertRequiredEnv()
      throw new Error("expected throw")
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).not.toContain(sentinelSecret)
      expect(msg).not.toContain("z".repeat(64))
    }
  })

  it("is idempotent (multiple calls with same valid env both pass)", () => {
    expect(() => assertRequiredEnv()).not.toThrow()
    expect(() => assertRequiredEnv()).not.toThrow()
  })
})
