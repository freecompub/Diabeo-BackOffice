/**
 * US-2270 — Gate du mode dev mocké.
 *
 * Décide si un **stub** doit remplacer un service externe (email, push, …) :
 * - **JAMAIS en production** (un service non configuré en prod doit échouer fort
 *   pour être détecté) ;
 * - `MOCK_MODE=true` force le stub (en dev/test uniquement) ;
 * - en **`development`**, on stub si la variable d'env du credential est absente
 *   (dev offline sans clés) ;
 * - en **`test`** (sans `MOCK_MODE`), on ne stube PAS par défaut : les tests
 *   unitaires mockent eux-mêmes les clients et asservissent le vrai chemin.
 *
 * **Fail-safe environnement** : seuls `development` et `test` peuvent activer un
 * stub. Tout autre cas — production, **staging** (le VPS de recette tourne avec
 * `NODE_ENV=production` + `APP_ENV=staging`, cf. `staging-guard.ts`), ou un
 * `NODE_ENV` absent/inconnu — est traité comme la prod et **refuse** le mock.
 * Conséquence assumée : **la recette utilise les vrais services** (Resend, FCM,
 * ClamAV), pas les stubs. Le mode mocké est réservé au dev local.
 *
 * Pur (lecture d'env uniquement) → importable côté serveur sans dépendance.
 *
 * NB : ce gate couvre les **stubs d'appels externes** (email/push/antivirus). Le
 * cache et l'idempotency ont leur PROPRE fail-open mémoire (cf. redis-cache.ts /
 * idempotency/service.ts), indépendant de ce gate — ne pas supposer que tout le
 * « mock » passe par ici.
 */
/**
 * Environnements où un stub peut s'activer. Tout le reste (prod, staging,
 * `NODE_ENV` absent/inconnu) = refus fail-safe. Point de vérité unique partagé
 * par {@link isDevMocked} et {@link isMockFlagOn}.
 */
function isMockableEnv(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
}

export function isDevMocked(credEnvKey: string): boolean {
  if (!isMockableEnv()) return false
  if (process.env.MOCK_MODE === "true") return true
  if (process.env.NODE_ENV === "development") return !process.env[credEnvKey]
  return false // test sans MOCK_MODE → vrai chemin (les tests mockent les clients)
}

/**
 * Variante pour les services pilotés par un **flag booléen explicite** (ex.
 * `MOCK_ANTIVIRUS`) plutôt que par l'absence d'un credential. Même fail-safe
 * environnement que {@link isDevMocked} (jamais en prod/staging/`NODE_ENV`
 * absent) ; `MOCK_MODE=true` l'active aussi.
 */
export function isMockFlagOn(flagEnvKey: string): boolean {
  if (!isMockableEnv()) return false
  return process.env.MOCK_MODE === "true" || process.env[flagEnvKey] === "true"
}
