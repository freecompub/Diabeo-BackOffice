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

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { LOGIN_TIMESTAMP_KEY } from "@/hooks/use-session-timeout"
import { unregisterMessagingServiceWorker } from "@/components/diabeo/messaging/useMessagingPush"

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

  const logout = useCallback(async () => {
    // Fix Issue #446 (US-2076-UI iter 4 PR #444 follow-up) — cleanup FCM
    // device avant invalidation session backend. Sur poste partagé cabinet
    // multi-PS (HDS Art. L.1111-8 gestion fin de session) :
    //   1. unregister service worker `firebase-messaging-sw.js` côté browser
    //      → prochain user sur ce PC NE reçoit PAS les push FCM du PS sortant
    //   2. DELETE backend FCM tokens (table PushDeviceRegistration US-2073)
    //      → backend NE PEUT PLUS envoyer push à ce device
    //
    // Pattern fire-and-forget : si SW unregister ou DELETE backend fail,
    // le logout doit TOUJOURS continuer (clear cookie + redirect login) —
    // on ne bloque jamais la sortie de session sur cleanup tierce.
    try {
      // Étape 1 : unregister SW (helper iter 4 PR #444).
      // Throws silently — pas de wait sur le promise pour ne pas bloquer.
      await unregisterMessagingServiceWorker()
    } catch {
      // Silent — SW unregister échoue n'empêche pas logout.
    }
    try {
      // Étape 2 : DELETE backend FCM tokens. Middleware CSRF exige
      // X-Requested-With pour state-changing requests sur routes non-auth.
      await fetch("/api/push/register", {
        method: "DELETE",
        credentials: "include",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })
    } catch {
      // Silent — token cleanup échec n'empêche pas logout.
    }
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      })
    } catch {
      // Logout even if API fails
    } finally {
      // Remove session tracking timestamp so useSessionTimeout resets cleanly.
      sessionStorage.removeItem(LOGIN_TIMESTAMP_KEY)
      router.push("/login")
    }
  }, [router])

  return { login, logout, isLoading, error, setError }
}

export { mapErrorToMessage }
