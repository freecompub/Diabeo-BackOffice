import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { auditService } from "@/lib/services/audit.service"

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

const updateNotifSchema = z.object({
  notifMessageMail: z.boolean().optional(),
  notifDocumentMail: z.boolean().optional(),
  glycemiaReminders: z.boolean().optional(),
  glycemiaReminderTimes: z.array(z.string().regex(timePattern)).optional(),
  insulinReminders: z.boolean().optional(),
  insulinReminderTimes: z.array(z.string().regex(timePattern)).optional(),
  medicalAppointments: z.boolean().optional(),
  autoExport: z.boolean().optional(),
  autoExportFrequency: z.number().int().min(1).max(365).optional(),
})

const NOTIF_DEFAULTS = {
  notifMessageMail: true,
  notifDocumentMail: true,
  glycemiaReminders: false,
  glycemiaReminderTimes: null,
  insulinReminders: false,
  insulinReminderTimes: null,
  medicalAppointments: true,
  autoExport: false,
  autoExportFrequency: null,
} as const

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const prefs = await prisma.userNotifPreferences.findUnique({
      where: { userId: user.id },
    })

    // Return defaults without persisting (idempotent GET)
    return NextResponse.json(prefs ?? { userId: user.id, ...NOTIF_DEFAULTS })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account/notifications GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = updateNotifSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const prefs = await prisma.userNotifPreferences.upsert({
      where: { userId: user.id },
      update: parsed.data,
      create: { userId: user.id, ...parsed.data },
    })

    await auditService.log({
      userId: user.id,
      action: "UPDATE",
      resource: "USER",
      resourceId: String(user.id),
      metadata: { field: "notifPreferences", updatedFields: Object.keys(parsed.data) },
    })

    return NextResponse.json(prefs)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account/notifications PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
