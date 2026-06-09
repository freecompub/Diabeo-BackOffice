import type { NextRequest, NextResponse } from "next/server"
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_S, locales } from "./config"

/**
 * US-2112b AC-2 — initialise le cookie de locale depuis la préférence
 * enregistrée (`User.language`) UNIQUEMENT si la requête n'en porte pas déjà un
 * (nouvel appareil / navigateur vidé). N'écrase JAMAIS un cookie existant : une
 * divergence cookie ≠ préférence est laissée à la bannière de réconciliation
 * (AC-3) pour confirmation explicite.
 *
 * Mutualisé entre `/api/auth/login` (succès non-MFA) et `/api/auth/mfa/challenge`
 * (succès après OTP) → la préférence suit l'utilisateur quel que soit le chemin.
 * Attributs cohérents avec la pose côté `/api/account/locale` et le client.
 */
export function seedLocaleCookieIfAbsent(
  req: NextRequest,
  response: NextResponse,
  language: string | null | undefined,
): void {
  if (req.cookies.get(LOCALE_COOKIE)?.value) return
  if (!language || !(locales as readonly string[]).includes(language)) return
  response.cookies.set(LOCALE_COOKIE, language, {
    httpOnly: false, // lisible client (switcher) — cohérent avec /api/account/locale
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_S,
  })
}
