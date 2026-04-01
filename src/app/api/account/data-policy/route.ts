import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { userService } from "@/lib/services/user.service"

const dataPolicySchema = z.object({
  accepted: z.literal(true),
})

export async function PUT(req: Request) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = dataPolicySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    await userService.acceptDataPolicy(user.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[account/data-policy PUT]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
