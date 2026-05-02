import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { fcmService } from "@/lib/services/fcm.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { checkApiRateLimit } from "@/lib/auth/api-rate-limit"
import { prisma } from "@/lib/db/client"
import { logger } from "@/lib/logger"

const directSchema = z.object({
  mode: z.literal("direct"),
  userId: z.number().int().positive(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  data: z.record(z.string(), z.string().max(500)).optional(),
})

const templateSchema = z.object({
  mode: z.literal("template"),
  userId: z.number().int().positive(),
  templateId: z.string().min(1).max(50),
  variables: z.record(z.string(), z.string().max(200)).optional(),
})

const pushSchema = z.discriminatedUnion("mode", [directSchema, templateSchema])

/** POST /api/push/send — send push notification to user (NURSE+) */
export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")

    const rl = await checkApiRateLimit(`push-send:${user.id}`, {
      bucket: "push-send", windowSec: 3600, max: 50, failMode: "closed",
    })
    if (!rl.allowed)
      return NextResponse.json({ error: "rateLimited", retryAfter: rl.retryAfterSec }, { status: 429 })

    const body = await req.json()
    const parsed = pushSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const targetUserId = parsed.data.userId

    const targetPatient = await prisma.patient.findFirst({
      where: { userId: targetUserId, deletedAt: null },
      select: { id: true },
    })
    if (targetPatient) {
      const allowed = await canAccessPatient(user.id, user.role, targetPatient.id)
      if (!allowed) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
    } else if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const ctx = extractRequestContext(req)

    if (parsed.data.mode === "template") {
      const result = await fcmService.sendFromTemplate(
        targetUserId,
        user.id,
        parsed.data.templateId,
        parsed.data.variables,
        ctx,
      )
      return NextResponse.json(result)
    }

    const result = await fcmService.sendToUser(
      {
        userId: targetUserId,
        senderId: user.id,
        title: parsed.data.title,
        body: parsed.data.body,
        data: parsed.data.data,
        templateId: undefined,
      },
      ctx,
    )
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
