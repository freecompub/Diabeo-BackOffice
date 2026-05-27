"use client"

/**
 * Client-side authentication hook.
 *
 * JWT is stored server-side in an httpOnly cookie (set by the login API route).
 * The client never sees or handles the token directly — this prevents XSS
 * token exfiltration (CLAUDE.md: "JAMAIS localStorage ou cookies non-httpOnly").
 *
 * The browser automatically sends the cookie with every request via
 * credentials: "include". The middleware reads the cookie and validates the JWT.
 *
 * i18n: error messages are resolved through next-intl using the "auth" namespace.
 * `mapErrorToMessage` returns an i18n key; the hook translates it with `useTranslations`.
 *
 * Session tracking: on successful login the current timestamp is stored in
 * sessionStorage under LOGIN_TIMESTAMP_KEY so that `useSessionTimeout` can
 * calculate remaining session time without touching the httpOnly cookie.
 */

import { useState, useCallback, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { LOGIN_TIMESTAMP_KEY } from "@/hooks/use-session-timeout"
// Fix HSA H4 round 1 review PR #449 (Issue #446) — import depuis module pur
// `@/lib/messaging/sw-lifecycle` (pas depuis `@/components/diabeo/messaging/`)
// pour éviter le couplage cross-domain auth ↔ composants messaging et la
// charge bundle du hook `useMessagingPush` sur les pages non-messaging.
import { unregisterMessagingServiceWorker } from "@/lib/messaging/sw-lifecycle"
import { fetchWithTimeout } from "@/lib/ui/fetch-with-timeout"
import { logHookError } from "@/lib/ui/sanitize-error"

// Helper local — wrap chaque étape cleanup logout dans try/catch + log
// `alwaysLog: true` (Fix CRITICAL C1 round 1 review PR #449). Sans
// observabilité, un silent fail prod = violation HDS Art. L.1111-8
// démonstrabilité.
async function safeCleanupStep(
  label: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn()
  } catch (err) {
    logHookError(label, err, { alwaysLog: true })
  }
}

// ---------------------------------------------------------------------------
// Cross-tab logout sync (Issue #450 — follow-up review HSA M2 PR #449)
// ---------------------------------------------------------------------------

/**
 * Nom du `BroadcastChannel` partagé entre tous les tabs ouverts sur la même
 * origin Diabeo. Toute instance `useAuth` mount un listener — quand le tab
 * initiateur du logout finit sa chaîne cleanup, il post un message `"logout"`
 * que les autres tabs consomment pour se déconnecter localement.
 *
 * Sans ce sync, sur poste partagé cabinet multi-PS (HDS Art. L.1111-8) :
 *   - PS A logout tab 1 → tokens DELETE backend
 *   - Tab 2 toujours actif → `useMessagingPush` mount cycle → ré-register
 *     token FCM (annule cleanup tab 1)
 *   - PS B login peu après → token PS A persiste sous identité PS A
 *   - Cron messagerie push → arrive à device PS A (alors qu'il a logout)
 */
const AUTH_CHANNEL_NAME = "diabeo:auth"

interface AuthBroadcastMessage {
  type: "logout"
  /** Identifiant unique du tab émetteur — permet au listener d'ignorer ses
   * propres broadcasts. Spec `BroadcastChannel` dit que le sender ne reçoit
   * pas, mais l'implémentation Node (`node:worker_threads`) renvoie au sender
   * → filtrage défensif requis pour tests jsdom + portabilité Node future
   * (Edge runtime). Browser : `BroadcastChannel` ne se renvoie pas, donc le
   * filtre est un no-op runtime. */
  from: string
  /** Timestamp émission (debug / observability — pas utilisé pour logique). */
  at: number
}

/**
 * Cleanup LOCAL au tab courant — appelé soit par le `finally` du logout
 * initiateur, soit par les listeners cross-tab. Ne broadcast PAS (sinon
 * loop infini théorique, même si `BroadcastChannel` n'envoie pas au sender).
 */
function applyLogoutLocalCleanup(redirect: (path: string) => void): void {
  sessionStorage.removeItem(LOGIN_TIMESTAMP_KEY)
  redirect("/login")
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoginResult {
  success: boolean
  error?: string
  mfaRequired?: boolean
  retryAfterSeconds?: number
}

// ---------------------------------------------------------------------------
// Role mapping (post-login redirect)
// ---------------------------------------------------------------------------

/**
 * CRIT-1 round 2 (review PR #426) — Mapping rôle → home path. Élimine la
 * dépendance au role-router `/` qui était cassée par `src/app/page.tsx`
 * (supprimé dans ce même commit).
 *
 * Source of truth : `@/lib/auth/role-home` (partagé avec layouts + nav).
 */
import { ROLE_TO_HOME, isKnownRoleString, type KnownRole } from "@/lib/auth/role-home"

function isKnownRoleAccount(value: unknown): value is { role: KnownRole } {
  return (
    typeof value === "object" && value !== null
    && "role" in value
    && typeof (value as Record<string, unknown>).role === "string"
    && isKnownRoleString((value as Record<string, string>).role)
  )
}

// ---------------------------------------------------------------------------
// i18n key mapping (pure function — no React dependency)
// ---------------------------------------------------------------------------

/**
 * Maps a raw API error code / HTTP status to an i18n key within the "auth"
 * namespace. Keeping this as a standalone function (rather than inlining
 * switch logic inside the hook) makes it straightforward to unit-test without
 * React context.
 *
 * Valid return values correspond to keys defined in messages/{locale}.json
 * under the "auth" object: "loginError", "rateLimited", "mfaRequired",
 * "networkError".
 *
 * @param errorCode - Value of the `error` field returned by the API
 * @param status    - HTTP response status code
 */

function mapErrorToMessage(errorCode: string, status: number): string {
  switch (errorCode) {
    case "invalidCredentials":
      return "loginError"
    case "tooManyAttempts":
      return "rateLimited"
    case "mfaRequired":
      return "mfaRequired"
    case "unauthorized":
      return "loginError"
    case "serverError":
      return "networkError"
    default:
      if (status === 429) return "rateLimited"
      if (status >= 500) return "networkError"
      return "loginError"
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth() {
  const router = useRouter()
  const t = useTranslations("auth")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      setIsLoading(true)
      setError(null)

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          credentials: "include",
        })

        const data = (await res.json()) as {
          error?: string
          retryAfterSeconds?: number
          /**
           * Fix M-2 round 2 review PR #426 — Le login API retourne désormais
           * `role` dans la réponse success pour éliminer le round-trip
           * `/api/account` post-login.
           */
          role?: string
        }

        if (!res.ok) {
          const key = mapErrorToMessage(data.error ?? "", res.status)
          // Interpolate params for keys that need them
          const retryMinutes = data.retryAfterSeconds
            ? Math.ceil(data.retryAfterSeconds / 60)
            : undefined
          const errorMsg = key === "rateLimited" && retryMinutes
            ? t("rateLimited" as Parameters<typeof t>[0], { minutes: retryMinutes })
            : t(key as Parameters<typeof t>[0])
          setError(errorMsg)
          return {
            success: false,
            error: errorMsg,
            mfaRequired: data.error === "mfaRequired",
            retryAfterSeconds: data.retryAfterSeconds,
          }
        }

        // Record login timestamp so useSessionTimeout can track remaining time.
        // JWT itself is httpOnly — we never touch it from client code.
        sessionStorage.setItem(LOGIN_TIMESTAMP_KEY, String(Date.now()))

        // US-3356 — Role-based redirect. Le login API retourne `role` (fix
        // M-2 round 2) → mapping client-side direct via ROLE_TO_HOME sans
        // round-trip supplémentaire.
        //
        // Fix CRIT-1 round 2 review PR #426 (session 2026-05-22) — L'ancien
        // pattern `target = "/"` + role-router serveur était cassé par
        // `src/app/page.tsx` qui shadow `(dashboard)/page.tsx` et redirige
        // toujours vers `/login`. Tous les pros étaient bloqués post-login.
        //
        // Fail-safe : si le serveur ne retourne pas de role (regression
        // future, schema change), fall-back sur `/api/account` probe puis
        // sur `/login` (visible plutôt que piège silencieux).
        let target = "/login"
        if (data.role && isKnownRoleString(data.role)) {
          target = ROLE_TO_HOME[data.role]
        } else {
          // Backwards-compat / regression safety : probe en fallback si la
          // réponse login n'a pas de role (vieux serveur, deploy partiel).
          try {
            const me = await fetch("/api/account", { credentials: "include" })
            if (me.ok) {
              const account: unknown = await me.json()
              if (isKnownRoleAccount(account)) target = ROLE_TO_HOME[account.role]
            }
          } catch {
            // Network blip: stays on /login fail-safe.
          }
        }

        // JWT is set as httpOnly cookie by the server — no client-side storage
        router.push(target)
        return { success: true }
      } catch {
        const errorMsg = t("networkError")
        setError(errorMsg)
        return { success: false, error: errorMsg }
      } finally {
        setIsLoading(false)
      }
    },
    [router, t],
  )

  // Fix CR H3 + FE M4 round 1 review PR #449 (Issue #446) — guard double
  // click. useRef plutôt que useState pour éviter re-render inutile (pattern
  // aligné HSA-3 inFlightRef iter 2).
  const isLoggingOutRef = useRef(false)

  // Issue #450 — tab identity unique pour filtrer les broadcasts émis par
  // soi-même (cf. doc `AuthBroadcastMessage.from`). Random suffit (pas
  // sécurité, juste désambiguïsation runtime).
  const tabIdRef = useRef<string>("")
  if (tabIdRef.current === "") {
    tabIdRef.current = Math.random().toString(36).slice(2) + Date.now().toString(36)
  }

  // Issue #450 follow-up review HSA M2 PR #449 — listener cross-tab logout.
  // Si un AUTRE tab logout, on cleanup local (sessionStorage clear + redirect
  // /login) SANS ré-émettre (anti-loop : seul l'initiateur broadcast).
  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
      // Vieux Safari/IE ou SSR : graceful fallback no-op.
      return
    }
    const channel = new BroadcastChannel(AUTH_CHANNEL_NAME)
    const ownTabId = tabIdRef.current
    channel.onmessage = (event: MessageEvent<AuthBroadcastMessage>) => {
      if (event.data?.type !== "logout") return
      // Filtre défensif : ignorer ses propres broadcasts (cf. doc `from`).
      if (event.data.from === ownTabId) return
      applyLogoutLocalCleanup((path) => router.replace(path))
    }
    return () => {
      channel.close()
    }
  }, [router])

  const logout = useCallback(async () => {
    // Fix Issue #446 (US-2076-UI iter 4 PR #444 follow-up) + reviews PR #449
    // — cleanup HDS Art. L.1111-8 gestion fin de session sur poste partagé
    // cabinet multi-PS :
    //   1. POST /api/auth/logout — révoque session backend (cookie Set max-age=0,
    //      sid invalidé en BDD → middleware refuse au prochain refresh).
    //   2. DELETE /api/push/register — supprime tokens FCM backend (table
    //      PushDeviceRegistration US-2073) parallèle SW unregister.
    //   3. unregister service worker `firebase-messaging-sw.js` côté browser
    //      → prochain user sur ce PC NE reçoit PAS les push FCM du PS sortant.
    //   4. Clear sessionStorage + redirect /login.
    //
    // Fix HSA H1 round 1 PR #449 — POST EN PREMIER pour fermer le canal
    // d'émission backend avant cleanup tokens. Sinon entre étapes 2 et 1,
    // le cron messagerie / cron RDV pouvait encore push via tokens valides.
    //
    // Pattern fire-and-forget : chaque étape wrappée dans `safeCleanupStep`
    // qui catch + logue avec `alwaysLog: true` (Fix CRITICAL C1 round 1
    // PR #449 — observabilité prod requise pour démonstrabilité HDS).
    if (isLoggingOutRef.current) return
    isLoggingOutRef.current = true

    try {
      // Étape 1 — révoquer session backend (await séquentiel : ferme le
      // canal émetteur avant cleanup tokens).
      await safeCleanupStep("logout.auth", () =>
        fetchWithTimeout("/api/auth/logout", {
          method: "POST",
          credentials: "include",
        }),
      )

      // Étapes 2 + 3 — cleanup tokens + SW en parallèle (indépendants,
      // Fix L1 round 1 PR #449 — latence ~50% réduite vs await séquentiel).
      // Middleware CSRF exige X-Requested-With sur DELETE routes non-auth.
      await Promise.allSettled([
        safeCleanupStep("logout.fcm.delete", () =>
          fetchWithTimeout("/api/push/register", {
            method: "DELETE",
            credentials: "include",
            headers: { "X-Requested-With": "XMLHttpRequest" },
          }),
        ),
        safeCleanupStep("logout.sw.unregister", () =>
          unregisterMessagingServiceWorker(),
        ),
      ])
    } finally {
      // Issue #450 — broadcast aux autres tabs AVANT le cleanup local pour
      // que tous les tabs cleanup en parallèle (latence cross-tab minimisée).
      // Seul l'initiateur du logout broadcast → pas de loop (les listeners
      // appellent `applyLogoutLocalCleanup` sans ré-émettre).
      if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
        try {
          const channel = new BroadcastChannel(AUTH_CHANNEL_NAME)
          channel.postMessage({
            type: "logout",
            from: tabIdRef.current,
            at: Date.now(),
          } satisfies AuthBroadcastMessage)
          channel.close()
        } catch (err) {
          // Fire-and-forget : si broadcast fail (browser quirk), le cleanup
          // local du tab initiateur fonctionne toujours. Les autres tabs
          // verront le 401 au prochain refresh middleware.
          logHookError("logout.broadcast", err, { alwaysLog: true })
        }
      }
      // Fix FE M3 round 1 PR #449 — clear + redirect dans finally global,
      // même si un bug React 19 compiler edge case fait throw sur await.
      // Fix FE H6 round 1 PR #449 — `router.replace` au lieu de `router.push`.
      // Push conserve l'historique → back button → flash PHI dashboard cached
      // avant que middleware re-redirect. Sur poste partagé cabinet = leak
      // visuel. `replace` invalide le history entry courant.
      applyLogoutLocalCleanup((path) => router.replace(path))
      isLoggingOutRef.current = false
    }
  }, [router])

  return { login, logout, isLoading, error, setError }
}

export { mapErrorToMessage }
