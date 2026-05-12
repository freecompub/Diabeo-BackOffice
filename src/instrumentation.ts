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

  // Skip explicit pour Edge runtime (pas de PrismaClient, validation
  // inutile — les API Edge n'utilisent pas les secrets validés ici).
  if (process.env.NEXT_RUNTIME === "edge") return

  // Tous les autres cas (nodejs explicite OU undefined par défaut) :
  // on assert. Évite un trou silencieux si Next.js n'expose pas
  // NEXT_RUNTIME pour une raison ou une autre.
  const { assertRequiredEnv } = await import("@/lib/env")
  assertRequiredEnv()
}
