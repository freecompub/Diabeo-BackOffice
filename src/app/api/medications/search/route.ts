import { NextResponse } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { searchMedications, getLatestImportLog } from "@/lib/services/bdpm.service"
import { z } from "zod"

const searchSchema = z.object({
  q: z.string().min(2).max(200),
  atc: z.string().regex(/^[A-Z]\d{0,2}[A-Z]{0,2}\d{0,2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export async function GET(req: Request) {
  try {
    requireAuth(req)

    const url = new URL(req.url)
    const parsed = searchSchema.safeParse({
      q: url.searchParams.get("q") ?? "",
      atc: url.searchParams.get("atc") || undefined,
      limit: url.searchParams.get("limit") ?? "20",
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { q, atc, limit } = parsed.data
    const results = await searchMedications(q, { atcCode: atc, limit })
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
