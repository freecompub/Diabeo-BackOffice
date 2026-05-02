import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { fcmService } from "@/lib/services/fcm.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { checkApiRateLimit } from "@/lib/auth/api-rate-limit"
import { logger } from "@/lib/logger"

const sendSchema = z.object({
  userId: z.number().int().positive(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  templateId: z.string().max(50).optional(),
  data: z.record(z.string(), z.string()).optional(),
})

const sendFromTemplateSchema = z.object({
  userId: z.number().int().positive(),
  templateId: z.string().min(1).max(50),
  variables: z.record(z.string(), z.string()).optional(),
})

/** POST /api/push/send — send push notification to user (NURSE+) */
export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")

    const rl = await checkApiRateLimit(`push-send:${user.id}`, {
      bucket: "push-send", windowSec: 3600, max: 50,
    })
    if (!rl.allowed)
      return NextResponse.json({ error: "rateLimited", retryAfter: rl.retryAfterSec }, { status: 429 })

    const body = await req.json()
    const ctx = extractRequestContext(req)

    if (body.templateId && !body.title) {
      const parsed = sendFromTemplateSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      const result = await fcmService.sendFromTemplate(
        parsed.data.userId,
        parsed.data.templateId,
        parsed.data.variables,
        ctx,
      )
      return NextResponse.json(result)
    }

    const parsed = sendSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await fcmService.sendToUser(parsed.data, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError)
      return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "templateNotFound")
      return NextResponse.json({ error: "templateNotFound" }, { status: 404 })
    if (error instanceof Error && error.message === "templateInactive")
      return NextResponse.json({ error: "templateInactive" }, { status: 400 })
    if (error instanceof Error && error.message.includes("FIREBASE_SERVICE_ACCOUNT_KEY"))
      return NextResponse.json({ error: "pushNotConfigured" }, { status: 503 })
    logger.error("push/send", "Send failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
