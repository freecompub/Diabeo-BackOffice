/**
 * @module instrumentation
 * @description Hook Next.js exécuté une fois au démarrage du runtime serveur.
 *
 * Utilisé pour la validation early-fail des secrets d'environnement.
 * Si une variable requise est manquante ou mal formée, le serveur refuse de
 * démarrer avec un message clair pointant vers `docs/local-development.md`.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  // Skip pendant les tests (Vitest gère son propre env via tests/setup.ts).
  if (process.env.NODE_ENV === "test") return

  // Seul le runtime Node.js exécute la validation (pas Edge — pas de PrismaClient).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertRequiredEnv } = await import("@/lib/env")
    assertRequiredEnv()
  }
}
