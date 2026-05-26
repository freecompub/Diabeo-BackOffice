/* eslint-disable */
/**
 * Firebase Messaging Service Worker — US-2076-UI iter 4.
 *
 * Charge la SDK Firebase via importScripts (compat-mode requis pour SW),
 * écoute les push notifications data-only envoyées par le backend FCM
 * (US-2073 — fcm.service.ts `sendToUser` data-only sans PHI lockscreen).
 *
 * **Config Firebase** : injectée à l'enregistrement par le client via
 * `messaging.usePublicVapidKey()` + `firebase.initializeApp(config)`.
 * En l'absence de config (env `NEXT_PUBLIC_FIREBASE_CONFIG` non set),
 * ce SW reste inactif (registration côté client skip).
 *
 * **PHI** : les notifications backend sont data-only (kind: "message_received"
 * + nonce uniquement, PAS de body/preview clinique en lockscreen).
 *
 * Versionning : bump cette version pour forcer SW update si breaking change.
 */
const SW_VERSION = "1.0.0-iter4"

// Stub config — sera remplacée par `setConfig` postMessage du client si
// l'app a Firebase activé. Sinon, SW reste inactif (skip self.skipWaiting).
let firebaseAppInitialized = false

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

/**
 * Message du client : reçoit la config Firebase + initialise messaging.
 * Pattern recommandé pour ne pas hardcoder la config dans le SW (URL public).
 */
self.addEventListener("message", (event) => {
  const data = event.data || {}
  if (data.type === "FIREBASE_CONFIG" && data.config && !firebaseAppInitialized) {
    try {
      importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js")
      importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js")
      firebase.initializeApp(data.config)
      const messaging = firebase.messaging()
      // Background handler — relais data-only au client via BroadcastChannel.
      messaging.onBackgroundMessage((payload) => {
        const kind = payload?.data?.kind
        const nonce = payload?.data?.nonce
        if (kind === "message_received") {
          // Broadcast au client foreground si page /messages ouverte → bump badge.
          const bc = new BroadcastChannel("messaging-events")
          bc.postMessage({ type: "message_received", nonce })
          bc.close()
          // Pas de notification visible (data-only, PHI safe).
          // Si client wants badge tray, browser API showNotification OK
          // mais sans body PHI — uniquement title générique "Nouveau message".
        }
      })
      firebaseAppInitialized = true
    } catch (err) {
      console.warn("[firebase-messaging-sw] init failed:", err && err.message)
    }
  }
})
