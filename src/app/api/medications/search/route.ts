import { NextResponse } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { searchMedications, getLatestImportLog } from "@/lib/services/bdpm.service"

export async function GET(req: Request) {
  try {
    requireAuth(req)

    const url = new URL(req.url)
    const query = url.searchParams.get("q") ?? ""
    const atcCode = url.searchParams.get("atc") ?? undefined
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50)

    if (query.length < 2 && !atcCode) {
      return NextResponse.json(
        { error: "validationFailed", details: { q: "Minimum 2 caractères" } },
        { status: 400 },
      )
    }

    const results = await searchMedications(query, { atcCode, limit })
    const lastImport = await getLatestImportLog()

    return NextResponse.json({
      ...results,
      source: "BDPM — ANSM",
      lastImportDate: lastImport?.createdAt ?? null,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[medications/search]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
