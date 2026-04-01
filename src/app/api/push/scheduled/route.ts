import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { ScheduleType } from "@prisma/client"
import { requireAuth, AuthError } from "@/lib/auth"
import { pushService } from "@/lib/services/push.service"

const createScheduledSchema = z.object({
  templateId: z.string().min(1).max(50),
  scheduleType: z.nativeEnum(ScheduleType),
  scheduledAt: z.coerce.date().optional(),
  cronExpression: z.string().max(50).optional(),
  cronTimezone: z.string().max(50).optional(),
  templateVariables: z.record(z.string(), z.unknown()).optional(),
  maxOccurrences: z.number().int().positive().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const scheduled = await pushService.listScheduled(user.id)
    return NextResponse.json(scheduled)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[push/scheduled GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = createScheduledSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const result = await pushService.createScheduled(user.id, parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[push/scheduled POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
