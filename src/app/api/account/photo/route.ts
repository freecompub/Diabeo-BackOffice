import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"

export async function PUT(req: NextRequest) {
  try {
    requireAuth(req)

    // Photo upload requires OVH Object Storage integration (not yet implemented)
    return NextResponse.json(
      { error: "notImplemented", message: "Photo upload requires OVH Object Storage" },
      { status: 501 },
    )
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
