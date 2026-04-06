import { NextResponse } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { isStagingEnv, stagingOnlyResponse } from "@/lib/staging-guard"
import { listCredentials } from "@/lib/services/mydiabby-sync.service"

export async function GET(req: Request) {
  if (!isStagingEnv()) return stagingOnlyResponse()

  try {
    const user = requireRole(req, "DOCTOR")
    const accounts = await listCredentials(user.id)

    return NextResponse.json({ accounts })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[import/mydiabby/accounts]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
