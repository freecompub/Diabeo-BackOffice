"use client"

/**
 * Login page — US-799.
 *
 * Formulaire email/password avec:
 * - Validation côté client
 * - Rate limiting visible (timer décompte)
 * - Préparation MFA (champ TOTP conditionnel)
 * - Messages d'erreur génériques (pas de distinction email/password)
 * - Accessibilité WCAG 2.1 (ARIA labels, navigation clavier)
 */

import { useState, useEffect, useRef, type FormEvent } from "react"
import { useAuth } from "@/hooks/use-auth"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { AlertBanner } from "@/components/diabeo"
import { Loader2, Eye, EyeOff } from "lucide-react"

export default function LoginPage() {
  const { login, isLoading, error, setError } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaCode, setMfaCode] = useState("")
  const [lockoutSeconds, setLockoutSeconds] = useState(0)

  const emailRef = useRef<HTMLInputElement>(null)
  const mfaRef = useRef<HTMLInputElement>(null)

  // Auto-focus email on mount
  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  // Focus MFA input when shown
  useEffect(() => {
    if (mfaRequired) mfaRef.current?.focus()
  }, [mfaRequired])

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSeconds <= 0) return
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          setError(null)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [lockoutSeconds, setError])

  const isLocked = lockoutSeconds > 0

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (isLocked || isLoading) return

    const result = await login(email, password)

    if (result.mfaRequired) {
      setMfaRequired(true)
      return
    }

    if (result.retryAfterSeconds) {
      setLockoutSeconds(result.retryAfterSeconds)
    }

    // Focus first field on error for accessibility (WCAG 3.3.1)
    if (!result.success) {
      emailRef.current?.focus()
    }
  }

  function formatLockoutTime(seconds: number): string {
    const min = Math.floor(seconds / 60)
    const sec = seconds % 60
    if (min > 0) return `${min}min ${sec.toString().padStart(2, "0")}s`
    return `${sec}s`
  }

  return (
    <>
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-primary)] shadow-lg">
          <span className="text-2xl font-bold text-white">D</span>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-[var(--color-foreground)]">
            Diabeo Backoffice
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Connectez-vous pour acceder au tableau de bord
          </p>
        </div>
      </div>

      {/* Error banner */}
      {error && !isLocked && (
        <div className="mb-4">
          <AlertBanner
            severity="warning"
            title={error}
            dismissible
            onDismiss={() => setError(null)}
          />
        </div>
      )}

      {/* Lockout banner */}
      {isLocked && (
        <div className="mb-4">
          <AlertBanner
            severity="critical"
            title={`Compte temporairement bloque. Reessayez dans ${formatLockoutTime(lockoutSeconds)}`}
          />
        </div>
      )}

      <Card className="shadow-md">
        <CardHeader className="pb-4">
          <h2 className="sr-only">Formulaire de connexion</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                ref={emailRef}
                id="email"
                type="email"
                autoComplete="email"
                placeholder="dr.dupont@hospital.fr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading || isLocked}
                required
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading || isLocked}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {/* MFA Code (conditional) */}
            {mfaRequired && (
              <div className="space-y-2">
                <Label htmlFor="mfa-code">Code de verification (MFA)</Label>
                <Input
                  ref={mfaRef}
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6)
                    setMfaCode(v)
                  }}
                  disabled={isLoading || isLocked}
                  className="text-center text-lg tracking-widest"
                  aria-describedby="mfa-help"
                />
                <p id="mfa-help" className="text-xs text-[var(--color-muted-foreground)]">
                  Entrez le code a 6 chiffres de votre application d&apos;authentification
                </p>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || isLocked || !email || !password}
              aria-label="Se connecter"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Connexion en cours...
                </>
              ) : (
                "Se connecter"
              )}
            </Button>

            {/* Forgot password */}
            <div className="text-center">
              <a
                href="/reset-password"
                className="text-sm text-[var(--color-primary)] hover:underline"
              >
                Mot de passe oublie ?
              </a>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Footer */}
      <p className="mt-6 text-center text-xs text-[var(--color-muted-foreground)]">
        Diabeo Backoffice &mdash; Donnees hebergees HDS
      </p>
    </>
  )
}
