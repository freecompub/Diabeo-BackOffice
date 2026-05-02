import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { ScheduleType } from "@prisma/client"
import { requireRole, AuthError } from "@/lib/auth"
import { pushService } from "@/lib/services/push.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { checkApiRateLimit } from "@/lib/auth/api-rate-limit"
import { logger } from "@/lib/logger"

const createScheduledSchema = z.object({
  templateId: z.string().min(1).max(50),
  scheduleType: z.nativeEnum(ScheduleType),
  scheduledAt: z.coerce.date().optional(),
  cronExpression: z.string().max(50).regex(/^(\S+\s){4}\S+$/, "Invalid cron expression").optional(),
  cronTimezone: z.string().max(50).optional(),
  templateVariables: z.record(z.string(), z.string().max(500)).optional(),
  maxOccurrences: z.number().int().positive().optional(),
}).refine((d) => {
  if (d.scheduleType === "daily" || d.scheduleType === "weekly" || d.scheduleType === "custom_cron") {
    return !!d.cronExpression
  }
  return true
}, { message: "cronExpression required for recurring schedules", path: ["cronExpression"] })

/** GET /api/push/scheduled — list scheduled notifications (NURSE+ only) */
export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const scheduled = await pushService.listScheduled(user.id)
    return NextResponse.json(scheduled)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error("push/scheduled", "List scheduled failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/** POST /api/push/scheduled — create scheduled notification (NURSE+ only) */
export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")

    const rl = await checkApiRateLimit(`push-sched:${user.id}`, {
      bucket: "push-scheduled", windowSec: 3600, max: 20,
    })
    if (!rl.allowed)
      return NextResponse.json({ error: "rateLimited", retryAfter: rl.retryAfterSec }, { status: 429 })

    const body = await req.json()
    const parsed = createScheduledSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const result = await pushService.createScheduled(user.id, parsed.data, ctx)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error("push/scheduled", "Create scheduled failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
