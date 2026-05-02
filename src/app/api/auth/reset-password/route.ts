import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db/client"
import { hmacEmail } from "@/lib/crypto/hmac"
import { checkRateLimit } from "@/lib/auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { emailService } from "@/lib/services/email.service"
import { decrypt } from "@/lib/crypto/health-data"
import { randomUUID, randomInt } from "crypto"
import { logger } from "@/lib/logger"

const resetSchema = z.object({
  email: z.string().email(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = resetSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { email } = parsed.data
    const emailHash = hmacEmail(email)
    const ctx = extractRequestContext(req)

    const rateCheck = await checkRateLimit(`reset:${emailHash}`)
    if (rateCheck.blocked) {
      return NextResponse.json(
        { error: "tooManyAttempts", retryAfter: rateCheck.retryAfterSeconds },
        { status: 429 },
      )
    }

    const start = Date.now()
    const user = await prisma.user.findUnique({ where: { emailHmac: emailHash } })

    if (user) {
      const resetToken = randomUUID()

      await prisma.$transaction(async (tx) => {
        await tx.verificationToken.deleteMany({ where: { identifier: emailHash } })
        await tx.verificationToken.create({
          data: {
            identifier: emailHash,
            token: resetToken,
            expires: new Date(Date.now() + 3600_000),
          },
        })
      })

      try {
        const decryptedEmail = decrypt(new Uint8Array(Buffer.from(user.email, "base64")))
        emailService.sendPasswordReset(decryptedEmail, resetToken).catch((err) => {
          logger.error("auth/reset-password", "Email send failed", { userId: user.id }, err)
        })
      } catch {
        logger.error("auth/reset-password", "Email decrypt failed", { userId: user.id })
      }

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

    const elapsed = Date.now() - start
    const minDuration = 500 + randomInt(0, 300)
    if (elapsed < minDuration) {
      await new Promise((r) => setTimeout(r, minDuration - elapsed))
    }

    return NextResponse.json({
      message: "If an account exists with this email, a reset link has been sent.",
    })
  } catch (error) {
    logger.error("auth/reset-password", "Unexpected error", {}, error)
    return NextResponse.json({ error: "serverUnavailable" }, { status: 503 })
  }
}
