import { NextResponse } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { isStagingEnv, stagingOnlyResponse } from "@/lib/staging-guard"
import { syncCredential } from "@/lib/services/mydiabby-sync.service"
import { z } from "zod"

const schema = z.object({
  credentialId: z.number().int().positive(),
})

export async function POST(req: Request) {
  if (!isStagingEnv()) return stagingOnlyResponse()

  try {
    requireRole(req, "DOCTOR")
    const body = await req.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await syncCredential(parsed.data.credentialId)

    return NextResponse.json({ success: true, result })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[import/mydiabby/sync]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
