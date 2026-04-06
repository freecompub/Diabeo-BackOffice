import { NextResponse } from "next/server"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { importAtcClassification, getAtcHierarchy } from "@/lib/services/atc.service"

/**
 * GET /api/medications/atc?code=A10 — Browse ATC hierarchy.
 * Returns the node, its children, and ancestors.
 */
export async function GET(req: Request) {
  try {
    requireAuth(req)

    const url = new URL(req.url)
    const code = url.searchParams.get("code") ?? "A"

    if (!/^[A-Z](\d{2}([A-Z]{1,2}(\d{2})?)?)?$/.test(code)) {
      return NextResponse.json(
        { error: "validationFailed", details: { code: "Format ATC invalide" } },
        { status: 400 },
      )
    }

    const hierarchy = await getAtcHierarchy(code)

    return NextResponse.json(hierarchy)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[medications/atc]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/**
 * POST /api/medications/atc — Trigger ATC classification import.
 * Admin-only.
 */
export async function POST(req: Request) {
  try {
    requireRole(req, "ADMIN")

    const result = await importAtcClassification()

    if (result.status === "error") {
      console.error("[medications/atc] Import failed:", result.errorMessage)
      return NextResponse.json(
        { error: "importFailed" },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      count: result.count,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[medications/atc]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
