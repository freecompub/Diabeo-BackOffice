import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { deviceService } from "@/lib/services/device.service"

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const syncs = await deviceService.getSyncStatus(user.id)
    // Serialize BigInt sequenceNum
    return NextResponse.json(syncs.map((s) => ({ ...s, sequenceNum: String(s.sequenceNum) })))
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[devices/sync-status GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
