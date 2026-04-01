import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { announcementService } from "@/lib/services/announcement.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1).max(10000),
  callBackDelay: z.number().int().min(0).optional(),
  displayShowButton: z.boolean().optional(),
})

/** GET /api/announcements — list active announcements */
export async function GET(req: NextRequest) {
  try {
    requireAuth(req)
    const announcements = await announcementService.list()
    return NextResponse.json(announcements)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[announcements GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/** POST /api/announcements — create announcement (ADMIN only) */
export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const body = await req.json()
    const parsed = createAnnouncementSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const announcement = await announcementService.create(parsed.data, user.id, ctx)
    return NextResponse.json(announcement, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[announcements POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
