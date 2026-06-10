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
 *
 * NB : ce gate couvre les **stubs d'appels externes** (email/push/antivirus). Le
 * cache et l'idempotency ont leur PROPRE fail-open mémoire (cf. redis-cache.ts /
 * idempotency/service.ts), indépendant de ce gate — ne pas supposer que tout le
 * « mock » passe par ici.
 */
export function isDevMocked(credEnvKey: string): boolean {
  if (process.env.NODE_ENV === "production") return false
  if (process.env.MOCK_MODE === "true") return true
  if (process.env.NODE_ENV === "development") return !process.env[credEnvKey]
  return false
}

/**
 * Variante pour les services pilotés par un **flag booléen explicite** (ex.
 * `MOCK_ANTIVIRUS`) plutôt que par l'absence d'un credential. **Jamais en prod**
 * (point de vérité unique partagé avec {@link isDevMocked}) ; `MOCK_MODE=true`
 * l'active aussi.
 */
export function isMockFlagOn(flagEnvKey: string): boolean {
  if (process.env.NODE_ENV === "production") return false
  return process.env.MOCK_MODE === "true" || process.env[flagEnvKey] === "true"
}
