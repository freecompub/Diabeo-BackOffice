import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { compare } from "bcryptjs"
import { Sex, Language } from "@prisma/client"
import { requireAuth, AuthError, invalidateAllUserSessions } from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { userService } from "@/lib/services/user.service"
import { deleteUserAccount } from "@/lib/services/deletion.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const updateSchema = z.object({
  title: z.string().max(10).optional(),
  firstname: z.string().min(1).max(100).optional(),
  firstnames: z.string().max(200).optional(),
  usedFirstname: z.string().max(100).optional(),
  lastname: z.string().min(1).max(100).optional(),
  usedLastname: z.string().max(100).optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sex: z.nativeEnum(Sex).optional(),
  timezone: z.string().max(50).optional(),
  phone: z.string().max(20).optional(),
  address1: z.string().max(200).optional(),
  address2: z.string().max(200).optional(),
  cp: z.string().max(10).optional(),
  city: z.string().max(100).optional(),
  country: z.string().length(2).optional(),
  language: z.nativeEnum(Language).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const profile = await userService.getProfile(user.id, user.id)

    if (!profile) {
      return NextResponse.json({ error: "userNotFound" }, { status: 404 })
    }

    return NextResponse.json(profile)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = updateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await userService.updateProfile(user.id, parsed.data, user.id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const deleteSchema = z.object({
  password: z.string().min(1),
})

/** GDPR Art. 17 — Right to erasure. Requires password confirmation. */
export async function DELETE(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = deleteSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "passwordRequired" },
        { status: 400 },
      )
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    })

    if (!dbUser) {
      return NextResponse.json({ error: "userNotFound" }, { status: 404 })
    }

    const valid = await compare(parsed.data.password, dbUser.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: "invalidCredentials" }, { status: 401 })
    }

    const ctx = extractRequestContext(req)
    await invalidateAllUserSessions(user.id)
    await deleteUserAccount(user.id, ctx.ipAddress, ctx.userAgent)

    return NextResponse.json({ deleted: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account DELETE]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
