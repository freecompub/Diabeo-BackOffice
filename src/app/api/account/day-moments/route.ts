import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { userService } from "@/lib/services/user.service"

const dayMomentsSchema = z.array(
  z.object({
    type: z.enum(["morning", "noon", "evening", "night", "custom"]),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
  }),
).min(1).max(10)

export async function GET(req: Request) {
  try {
    const user = requireAuth(req)
    const moments = await userService.getDayMoments(user.id)
    return NextResponse.json(moments)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[account/day-moments GET]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = dayMomentsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await userService.updateDayMoments(user.id, parsed.data)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[account/day-moments PUT]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
