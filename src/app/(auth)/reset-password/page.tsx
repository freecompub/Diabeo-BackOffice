"use client"

/**
 * Reset Password page — US-WEB-200.
 *
 * Formulaire de reinitialisation du mot de passe avec:
 * - Internationalisation via next-intl (fr/en/ar, RTL support)
 * - Anti-enumeration : message generique quel que soit le resultat
 * - Composants DiabeoTextField, DiabeoButton du design system
 * - Accessibilite WCAG 2.1 (ARIA labels, aria-describedby, live region)
 *
 * Security note:
 * The API always returns 200 regardless of whether the email exists in the
 * database. This prevents user enumeration attacks (OWASP A07).
 *
 * @see src/app/api/auth/reset-password/route.ts — API handler
 * @see src/components/diabeo/DiabeoTextField.tsx — champ texte accessible
 * @see src/components/diabeo/DiabeoButton.tsx — bouton design system
 */

import { useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { DiabeoTextField } from "@/components/diabeo/DiabeoTextField"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { AlertBanner } from "@/components/diabeo"
import { cn } from "@/lib/utils"

export default function ResetPasswordPage() {
  const t = useTranslations("auth")
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (isLoading || !email) return

    setIsLoading(true)
    setError(null)

    try {
      await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      // Anti-enumeration: always show success regardless of API response
      setSubmitted(true)
    } catch {
      // Show generic error only on network failure (not on 4xx/5xx — anti-enumeration)
      setError(t("networkError"))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div data-testid="reset-password-screen">
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 shadow-lg">
          <span className="text-2xl font-bold text-white">D</span>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            {t("resetPassword")}
          </h1>
          {!submitted && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("resetPasswordSubtitle")}
            </p>
          )}
        </div>
      </div>

      <Card className="shadow-md">
        <CardHeader className="pb-4">
          <h2 className="sr-only">{t("resetPassword")}</h2>
        </CardHeader>
        <CardContent>
          {submitted ? (
            /* Success state — anti-enumeration message */
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center gap-4 py-2 text-center"
            >
              {/* Checkmark icon */}
              <div
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-full",
                  "bg-teal-50 text-teal-600"
                )}
                aria-hidden="true"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 12.75l6 6 9-13.5"
                  />
                </svg>
              </div>
              <p className="text-sm text-foreground">
                {t("resetPasswordSuccess")}
              </p>
            </div>
          ) : (
            /* Form state */
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* Network error banner */}
              {error && (
                <AlertBanner
                  severity="warning"
                  title={error}
                  dismissible
                  onDismiss={() => setError(null)}
                />
              )}

              {/* Email field */}
              <DiabeoTextField
                data-testid="reset-email-field"
                id="reset-email"
                label={t("email")}
                type="email"
                autoComplete="email"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
                aria-describedby={error ? "reset-error" : undefined}
              />

              {/* Submit button */}
              <DiabeoButton
                data-testid="reset-submit-button"
                type="submit"
                variant="diabeoPrimary"
                fullWidth
                loading={isLoading}
                disabled={isLoading || !email}
                aria-label={t("resetPasswordButton")}
              >
                {isLoading ? t("resetPasswordSending") : t("resetPasswordButton")}
              </DiabeoButton>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Back to login */}
      <div className="mt-6 text-center">
        <Link
          data-testid="reset-back-link"
          href="/login"
          className={cn(
            "text-sm text-teal-600 hover:underline",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 rounded-sm"
          )}
        >
          {t("resetPasswordBack")}
        </Link>
      </div>

      {/* HDS footer */}
      <p className="mt-4 text-center text-xs text-muted-foreground">
        {t("welcome")} &mdash; {t("hostedHds")}
      </p>
    </div>
  )
}
