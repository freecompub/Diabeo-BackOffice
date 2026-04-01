import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { userService } from "@/lib/services/user.service"

const dataPolicySchema = z.object({
  accepted: z.literal(true),
})

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = dataPolicySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    await userService.acceptDataPolicy(user.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account/data-policy PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
