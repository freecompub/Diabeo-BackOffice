/**
 * @module org-access
 * @description Helper to verify caller membership in a HealthcareService.
 *
 * Used by all cabinet-scoped endpoints (templates library, cohort analytics,
 * risk dashboard) to block cross-tenant tampering / PHI exfiltration.
 *
 * ADMIN bypasses the check (super-admin model). Other roles must have a
 * `HealthcareMember` row linking them to `organizationId`.
 */

import { prisma } from "@/lib/db/client"
import type { Role } from "@prisma/client"

/**
 * Returns true if the caller is a member of the target organization (or an
 * ADMIN super-user). Caller MUST gate behind `requireAuth/Role` first.
 */
export async function isOrgMember(
  userId: number, role: Role, organizationId: number,
): Promise<boolean> {
  if (role === "ADMIN") return true
  const link = await prisma.healthcareMember.findFirst({
    where: { userId, serviceId: organizationId },
    select: { id: true },
  })
  return link !== null
}
