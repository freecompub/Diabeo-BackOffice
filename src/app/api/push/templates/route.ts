import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { pushService } from "@/lib/services/push.service"
import { logger } from "@/lib/logger"

/** GET /api/push/templates — list notification templates (NURSE+ only) */
export async function GET(req: NextRequest) {
  try {
    requireRole(req, "NURSE")
    const templates = await pushService.listTemplates()
    return NextResponse.json(templates)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error("push/templates", "List templates failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
