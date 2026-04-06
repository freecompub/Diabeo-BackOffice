import { NextResponse } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { importBdpm, getLatestImportLog } from "@/lib/services/bdpm.service"

/**
 * POST /api/medications/import — Trigger BDPM import.
 * Admin-only. Downloads, scans (antivirus), parses, and imports BDPM data.
 */
export async function POST(req: Request) {
  try {
    const user = requireRole(req, "ADMIN")

    // Rate limit: reject if import ran within the last hour
    const lastImport = await getLatestImportLog()
    if (lastImport && Date.now() - lastImport.createdAt.getTime() < 3600_000) {
      return NextResponse.json(
        { error: "importTooRecent", lastImportAt: lastImport.createdAt },
        { status: 429 },
      )
    }

    const result = await importBdpm(user.id)

    if (result.status === "error") {
      // Sanitize — never expose internal file paths or DB errors (H1 fix)
      console.error("[medications/import] Import failed:", result.errorMessage)
      return NextResponse.json(
        { error: "importFailed", durationMs: result.durationMs },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      specialtyCount: result.specialtyCount,
      presentCount: result.presentCount,
      compositionCount: result.compositionCount,
      durationMs: result.durationMs,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[medications/import]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
