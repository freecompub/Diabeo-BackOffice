import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { auditService } from "@/lib/services/audit.service"

const timePattern = /^\d{2}:\d{2}$/

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

export async function GET(req: Request) {
  try {
    const user = requireAuth(req)

    let prefs = await prisma.userNotifPreferences.findUnique({
      where: { userId: user.id },
    })

    if (!prefs) {
      prefs = await prisma.userNotifPreferences.create({
        data: { userId: user.id },
      })
    }

    return NextResponse.json(prefs)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[account/notifications GET]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = updateNotifSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
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
    console.error("[account/notifications PUT]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
