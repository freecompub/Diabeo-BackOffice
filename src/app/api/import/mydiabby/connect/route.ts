import { NextResponse } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { isStagingEnv, stagingOnlyResponse } from "@/lib/staging-guard"
import { connectAccount } from "@/lib/services/mydiabby-sync.service"
import { z } from "zod"

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(req: Request) {
  if (!isStagingEnv()) return stagingOnlyResponse()

  try {
    const user = requireRole(req, "DOCTOR")
    const body = await req.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await connectAccount(user.id, parsed.data.email, parsed.data.password)

    return NextResponse.json({ success: true, result })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[import/mydiabby/connect]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
