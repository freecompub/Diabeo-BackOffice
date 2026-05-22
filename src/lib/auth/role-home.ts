/**
 * Mapping role → home path (single source of truth).
 *
 * Round 2 review PR #426 — Évite la duplication du mapping entre :
 *   - `src/hooks/use-auth.ts` (client, post-login redirect)
 *   - `src/app/(patient)/layout.tsx` (server, pro→home guard)
 *   - `src/components/diabeo/NavigationShell.tsx` (client, dynamic href)
 *   - `src/app/(dashboard)/{users,audit}/page.tsx` (server, non-ADMIN bounce)
 *
 * Si un dashboard rôle-spécifique change de path (e.g. `/medecin` →
 * `/cabinet`), un seul endroit à modifier.
 */

export type KnownRole = "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"

export const ROLE_TO_HOME = {
  DOCTOR: "/medecin",
  NURSE: "/infirmier",
  ADMIN: "/admin",
  VIEWER: "/patient/dashboard",
} as const satisfies Record<KnownRole, string>

export function resolveHomeForRole(role: KnownRole): string {
  return ROLE_TO_HOME[role]
}

const VALID_ROLES = new Set<KnownRole>(["ADMIN", "DOCTOR", "NURSE", "VIEWER"])

export function isKnownRoleString(value: string | null | undefined): value is KnownRole {
  return value !== null && value !== undefined && VALID_ROLES.has(value as KnownRole)
}
