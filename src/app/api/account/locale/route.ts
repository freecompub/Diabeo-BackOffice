/**
 * US-2112 — Persistence de la préférence locale via cookie httpOnly.
 *
 * PUT → tout user authentifié — change la locale active. Audit READ-style
 *       (changement de préférence UX, pas de PHI).
 *
 * Le cookie `diabeo_locale` est lu côté serveur dans `src/i18n/request.ts`
 * pour charger les `messages/{locale}.json` correspondants.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { cookies } from "next/headers"
import { requireAuth, AuthError } from "@/lib/auth"
import { extractRequestContext, auditService } from "@/lib/services/audit.service"
import { LOCALE_COOKIE, locales } from "@/i18n/config"
import { logger } from "@/lib/logger"

const putSchema = z.object({
  locale: z.enum(locales),
})

/** Cookie TTL : 1 an (préférence stable, mais re-set sur login pour rafraîchir). */
const LOCALE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = putSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    const cookieStore = await cookies()
    cookieStore.set(LOCALE_COOKIE, parsed.data.locale, {
      maxAge: LOCALE_COOKIE_MAX_AGE_S,
      httpOnly: false, // lisible côté client pour le switcher (UX)
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    })

    await auditService.log({
      userId: user.id,
      action: "UPDATE",
      resource: "USER",
      resourceId: String(user.id),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: { setting: "locale", value: parsed.data.locale },
    })

    return NextResponse.json({ locale: parsed.data.locale })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "account/locale PUT failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
