/**
 * US-2270 — Gate du mode dev mocké.
 *
 * Décide si un **stub** doit remplacer un service externe (email, push, …) :
 * - **JAMAIS en production** (un service non configuré en prod doit échouer fort
 *   pour être détecté) ;
 * - `MOCK_MODE=true` force le stub (hors prod) ;
 * - en **`development`**, on stub si la variable d'env du credential est absente
 *   (dev offline sans clés) ;
 * - en **`test`** (et autres), on ne stube PAS par défaut : les tests unitaires
 *   mockent eux-mêmes les clients et asservissent le vrai chemin (ils activent
 *   `MOCK_MODE`/`development` explicitement pour tester un stub).
 *
 * Pur (lecture d'env uniquement) → importable côté serveur sans dépendance.
 */
export function isDevMocked(credEnvKey: string): boolean {
  if (process.env.NODE_ENV === "production") return false
  if (process.env.MOCK_MODE === "true") return true
  if (process.env.NODE_ENV === "development") return !process.env[credEnvKey]
  return false
}
