// NextAuth v5 catch-all route — kept for potential OAuth provider integration.
// Primary authentication uses custom JWT RS256 routes (login, logout, refresh).
// See: /api/auth/login, /api/auth/logout, /api/auth/refresh

import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({ error: "Use /api/auth/login" }, { status: 404 })
}

export async function POST() {
  return NextResponse.json({ error: "Use /api/auth/login" }, { status: 404 })
}
