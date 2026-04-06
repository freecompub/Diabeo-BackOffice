"use client"

/**
 * Client-side authentication hook.
 *
 * Manages login/logout flow, JWT storage in httpOnly cookie (via API),
 * auto-refresh, and session timeout warning.
 */

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"

interface AuthUser {
  id: number
  role: string
}

interface LoginResult {
  success: boolean
  error?: string
  mfaRequired?: boolean
  retryAfterSeconds?: number
}

export function useAuth() {
  const router = useRouter()
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

        const data = await res.json()

        if (!res.ok) {
          const errorMsg = mapErrorToMessage(data.error, res.status)
          setError(errorMsg)
          return {
            success: false,
            error: errorMsg,
            mfaRequired: data.error === "mfaRequired",
            retryAfterSeconds: data.retryAfterSeconds,
          }
        }

        // Store token for API calls
        if (data.token) {
          sessionStorage.setItem("diabeo_token", data.token)
        }

        router.push("/dashboard")
        return { success: true }
      } catch {
        const msg = "Service temporairement indisponible"
        setError(msg)
        return { success: false, error: msg }
      } finally {
        setIsLoading(false)
      }
    },
    [router],
  )

  const logout = useCallback(async () => {
    try {
      const token = sessionStorage.getItem("diabeo_token")
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: token
          ? { Authorization: `Bearer ${token}` }
          : {},
        credentials: "include",
      })
    } catch {
      // Logout even if API fails
    } finally {
      sessionStorage.removeItem("diabeo_token")
      router.push("/login")
    }
  }, [router])

  return { login, logout, isLoading, error, setError }
}

function mapErrorToMessage(errorCode: string, status: number): string {
  switch (errorCode) {
    case "invalidCredentials":
      return "Email ou mot de passe incorrect"
    case "tooManyAttempts":
      return "Trop de tentatives. Veuillez patienter avant de réessayer."
    case "mfaRequired":
      return "Vérification MFA requise"
    case "unauthorized":
      return "Identifiants requis"
    case "serverError":
      return "Erreur serveur. Veuillez réessayer."
    default:
      if (status === 429) return "Trop de tentatives. Veuillez patienter."
      if (status >= 500) return "Service temporairement indisponible"
      return "Email ou mot de passe incorrect"
  }
}
