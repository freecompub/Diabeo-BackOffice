import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { DayMomentType } from "@prisma/client"
import { requireAuth, AuthError } from "@/lib/auth"
import { userService } from "@/lib/services/user.service"

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/

const dayMomentsSchema = z.array(
  z.object({
    type: z.nativeEnum(DayMomentType),
    startTime: z.string().regex(timeRegex, "Format HH:MM (00-23:00-59)"),
    endTime: z.string().regex(timeRegex, "Format HH:MM (00-23:00-59)"),
  }).refine((m) => m.startTime < m.endTime, {
    message: "startTime must be before endTime",
  }),
).min(1).max(10)

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const moments = await userService.getDayMoments(user.id)
    return NextResponse.json(moments)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account/day-moments GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = dayMomentsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await userService.updateDayMoments(user.id, parsed.data)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account/day-moments PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
