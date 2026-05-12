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

import { assertRequiredEnv } from "@/lib/env"

export async function register() {
  // M6 — defense-in-depth : skip uniquement si on est dans un vrai contexte
  // Vitest. `NODE_ENV === "test"` seul est trop large (un deploy mal-configuré
  // qui leak `NODE_ENV=test` désactiverait toute la validation silencieusement).
  // Vitest/Jest exposent toujours leur worker ID, donc on les détecte
  // explicitement.
  const isUnitTestRunner =
    process.env.NODE_ENV === "test" &&
    (process.env.VITEST !== undefined || process.env.JEST_WORKER_ID !== undefined)
  if (isUnitTestRunner) return

  // Skip explicit pour Edge runtime (pas de PrismaClient, validation
  // inutile — les API Edge n'utilisent pas les secrets validés ici).
  if (process.env.NEXT_RUNTIME === "edge") return

  // L5 — import statique (au lieu de dynamic) : meilleure analyse bundler
  // sans coût réel (la fonction early-return au-dessus si on skip).
  assertRequiredEnv()
}
