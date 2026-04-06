import { NextResponse } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { isStagingEnv, stagingOnlyResponse } from "@/lib/staging-guard"
import { disconnectAccount } from "@/lib/services/mydiabby-sync.service"
import { z } from "zod"

const schema = z.object({
  credentialId: z.number().int().positive(),
})

export async function DELETE(req: Request) {
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

    await disconnectAccount(parsed.data.credentialId, user.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[import/mydiabby/disconnect]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
