import { NextResponse } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { UNIT_DEFINITIONS } from "@/lib/conversions"

export async function GET(req: Request) {
  try {
    requireAuth(req)
    return NextResponse.json(UNIT_DEFINITIONS)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
