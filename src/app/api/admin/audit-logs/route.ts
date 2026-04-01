import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

const VALID_ACTIONS = [
  "LOGIN", "LOGOUT", "READ", "CREATE", "UPDATE", "DELETE",
  "EXPORT", "UNAUTHORIZED", "BOLUS_CALCULATED",
  "PROPOSAL_ACCEPTED", "PROPOSAL_REJECTED",
] as const

const VALID_RESOURCES = [
  "USER", "PATIENT", "CGM_ENTRY", "GLYCEMIA_ENTRY",
  "DIABETES_EVENT", "INSULIN_THERAPY", "BOLUS_LOG",
  "ADJUSTMENT_PROPOSAL", "MEDICAL_DOCUMENT", "SESSION",
] as const

const querySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  resource: z.enum(VALID_RESOURCES).optional(),
  action: z.enum(VALID_ACTIONS).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "ADMIN")
    const ctx = extractRequestContext(req)

    // Validate query parameters with Zod
    const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(rawParams)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const filters = parsed.data

    // Audit of the audit — log every read of audit logs
    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "SESSION",
      resourceId: "audit-logs",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { filters },
    })

    const result = await auditService.query({
      userId: filters.userId,
      resource: filters.resource,
      action: filters.action,
      from: filters.from,
      to: filters.to,
      page: filters.page,
      limit: filters.limit,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error && error.name === "AuthError") {
      const authErr = error as Error & { status: number }
      return NextResponse.json({ error: error.message }, { status: authErr.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[audit-logs GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
