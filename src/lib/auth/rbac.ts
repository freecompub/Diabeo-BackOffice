import type { Role } from "@prisma/client"

/** Role hierarchy — higher index = more permissions */
const ROLE_HIERARCHY: Record<Role, number> = {
  VIEWER: 0,
  NURSE: 1,
  DOCTOR: 2,
  ADMIN: 3,
}

export function hasMinRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}

/**
 * US-2621 — Rôle backoffice (PS / admin cabinet / plateforme) vs `VIEWER`
 * (patient en libre-service). La mono-session et le timeout d'inactivité ne
 * s'appliquent qu'aux rôles backoffice ; le patient garde le multi-appareils.
 */
export function isBackofficeRole(role: Role): boolean {
  return role !== "VIEWER"
}
