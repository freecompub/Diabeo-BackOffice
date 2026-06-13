/**
 * @module lib/auth/jwt-constants
 * @description Constantes JWT partagées entre `lib/auth/jwt.ts` (signature
 *   + verify côté API routes, runtime Node) et `middleware.ts` (verify côté
 *   Edge runtime).
 *
 * Pourquoi un module séparé : `lib/auth/jwt.ts` importe `node:crypto`
 * (pour `randomUUID`), ce qui le rend incompatible avec l'Edge runtime
 * où tourne le middleware. Sans cette source de vérité partagée, on
 * dupliquait les literals `"RS256"` / `"diabeo-backoffice"` / `"diabeo-hc"`
 * à plusieurs endroits (drift inévitable lors d'une rotation d'audience).
 *
 * Edge-safe : aucun import Node-only ici (uniquement des `as const`).
 */

export const JWT_ALG = "RS256"
export const JWT_ISSUER = "diabeo-backoffice"
export const JWT_AUDIENCE = "diabeo-hc"

/**
 * Options à passer à `jwtVerify` pour les sessions humaines (hc).
 *
 * Note : pas de `as const` ici. `jose.JWTVerifyOptions.algorithms` exige
 * un `string[]` mutable ; un tuple readonly fait échouer le typecheck.
 * Le drift est protégé par la dérivation depuis les constantes ci-dessus.
 */
export const JWT_VERIFY_OPTIONS = {
  algorithms: [JWT_ALG],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
}
