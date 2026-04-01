// Legacy NextAuth catch-all — deprecated in favor of custom JWT RS256 routes.
// Returns 410 Gone to indicate these endpoints are permanently removed.

import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({ error: "gone", message: "Use /api/auth/login" }, { status: 410 })
}

export async function POST() {
  return NextResponse.json({ error: "gone", message: "Use /api/auth/login" }, { status: 410 })
}
