/**
 * @module analytics-scope
 * @description Helper to resolve the population scope visible to the caller
 * for population-level analytics (US-2094/2095/2096/2098).
 *
 * Returns `null` when the caller is ADMIN (no restriction — the service
 * handles the "all non-deleted patients" branch in SQL without an IN-clause)
 * or an array of allowed patient IDs otherwise. An empty array means "no
 * accessible patients" (e.g. DOCTOR with no PatientService link) — services
 * MUST treat it as a hard filter, not as "all".
 */

import type { Role } from "@prisma/client"
import { getAccessiblePatientIds } from "@/lib/access-control"
import type { PopulationScope } from "@/lib/services/population-analytics.service"

export async function resolveAnalyticsScope(
  userId: number,
  role: Role,
): Promise<PopulationScope> {
  return getAccessiblePatientIds(userId, role)
}
