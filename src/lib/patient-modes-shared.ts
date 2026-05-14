/**
 * Shared mode-type helpers (used by route handlers under
 * `/api/patient/modes/[type]/*`).
 */

import { ConfigVersionType } from "@prisma/client"

export const MODE_TYPES = ["pediatric", "ramadan", "travel"] as const
export type ModeTypeParam = (typeof MODE_TYPES)[number]

export function resolveConfigType(t: string): ConfigVersionType | null {
  switch (t) {
    case "pediatric": return ConfigVersionType.pediatric_mode
    case "ramadan":   return ConfigVersionType.ramadan_mode
    case "travel":    return ConfigVersionType.travel_mode
    default: return null
  }
}
