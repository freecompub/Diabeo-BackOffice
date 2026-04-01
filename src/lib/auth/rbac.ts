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
