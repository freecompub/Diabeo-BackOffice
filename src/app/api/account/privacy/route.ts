import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { auditService } from "@/lib/services/audit.service"

const updatePrivacySchema = z.object({
  shareWithResearchers: z.boolean().optional(),
  shareWithProviders: z.boolean().optional(),
  analyticsEnabled: z.boolean().optional(),
  gdprConsent: z.boolean().optional(),
})

export async function GET(req: Request) {
  try {
    const user = requireAuth(req)

    let settings = await prisma.userPrivacySettings.findUnique({
      where: { userId: user.id },
    })

    if (!settings) {
      settings = await prisma.userPrivacySettings.create({
        data: { userId: user.id },
      })
    }

    return NextResponse.json(settings)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[account/privacy GET]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = updatePrivacySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const data: Record<string, unknown> = { ...parsed.data }

    // Auto-set consentDate when gdprConsent becomes true
    if (parsed.data.gdprConsent === true) {
      data.consentDate = new Date()
    }

    const settings = await prisma.userPrivacySettings.upsert({
      where: { userId: user.id },
      update: data,
      create: { userId: user.id, ...data },
    })

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
    console.error("[account/privacy PUT]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
