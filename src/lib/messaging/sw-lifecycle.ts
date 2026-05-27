/**
 * Service Worker lifecycle helpers — messagerie FCM (US-2076).
 *
 * Module pur (pas de React, pas d'imports `useEffect`/`useState`) — découplé
 * de `useMessagingPush` pour éviter le couplage cross-domain `useAuth` →
 * `@/components/diabeo/messaging/...`.
 *
 * Fix HSA H4 round 1 review PR #449 (Issue #446) — auth est transversal ;
 * extraire le helper logout-cleanup dans `@/lib/messaging/` élimine le cycle
 * potentiel ES module + bundle bloat (useMessagingPush n'est plus chargé sur
 * les pages non-messaging comme `(auth)/login`).
 *
 * Le module conserve le singleton `swRegistrationPromise` partagé avec
 * `useMessagingPush` via `getOrCreateSwRegistration` / `resetSwRegistration`
 * (StrictMode double-mount + multi-tab dedup HSA M2 PR #444).
 */

const SW_SCRIPT_URL = "/firebase-messaging-sw.js"

// Singleton module-level — garde HSA M2 round 1 PR #444 (StrictMode + multi
// tab). Browser dedupe par scope déjà, mais éliminer le bruit telemetry.
let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null

/**
 * Register le service worker FCM (ou retourne le singleton existant).
 * Appelé par `useMessagingPush` au mount du Provider messagerie.
 */
export function getOrCreateSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null)
  }
  swRegistrationPromise ??= navigator.serviceWorker.register(SW_SCRIPT_URL, {
    updateViaCache: "none",
  })
  return swRegistrationPromise
}

/**
 * Unregister le SW messaging + reset singleton (logout flow Issue #446).
 *
 * Fix HSA gestion fin de session HDS Art. L.1111-8 — sur poste partagé
 * cabinet multi-PS, le SW reste registered tant qu'il n'est pas unregistered
 * explicitement : prochain user reçoit les push FCM du PS sortant.
 *
 * **Pattern fire-and-forget** : ne throw jamais. Logout flow appelle dans
 * un try/catch + `logLogoutCleanupError` (observabilité C1) — mais ici le
 * helper absorbe en silence pour rester simple côté caller.
 *
 * @returns `{ unregistered: true }` si SW était registered et unregister OK,
 *          `{ unregistered: false, reason }` sinon (sw absent / unsupported /
 *          erreur browser). Le caller peut logger `reason` pour observability.
 */
export async function unregisterMessagingServiceWorker(): Promise<
  { unregistered: true } | { unregistered: false; reason: SwUnregisterFailReason }
> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return { unregistered: false, reason: "unsupported" }
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCRIPT_URL)
    if (!reg) {
      swRegistrationPromise = null
      return { unregistered: false, reason: "not_registered" }
    }
    const ok = await reg.unregister()
    swRegistrationPromise = null
    return ok ? { unregistered: true } : { unregistered: false, reason: "browser_refused" }
  } catch {
    return { unregistered: false, reason: "exception" }
  }
}

export type SwUnregisterFailReason =
  | "unsupported"
  | "not_registered"
  | "browser_refused"
  | "exception"

/**
 * Test-only — reset le singleton module-level entre tests Vitest.
 * Ne pas appeler en runtime application.
 */
export function __resetSwRegistrationForTests(): void {
  swRegistrationPromise = null
}
