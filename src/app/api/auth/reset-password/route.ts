import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db/client"
import { hmacEmail } from "@/lib/crypto/hmac"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

const resetSchema = z.object({
  email: z.string().email(),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = resetSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { email } = parsed.data
    const emailHash = hmacEmail(email)
    const ctx = extractRequestContext(req)

    const user = await prisma.user.findUnique({ where: { emailHmac: emailHash } })

    if (user) {
      // TODO: Send reset email via email service
      // For now, log the request and return success
      // (always return success to prevent email enumeration)
      await auditService.log({
        userId: user.id,
        action: "UPDATE",
        resource: "USER",
        resourceId: String(user.id),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { type: "password_reset_requested" },
      })
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({
      message: "If an account exists with this email, a reset link has been sent.",
    })
  } catch (error) {
    console.error("[auth/reset-password]", error)
    return NextResponse.json({ error: "serverUnavailable" }, { status: 503 })
  }
}
