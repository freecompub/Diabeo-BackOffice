import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import type { AuditAction, AuditResource } from "@/lib/services/audit.service"

const VALID_ACTIONS: AuditAction[] = [
  "LOGIN", "LOGOUT", "READ", "CREATE", "UPDATE", "DELETE",
  "EXPORT", "UNAUTHORIZED", "BOLUS_CALCULATED",
  "PROPOSAL_ACCEPTED", "PROPOSAL_REJECTED",
]

const VALID_RESOURCES: AuditResource[] = [
  "USER", "PATIENT", "CGM_ENTRY", "GLYCEMIA_ENTRY",
  "DIABETES_EVENT", "INSULIN_THERAPY", "BOLUS_LOG",
  "ADJUSTMENT_PROPOSAL", "MEDICAL_DOCUMENT", "SESSION",
]

export async function GET(req: Request) {
  const session = await getServerSession()

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Admin-only access
  const userRole = (session.user as { role?: string }).role
  if (userRole !== "ADMIN") {
    // Log unauthorized access attempt
    const ctx = extractRequestContext(req)
    await auditService.log({
      userId: Number((session.user as { id?: string }).id),
      action: "UNAUTHORIZED",
      resource: "SESSION",
      resourceId: "audit-logs",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)

  // Parse and validate filters
  const userId = searchParams.get("userId")
  const resource = searchParams.get("resource")
  const action = searchParams.get("action")
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  const page = searchParams.get("page")
  const limit = searchParams.get("limit")

  if (action && !VALID_ACTIONS.includes(action as AuditAction)) {
    return NextResponse.json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}` }, { status: 400 })
  }

  if (resource && !VALID_RESOURCES.includes(resource as AuditResource)) {
    return NextResponse.json({ error: `Invalid resource. Must be one of: ${VALID_RESOURCES.join(", ")}` }, { status: 400 })
  }

  // Log the audit log read itself (audit of the audit)
  const ctx = extractRequestContext(req)
  await auditService.log({
    userId: Number((session.user as { id?: string }).id),
    action: "READ",
    resource: "SESSION",
    resourceId: "audit-logs",
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { filters: { userId, resource, action, from, to } },
  })

  const result = await auditService.query({
    userId: userId ? Number(userId) : undefined,
    resource: resource ?? undefined,
    action: action ?? undefined,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  })

  return NextResponse.json(result)
}
