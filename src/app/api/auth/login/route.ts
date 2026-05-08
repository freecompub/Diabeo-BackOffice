import { NextResponse, type NextRequest } from "next/server"
import { compare } from "bcryptjs"
import { prisma } from "@/lib/db/client"
import { hmacEmail } from "@/lib/crypto/hmac"
import {
  signJwt,
  signMfaPendingToken,
  createSession,
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts,
} from "@/lib/auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"
import { loginBodySchema } from "@/lib/schemas/auth"

// Pre-computed hash for timing-safe comparison when user is not found.
// Prevents timing oracle attacks that would allow enumeration of valid emails.
const DUMMY_HASH = "$2a$12$LJ3m4ys3Lk0TSwMBiGKfxO5PaRxBVg1VQ/5.AkQYiAELlN0G5.3Pu"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = loginBodySchema.safeParse(body)

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
    const rateCheck = await checkRateLimit(emailHash)
    if (rateCheck.blocked) {
      return NextResponse.json(
        { error: "tooManyAttempts", retryAfterSeconds: rateCheck.retryAfterSeconds },
        { status: 429 },
      )
    }

    // Find user by emailHmac
    const user = await prisma.user.findUnique({
      where: { emailHmac: emailHash },
      select: {
        id: true, passwordHash: true, role: true,
        mfaEnabled: true, status: true,
      },
    })

    if (!user) {
      // Timing-safe: always run bcrypt compare even when user not found to prevent timing oracle
      await compare(password, DUMMY_HASH)
      await recordFailedAttempt(emailHash)
      await auditService.log({
        // userId null = événement anonyme (email inconnu, pas de FK valide).
        userId: null,
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
      await recordFailedAttempt(emailHash)
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

    // US-2148 — Block suspended/archived accounts after password validation.
    // Returns generic 401 with the SAME response body as `invalidCredentials`
    // to prevent attackers from distinguishing (a) wrong password, (b)
    // suspended account, (c) unknown account.
    //
    // **DoS mitigation** : we do NOT call `recordFailedAttempt` here.
    // Otherwise an attacker who knows a suspended user's email could keep
    // the rate-limit lockout extended forever, blocking legitimate
    // re-activation. The trade-off is a slight timing-oracle differential
    // (suspended path skips the rate-limit Redis call) — acceptable since
    // the password DID match (so the suspended user already passes auth).
    // We DO clear prior failed attempts (the password is correct).
    if (user.status !== "active") {
      await clearAttempts(emailHash)
      await auditService.log({
        userId: user.id,
        action: "UNAUTHORIZED",
        resource: "SESSION",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { reason: "accountSuspended", status: user.status },
      })
      return NextResponse.json({ error: "invalidCredentials" }, { status: 401 })
    }

    // MFA: password OK. If enabled, do NOT issue the full JWT — return an
    // MFA-pending token the client must exchange at /api/auth/mfa/challenge
    // together with a valid OTP. Short-lived (5 min), different audience,
    // unusable against any protected endpoint.
    if (user.mfaEnabled) {
      const mfaToken = await signMfaPendingToken(user.id)
      await clearAttempts(emailHash) // password-step succeeded — reset counter
      return NextResponse.json({ mfaRequired: true, mfaToken }, { status: 200 })
    }

    // Success — clear rate limit, create session, sign JWT
    await clearAttempts(emailHash)

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

    // C3: JWT is set as httpOnly cookie — never returned in JSON body to prevent XSS token theft
    const response = NextResponse.json({
      expiresAt: session.expires.toISOString(),
    })
    response.cookies.set("diabeo_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 24 * 60 * 60,
    })
    return response
  } catch (error) {
    const ctx = extractRequestContext(req)
    logger.error("auth/login", "login handler failed", { requestId: ctx.requestId }, error)
    return NextResponse.json({ error: "serverUnavailable" }, { status: 503 })
  }
}
