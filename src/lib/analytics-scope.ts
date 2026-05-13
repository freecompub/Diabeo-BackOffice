/**
 * @module analytics-scope
 * @description Helper to resolve the list of patient IDs visible to the caller
 * for population-level analytics (US-2094/2095/2096/2098).
 *
 * Wraps `getAccessiblePatientIds` and expands the ADMIN "null = no restriction"
 * answer into an actual ID list so downstream analytics services don't need
 * special-case branches.
 */

import { prisma } from "@/lib/db/client"
import type { Role } from "@prisma/client"
import { getAccessiblePatientIds } from "@/lib/access-control"

export async function resolveAnalyticsPatientIds(
  userId: number,
  role: Role,
): Promise<number[]> {
  const ids = await getAccessiblePatientIds(userId, role)
  if (ids !== null) return ids

  const rows = await prisma.patient.findMany({
    where: { deletedAt: null },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}
