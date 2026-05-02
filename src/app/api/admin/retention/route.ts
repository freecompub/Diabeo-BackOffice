import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { retentionService } from "@/lib/services/retention.service"
import { logger } from "@/lib/logger"

/** POST /api/admin/retention — trigger audit log retention (ADMIN only) */
export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const result = await retentionService.applyRetention(user.id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError)
      return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error("admin/retention", "Retention trigger failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
