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
/**
 * L4 (re-review) — type guard for the `/api/account` probe response. Returns
 * true only when the payload definitively identifies a VIEWER (patient self-
 * service role).
 */
function isViewerAccount(value: unknown): value is { role: "VIEWER" } {
  return (
    typeof value === "object" && value !== null
    && "role" in value
    && (value as Record<string, unknown>).role === "VIEWER"
  )
}

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

        const data = (await res.json()) as { error?: string; retryAfterSeconds?: number }

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

        // US-3356 — Role-based redirect : VIEWER lands on patient self-service
        // dashboard, all other roles (pros) on the role-router `/` which
        // dispatches to `/medecin` / `/infirmier` / `/admin` according to
        // their role. We probe `/api/account` (returns role) immediately
        // after login. Layout-side guards in (dashboard) and (patient)
        // layouts will bounce mis-routed users if this probe ever returns
        // a stale or malformed payload.
        //
        // Fix #11.b (session 2026-05-22) — Target précédent `/dashboard`
        // est la page glycémie PATIENT-facing (single-patient view).
        // DOCTOR/NURSE/ADMIN y atterrissaient → 404 sur /api/cgm et
        // /api/analytics/* (qui exigent `?patientId=` côté pro).
        let target = "/"
        try {
          const me = await fetch("/api/account", { credentials: "include" })
          if (me.ok) {
            const account: unknown = await me.json()
            if (isViewerAccount(account)) target = "/patient/dashboard"
          }
        } catch {
          // Network blip: fall through to role-router. Layout-side guards
          // will bounce a VIEWER back to /patient/dashboard if needed.
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
