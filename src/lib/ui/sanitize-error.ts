/**
 * sanitizeError — scrub PII (email, phone, NIRPP) from error messages before
 * logging in dev mode.
 *
 * Fix H7 round 1 review PR #443 — Le backend peut echo PII dans error messages
 * (ex: Resend pattern HSA H4 PR #417 "Invalid: john@x.com not found"). Sans
 * sanitization, `console.warn(err.message)` côté UI fuit PII via :
 *   - DevTools console history (24h)
 *   - Extensions navigateur (Chrome Logger, Selenium logs CI)
 *   - Screen sharing involontaire Zoom
 *   - NODE_ENV gating ne couvre PAS un build staging accidentellement déployé
 *
 * Pattern aligné backend `sanitizeResendError` (US-2108 PR #417).
 *
 * **Important** : ce helper ne remplace PAS la défense backend (logger structuré
 * avec scrub côté serveur). C'est une mesure UI defense-in-depth.
 */

// Email RFC 5321 simplifié (anti-ReDoS : bounded quantifiers).
const EMAIL_RE = /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}\b/g

// Numéro de téléphone international ou FR (10 chiffres). Inclut le `+`
// prefix dans le match (sinon `+` reste après scrub).
const PHONE_RE = /\+?\d{1,3}[\s-]?\(?\d{1,4}\)?[\s-]?\d{1,4}(?:[\s-]?\d){4,10}/g

// NIRPP (numéro Sécurité Sociale FR : 15 chiffres + clé 2 chiffres).
const NIRPP_RE = /\b[12][0-9]{2}(?:0[1-9]|1[0-2])\d{2}\d{3}\d{3}\d{2}\b/g

/**
 * Scrub PII from an error message string. Returns the message with sensitive
 * tokens replaced by `[REDACTED-{kind}]`.
 *
 * @param message Raw error message string (e.g., `err.message`)
 * @returns Sanitized string safe for `console.warn` / Sentry breadcrumb
 */
export function sanitizeError(message: string): string {
  if (typeof message !== "string" || message.length === 0) return ""
  return message
    .replace(EMAIL_RE, "[REDACTED-email]")
    .replace(NIRPP_RE, "[REDACTED-nirpp]")
    .replace(PHONE_RE, "[REDACTED-phone]")
}

/**
 * Helper hook logger : scrub + console.warn gated NODE_ENV !== "production".
 * Pattern factor pour éviter la duplication dans `useUnreadCount`,
 * `useMessageThreads`, `useThreadMessages`, `useSendMessage`, `useMarkAsRead`.
 *
 * Fix L10 round 1 review PR #443 — factor `logHookError` partagé.
 */
export function logHookError(hookName: string, err: unknown): void {
  if (process.env.NODE_ENV === "production") return
  if (err instanceof Error) {
    console.warn(`[${hookName}] error:`, sanitizeError(err.message))
  } else {
    console.warn(`[${hookName}] non-error thrown:`, typeof err)
  }
}
