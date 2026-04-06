import { NextResponse } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { importBdpm } from "@/lib/services/bdpm.service"

/**
 * POST /api/medications/import — Trigger BDPM import.
 * Admin-only. Downloads, scans (antivirus), parses, and imports BDPM data.
 */
export async function POST(req: Request) {
  try {
    const user = requireRole(req, "ADMIN")

    const result = await importBdpm(user.id)

    if (result.status === "error") {
      return NextResponse.json(
        { error: "importFailed", details: result.errorMessage, result },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, result })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[medications/import]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
