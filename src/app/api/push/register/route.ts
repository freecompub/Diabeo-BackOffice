import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { PushPlatform } from "@prisma/client"
import { requireAuth, AuthError } from "@/lib/auth"
import { pushService } from "@/lib/services/push.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const registerSchema = z.object({
  platform: z.nativeEnum(PushPlatform),
  pushToken: z.string().min(10).max(500),
  deviceName: z.string().max(100).optional(),
  deviceModel: z.string().max(50).optional(),
  osVersion: z.string().max(20).optional(),
  appVersion: z.string().max(20).optional(),
  appBundleId: z.string().max(100).optional(),
  locale: z.string().max(10).optional(),
  pushTimezone: z.string().max(50).optional(),
  isSandbox: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const registrations = await pushService.listRegistrations(user.id)
    return NextResponse.json(registrations)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[push/register GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const reg = await pushService.register(user.id, parsed.data, ctx)
    return NextResponse.json(reg, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[push/register POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const result = await pushService.unregisterAll(user.id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[push/register DELETE]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
