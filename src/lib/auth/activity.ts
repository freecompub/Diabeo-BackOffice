/**
 * US-2621 — Timeout d'inactivité par **session glissante Redis** (« activité réelle »).
 *
 * Une clé `sess:<sid>` avec TTL = fenêtre d'inactivité est créée au login/MFA
 * (`startActivity`) puis **rafraîchie à chaque requête** par le middleware
 * (`slideActivity`, `SET … EX … XX` = only-if-exists). Si la clé a expiré (aucune
 * requête pendant la fenêtre), `slideActivity` renvoie `timedOut` → accès refusé.
 *
 * Avantages vs `lastSeenAt` en base : vraie inactivité par requête, **zéro
 * écriture DB**, compatible **middleware Edge** (Upstash = HTTP). Une seule op
 * Redis par requête. **Fail-closed** sur erreur Redis (cohérent `isSessionRevoked`).
 *
 * Périmètre : **rôles backoffice uniquement** ; `VIEWER` (patient, multi-appareils)
 * n'a pas de clé d'activité (`inactivityWindowSeconds` renvoie `null`).
 */

import { getRedis, REDIS_APP_PREFIX } from "./redis-client"

const ACTIVITY_PREFIX = `${REDIS_APP_PREFIX}sess:`

/** Fenêtres d'inactivité (secondes) — renforcée pour `ADMIN`. */
const WINDOW_BACKOFFICE_SECONDS = 30 * 60
const WINDOW_ADMIN_SECONDS = 15 * 60

export type ActivityResult = "active" | "timedOut"

/**
 * Fenêtre d'inactivité applicable à un rôle, ou `null` si non soumis (patient
 * `VIEWER` : sessions multi-appareils, pas de timeout backoffice).
 */
export function inactivityWindowSeconds(role: string): number | null {
  if (role === "VIEWER") return null
  if (role === "ADMIN") return WINDOW_ADMIN_SECONDS
  return WINDOW_BACKOFFICE_SECONDS // DOCTOR / NURSE
}

/** Ouvre la fenêtre d'activité d'une session (login / MFA challenge). No-op si Redis off. */
export async function startActivity(sid: string, windowSeconds: number): Promise<void> {
  const client = getRedis()
  if (!client) return
  try {
    await client.set(`${ACTIVITY_PREFIX}${sid}`, "1", { ex: windowSeconds })
  } catch (err) {
    console.error("[activity] start failed:", err instanceof Error ? err.message : "unknown")
  }
}

/**
 * Rafraîchit la fenêtre (only-if-exists) et signale l'inactivité.
 * @returns `timedOut` si la clé n'existe plus (fenêtre dépassée) **ou** sur erreur
 *          Redis (fail-closed) ; `active` sinon, ou si Redis non configuré (dev/test).
 */
export async function slideActivity(sid: string, windowSeconds: number): Promise<ActivityResult> {
  const client = getRedis()
  if (!client) return "active" // non configuré (dev/test) → check ignoré
  try {
    // SET … EX … XX : renouvelle le TTL uniquement si la clé existe encore.
    const res = await client.set(`${ACTIVITY_PREFIX}${sid}`, "1", { ex: windowSeconds, xx: true })
    return res === null ? "timedOut" : "active"
  } catch {
    console.error("[activity] Redis unavailable — failing closed (session treated as timed out)")
    return "timedOut"
  }
}

/** Supprime la fenêtre d'activité (logout). No-op si Redis off / erreur. */
export async function clearActivity(sid: string): Promise<void> {
  const client = getRedis()
  if (!client) return
  try {
    await client.del(`${ACTIVITY_PREFIX}${sid}`)
  } catch (err) {
    console.error("[activity] clear failed:", err instanceof Error ? err.message : "unknown")
  }
}
