import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { invalidateGdprConsentCache } from "@/lib/gdpr"
import { auditService } from "@/lib/services/audit.service"
import { privacySettingsPatchSchema } from "@/lib/schemas/account"

const PRIVACY_DEFAULTS = {
  shareWithResearchers: false,
  shareWithProviders: true,
  analyticsEnabled: true,
  gdprConsent: false,
  consentDate: null,
} as const

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const settings = await prisma.userPrivacySettings.findUnique({
      where: { userId: user.id },
    })

    // Return defaults without persisting (idempotent GET)
    return NextResponse.json(settings ?? { userId: user.id, ...PRIVACY_DEFAULTS })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account/privacy GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = privacySettingsPatchSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const data: Record<string, unknown> = { ...parsed.data }

    // Auto-manage consentDate based on gdprConsent state
    if (parsed.data.gdprConsent === true) {
      data.consentDate = new Date()
    } else if (parsed.data.gdprConsent === false) {
      data.consentDate = null
    }

    const settings = await prisma.userPrivacySettings.upsert({
      where: { userId: user.id },
      update: data,
      create: { userId: user.id, ...data },
    })

    // RGPD Art. 7(3): withdrawal must be as easy as giving consent. Clear the
    // 5-minute cache so revocation takes effect immediately, not after TTL.
    if (parsed.data.gdprConsent !== undefined) {
      await invalidateGdprConsentCache(user.id)
    }

    await auditService.log({
      userId: user.id,
      action: "UPDATE",
      resource: "USER",
      resourceId: String(user.id),
      metadata: { field: "privacySettings", updatedFields: Object.keys(parsed.data) },
    })

    return NextResponse.json(settings)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account/privacy PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
