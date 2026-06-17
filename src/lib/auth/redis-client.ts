/**
 * Client Upstash Redis partagé (révocation de session + session glissante
 * d'inactivité). Upstash utilise HTTP/fetch → compatible Edge **et** Node, donc
 * utilisable depuis le middleware (qui ne peut pas lire la base).
 *
 * Source unique du client + du préfixe de clés ; consommé par `revocation.ts`
 * (clés `revoked:<sid>`) et `activity.ts` (clés `sess:<sid>`).
 */

import { Redis } from "@upstash/redis"

/** Préfixe scopé par environnement pour éviter les collisions de clés. */
export const REDIS_APP_PREFIX = process.env.REDIS_KEY_PREFIX ?? "diabeo:prod:"

let redis: Redis | null = null

/** Client Upstash, ou `null` si non configuré (dev/test). */
export function getRedis(): Redis | null {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

/** Réinitialise le client mémoïsé. Test-only. @internal */
export function _resetRedisForTesting(): void {
  redis = null
}
