import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { requireGdprConsent } from "@/lib/gdpr"
import { syncService } from "@/lib/services/sync.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const pullSchema = z.object({
  deviceUid: z.string().min(1).max(100),
  sequenceNum: z.string().regex(/^\d+$/, "Must be a non-negative integer string"),
})

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const body = await req.json()
    const parsed = pullSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const result = await syncService.pull(user.id, parsed.data.deviceUid, BigInt(parsed.data.sequenceNum), user.id, ctx)

    if (result.conflict) {
      return NextResponse.json(result, { status: 409 })
    }

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "syncNotFound") {
      return NextResponse.json({ error: "syncNotFound" }, { status: 404 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[sync/pull POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
