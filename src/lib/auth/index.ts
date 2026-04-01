import type { Role } from "@prisma/client"
import { hasMinRole } from "./rbac"

export { signJwt, verifyJwt, verifyJwtAllowExpired } from "./jwt"
export type { JWTPayload } from "./jwt"
export { hasMinRole } from "./rbac"
export {
  createSession,
  getSession,
  invalidateSession,
  invalidateAllUserSessions,
} from "./session"
export {
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts,
} from "./rate-limit"

export interface AuthUser {
  id: number
  role: Role
}

/** Extract authenticated user from headers set by middleware */
export function getAuthUser(req: Request): AuthUser | null {
  const userId = req.headers.get("x-user-id")
  const userRole = req.headers.get("x-user-role")
  if (!userId || !userRole) return null
  return { id: Number(userId), role: userRole as Role }
}

export function requireAuth(req: Request): AuthUser {
  const user = getAuthUser(req)
  if (!user) {
    throw new AuthError("Unauthorized", 401)
  }
  return user
}

export function requireRole(req: Request, minRole: Role): AuthUser {
  const user = requireAuth(req)
  if (!hasMinRole(user.role, minRole)) {
    throw new AuthError("Forbidden", 403)
  }
  return user
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = "AuthError"
  }
}

/** Extract Bearer token from Authorization header */
export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) return null
  return header.slice(7)
}
