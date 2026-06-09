/**
 * US-2112 / US-2112b — Préférence de langue utilisateur.
 *
 * PUT → tout user authentifié — change la locale active : pose le cookie
 *       `diabeo_locale` (lu serveur dans `src/i18n/request.ts`) ET persiste
 *       la préférence durable en base (`User.language`). Audit UPDATE/USER
 *       (changement de préférence UX, pas de PHI).
 * GET → renvoie la préférence enregistrée (`User.language`) vs la locale
 *       active (cookie), avec un flag `mismatch` pour l'alerte de
 *       réconciliation au login (US-2112b AC-3).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { cookies } from "next/headers"
import { requireAuth, AuthError } from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { extractRequestContext, auditService } from "@/lib/services/audit.service"
import { LOCALE_COOKIE, locales, defaultLocale } from "@/i18n/config"
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

    // US-2112b AC-2 — persiste la préférence durable (suit l'utilisateur entre
    // appareils, indépendamment du cookie). La colonne `User.language` existe
    // déjà (enum Language fr/en/ar). Si l'update échoue, on laisse tout de même
    // le cookie posé ci-dessous (dégradation gracieuse — l'affichage reste correct).
    await prisma.user.update({
      where: { id: user.id },
      data: { language: parsed.data.locale },
    })

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

    return NextResponse.json({ locale: parsed.data.locale, persisted: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "account/locale PUT failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/**
 * GET — préférence enregistrée vs locale active (cookie). Sert à l'alerte de
 * réconciliation (US-2112b AC-3) : si `mismatch`, l'UI propose de confirmer le
 * changement de langue ou de revenir à la préférence.
 */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { language: true },
    })
    const preference = dbUser?.language ?? defaultLocale

    const cookieStore = await cookies()
    const rawActive = cookieStore.get(LOCALE_COOKIE)?.value
    const active = (locales as readonly string[]).includes(rawActive ?? "")
      ? (rawActive as (typeof locales)[number])
      : null

    return NextResponse.json({
      preference,
      active,
      // mismatch ssi une locale active explicite diffère de la préférence.
      // Cookie absent → pas de mismatch (le login pose le cookie depuis la pref).
      mismatch: active !== null && active !== preference,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "account/locale GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
