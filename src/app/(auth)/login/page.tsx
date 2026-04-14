"use client"

/**
 * Login page — US-WEB-200.
 *
 * Formulaire email/password avec:
 * - Internationalisation via next-intl (fr/en/ar, RTL support)
 * - Validation cote client
 * - Rate limiting visible (timer decompte)
 * - Preparation MFA (champ TOTP conditionnel)
 * - Messages d'erreur generiques (pas de distinction email/password)
 * - Accessibilite WCAG 2.1 (ARIA labels, navigation clavier)
 * - Composants DiabeoTextField, DiabeoButton du design system
 *
 * @see src/hooks/use-auth.ts — useAuth() hook
 * @see src/components/diabeo/DiabeoTextField.tsx — champ texte accessible
 * @see src/components/diabeo/DiabeoButton.tsx — bouton design system
 */

import { useState, useEffect, useRef, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { useAuth } from "@/hooks/use-auth"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { AlertBanner } from "@/components/diabeo"
import { DiabeoTextField } from "@/components/diabeo/DiabeoTextField"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import Link from "next/link"

export default function LoginPage() {
  const t = useTranslations("auth")
  const { login, isLoading, error, setError } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
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
    if (isLocked || isLoading || !email || !password) return

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
    <div data-testid="login-screen">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 shadow-lg">
          <span className="text-2xl font-bold text-white">D</span>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            {t("welcome")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("welcomeSubtitle")}
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
            title={t("accountLocked", { time: formatLockoutTime(lockoutSeconds) })}
          />
        </div>
      )}

      <Card className="shadow-md">
        <CardHeader className="pb-4">
          <h2 className="sr-only">{t("loginForm")}</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email */}
            <DiabeoTextField
              ref={emailRef}
              data-testid="login-email-field"
              id="login-email"
              label={t("email")}
              type="email"
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading || isLocked}
              required
              error={error ?? undefined}
            />

            {/* Password — DiabeoTextField type="password" has built-in toggle */}
            <DiabeoTextField
              data-testid="login-password-field"
              id="login-password"
              label={t("password")}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading || isLocked}
              required
            />

            {/* MFA Code (conditional) */}
            {mfaRequired && (
              <DiabeoTextField
                ref={mfaRef}
                id="login-mfa-code"
                label={t("mfaCode")}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t("mfaPlaceholder")}
                maxLength={6}
                value={mfaCode}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6)
                  setMfaCode(v)
                }}
                disabled={isLoading || isLocked}
                hint={t("mfaHelp")}
                className="text-center text-lg tracking-widest"
              />
            )}

            {/* Submit */}
            <DiabeoButton
              data-testid="login-button"
              type="submit"
              variant="diabeoPrimary"
              fullWidth
              loading={isLoading}
              disabled={isLoading || isLocked || !email || !password}
              aria-label={t("loginButton")}
            >
              {isLoading ? t("loggingIn") : t("loginButton")}
            </DiabeoButton>

            {/* Forgot password */}
            <div className="text-center">
              <Link
                data-testid="forgot-password-button"
                href="/reset-password"
                className="text-sm text-teal-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 rounded-sm"
              >
                {t("forgotPassword")}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Footer — Create account */}
      <div className="mt-6 flex flex-col items-center gap-2">
        <p className="text-sm text-muted-foreground">{t("noAccount")}</p>
        <Link
          data-testid="create-account-button"
          href="/register"
          className="text-sm font-medium text-teal-600 hover:text-teal-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 rounded-sm"
        >
          {t("createAccount")}
        </Link>
      </div>

      {/* HDS footer */}
      <p className="mt-4 text-center text-xs text-muted-foreground">
        {t("welcome")} &mdash; {t("hostedHds")}
      </p>
    </div>
  )
}
