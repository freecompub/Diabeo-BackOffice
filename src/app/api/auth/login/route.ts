import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { compare } from "bcryptjs"
import { prisma } from "@/lib/db/client"
import { hmacEmail } from "@/lib/crypto/hmac"
import { signJwt, createSession, checkRateLimit, recordFailedAttempt, clearAttempts } from "@/lib/auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = loginSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { email, password } = parsed.data
    const emailHash = hmacEmail(email)
    const ctx = extractRequestContext(req)

    // Rate limit check
    const rateCheck = checkRateLimit(emailHash)
    if (rateCheck.blocked) {
      return NextResponse.json(
        { error: "tooManyAttempts", retryAfter: rateCheck.retryAfterSeconds },
        { status: 429 },
      )
    }

    // Find user by emailHmac
    const user = await prisma.user.findUnique({
      where: { emailHmac: emailHash },
      select: {
        id: true, passwordHash: true, role: true,
        mfaEnabled: true,
      },
    })

    if (!user) {
      recordFailedAttempt(emailHash)
      await auditService.log({
        userId: 1,
        action: "UNAUTHORIZED",
        resource: "SESSION",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { reason: "invalidCredentials" },
      })
      return NextResponse.json({ error: "invalidCredentials" }, { status: 401 })
    }

    // Compare password
    const valid = await compare(password, user.passwordHash)

    if (!valid) {
      recordFailedAttempt(emailHash)
      await auditService.log({
        userId: user.id,
        action: "UNAUTHORIZED",
        resource: "SESSION",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { reason: "invalidCredentials" },
      })
      return NextResponse.json({ error: "invalidCredentials" }, { status: 401 })
    }

    // MFA check — block login if MFA is enabled until MFA flow is implemented
    if (user.mfaEnabled) {
      return NextResponse.json(
        { error: "mfaRequired", message: "MFA verification required" },
        { status: 403 },
      )
    }

    // Success — clear rate limit, create session, sign JWT
    clearAttempts(emailHash)

    const session = await createSession(user.id)

    const token = await signJwt({
      sub: user.id,
      role: user.role,
      platform: "hc",
      sid: session.id,
    })

    await auditService.log({
      userId: user.id,
      action: "LOGIN",
      resource: "SESSION",
      resourceId: session.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })

    return NextResponse.json({
      token,
      expiresAt: session.expires.toISOString(),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[auth/login]", msg)
    return NextResponse.json({ error: "serverUnavailable" }, { status: 503 })
  }
}
