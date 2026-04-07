"use client"

/**
 * Session timeout warning hook.
 *
 * Because the JWT is stored in an httpOnly cookie, the client has no direct
 * access to the token payload (including its expiry claim). Instead, this
 * hook tracks session age by reading a login timestamp that `useAuth` writes
 * to sessionStorage on successful authentication. The expiry is then inferred
 * from the known SESSION_DURATION_MS constant, which must stay in sync with
 * the TOKEN_EXPIRY value in `src/lib/auth/jwt.ts`.
 *
 * Clinical note: a session that expires mid-form could cause unsaved patient
 * data to be lost. `preserveFormData` / `restoreFormData` mitigate this by
 * keeping a transient copy in sessionStorage (never localStorage per
 * CLAUDE.md security rules). Data is removed from sessionStorage as soon as
 * it is restored.
 *
 * Security note: sessionStorage is origin-scoped and cleared when the tab
 * closes. Preserved form data must never contain decrypted health data
 * destined for direct DB storage — only form field values that the user
 * already typed.
 */

import { useState, useEffect, useCallback } from "react"

/** Must match TOKEN_EXPIRY in src/lib/auth/jwt.ts */
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000 // 24 h
const WARNING_THRESHOLD_MS = 5 * 60 * 1000 // 5 min
const CHECK_INTERVAL_MS = 60 * 1000 // 1 min
const LOGIN_TIMESTAMP_KEY = "diabeo_session_start"
const FORM_DATA_PREFIX = "diabeo_form_"

export interface SessionTimeoutState {
  /**
   * True when fewer than WARNING_THRESHOLD_MS milliseconds remain in the
   * current session. Consumers should display a visible warning to the user.
   */
  sessionWarning: boolean
  /**
   * Whole minutes remaining until session expiry, or null when no active
   * session timestamp is found in sessionStorage (e.g. not yet logged in).
   */
  minutesRemaining: number | null
  /**
   * Persist arbitrary form data under a namespaced key in sessionStorage so
   * that it survives a re-authentication flow triggered by session expiry.
   *
   * @param key    - Short identifier for the form (e.g. "patient-update")
   * @param data   - JSON-serialisable value (typically the form field values)
   */
  preserveFormData: (key: string, data: unknown) => void
  /**
   * Retrieve and remove previously preserved form data.
   *
   * @param key - Same key that was passed to `preserveFormData`
   * @returns   Parsed value, or null if nothing was stored under this key
   */
  restoreFormData: (key: string) => unknown | null
}

/**
 * Returns the number of milliseconds remaining in the current session, or
 * null when no login timestamp is present in sessionStorage.
 */
function computeRemainingMs(): number | null {
  if (typeof window === "undefined") return null

  const raw = sessionStorage.getItem(LOGIN_TIMESTAMP_KEY)
  if (raw === null) return null

  const loginTs = Number(raw)
  if (!Number.isFinite(loginTs)) return null

  const elapsed = Date.now() - loginTs
  const remaining = SESSION_DURATION_MS - elapsed
  return remaining
}

/**
 * Hook that periodically evaluates session age and signals when expiry is
 * imminent. It also provides helpers to preserve and restore in-flight form
 * data across re-authentication flows.
 *
 * @example
 * ```tsx
 * const { sessionWarning, minutesRemaining, preserveFormData } = useSessionTimeout()
 *
 * if (sessionWarning) {
 *   return <Banner message={t("auth.sessionWarning", { minutes: minutesRemaining })} />
 * }
 * ```
 */
export function useSessionTimeout(): SessionTimeoutState {
  const [sessionWarning, setSessionWarning] = useState(false)
  const [minutesRemaining, setMinutesRemaining] = useState<number | null>(null)

  useEffect(() => {
    function tick() {
      const remaining = computeRemainingMs()

      if (remaining === null) {
        // No active session tracked — reset state without triggering a warning.
        setSessionWarning(false)
        setMinutesRemaining(null)
        return
      }

      const minutes = Math.max(0, Math.floor(remaining / 60_000))
      setMinutesRemaining(minutes)
      setSessionWarning(remaining > 0 && remaining <= WARNING_THRESHOLD_MS)
    }

    // Run immediately so state is populated before the first interval fires.
    tick()

    const id = setInterval(tick, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  const preserveFormData = useCallback((key: string, data: unknown): void => {
    try {
      sessionStorage.setItem(`${FORM_DATA_PREFIX}${key}`, JSON.stringify(data))
    } catch {
      // sessionStorage quota exceeded or unavailable — fail silently.
    }
  }, [])

  const restoreFormData = useCallback((key: string): unknown | null => {
    const storageKey = `${FORM_DATA_PREFIX}${key}`
    const raw = sessionStorage.getItem(storageKey)
    if (raw === null) return null
    sessionStorage.removeItem(storageKey)
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }, [])

  return { sessionWarning, minutesRemaining, preserveFormData, restoreFormData }
}

export { LOGIN_TIMESTAMP_KEY }
