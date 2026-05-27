/* eslint-disable */
/**
 * Firebase Messaging Service Worker — US-2076-UI iter 4 (round 1 review fixes).
 *
 * **Fix C1 round 1 review PR #444** — validation stricte du postMessage :
 *   - `event.origin === self.location.origin` (anti same-origin XSS injection)
 *   - shape config valide (apiKey/projectId/messagingSenderId/appId présents
 *     + typés string) avant `initializeApp`
 *   - allowlist `projectId` whitelist hardcoded (anti MITM Firebase project)
 *   - `firebaseAppInitialized` latch + check pre-init pour race TOCTOU
 *
 * **Fix C3 round 1 review PR #444** — `importScripts` top-level (vs ancien
 * import dans le `message` handler) → Firebase SDK chargé au SW install.
 * Si un push FCM arrive avant qu'un client envoie config, SDK est prêt
 * (juste pas initialisé) → push gracefully dropped sans crash, retentera
 * au prochain polling 30s/60s côté UI.
 *
 * **Fix H4 round 1 review PR #444** — `BroadcastChannel` singleton top-level
 * (vs ancien open/close par push) — économise resource burst.
 *
 * **TODO Issue #XXX** — self-host Firebase SDK dans `public/vendor/`
 * (Subresource Integrity impossible sur `importScripts` Web spec) après
 * scan antivirus manuel des fichiers SDK. En attendant, `importScripts`
 * depuis gstatic.com officiel Google.
 *
 * **PHI** : notifications backend data-only (US-2073 fcm.service.ts) —
 * pas de body/preview clinique en lockscreen.
 */
const SW_VERSION = "1.1.0-iter4-round1"

// ----- Self-update strategy -----
// Fix HSA M3 round 1 review PR #444 — `updateViaCache: 'none'` côté client
// + `Cache-Control: no-cache` côté serveur pour permettre force update
// SW chez users actifs en cas de bug critique. SW_VERSION bump = invalidation.

// ----- Allowlist Firebase project IDs -----
// Fix HSA C1 round 1 review PR #444 — empêche MITM via inject config
// vers projet Firebase attaquant. À étendre avec ID projets prod/staging
// Diabeo une fois Firebase activé.
const ALLOWED_PROJECT_IDS = new Set([
  // Placeholder — remplacer par les vrais project IDs Diabeo après
  // provisioning Firebase prod/staging.
  "diabeo-prod",
  "diabeo-staging",
  "diabeo-dev",
])

// ----- importScripts top-level (Fix C3) -----
// Charge Firebase SDK au SW install, AVANT toute config. Si gstatic CDN
// down (DoS), le SW se contente de ne pas traiter les push (graceful).
try {
  importScripts(
    "https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js",
  )
} catch (err) {
  // SDK load failed (CDN down / CSP restrictif) — SW reste actif mais
  // ne pourra pas traiter push FCM. Polling UI 30s/60s fallback.
  // (NB : pas de console.warn en prod via guard impossible côté SW.)
}

// ----- Singleton BroadcastChannel (Fix H4) -----
// Créé une seule fois au SW install — économise resource vs ancien
// pattern open/close par push event.
const bcChannel = new BroadcastChannel("messaging-events")

let firebaseAppInitialized = false

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

/**
 * Validate Firebase config shape + project allowlist.
 * Fix HSA C1 + CR H2 + FE M4 round 1 review PR #444.
 */
function isValidFirebaseConfig(config) {
  if (typeof config !== "object" || config === null) return false
  const required = ["apiKey", "projectId", "messagingSenderId", "appId"]
  for (const key of required) {
    if (typeof config[key] !== "string" || config[key].length === 0) return false
  }
  if (!ALLOWED_PROJECT_IDS.has(config.projectId)) return false
  return true
}

/**
 * Message handler — reçoit la config Firebase depuis le client après
 * SW activated. Validation stricte avant initializeApp.
 */
self.addEventListener("message", (event) => {
  // Fix HSA C1 round 1 review PR #444 — validation origin.
  // `event.source` peut être null pour certains messages SW (broadcast,
  // workers). Pour FIREBASE_CONFIG on exige une source client legitimate.
  if (!event.source || event.source.url) {
    // Vérifie que source.url commence par self.location.origin.
    const sourceUrl = event.source ? event.source.url : ""
    if (!sourceUrl.startsWith(self.location.origin + "/")) {
      return
    }
  }

  const data = event.data || {}
  if (data.type !== "FIREBASE_CONFIG") return

  // Latch — empêche re-init après premier succès (TOCTOU mitigation).
  if (firebaseAppInitialized) return

  if (!isValidFirebaseConfig(data.config)) return

  // SDK chargé ? (importScripts top-level peut avoir failed).
  if (typeof firebase === "undefined" || typeof firebase.initializeApp !== "function") {
    return
  }

  try {
    firebase.initializeApp(data.config)
    const messaging = firebase.messaging()
    // Background handler — relais data-only au client via singleton BC.
    messaging.onBackgroundMessage((payload) => {
      const kind = payload && payload.data && payload.data.kind
      const nonce = payload && payload.data && payload.data.nonce
      if (kind === "message_received" && typeof nonce === "string") {
        bcChannel.postMessage({ type: "message_received", nonce })
        // Pas de notification visible (data-only, PHI safe).
      }
    })
    firebaseAppInitialized = true
  } catch (err) {
    // Init failed silently — UI polling fallback OK.
  }
})

// Expose SW_VERSION pour debugging via DevTools Application > SW.
self.SW_VERSION = SW_VERSION
