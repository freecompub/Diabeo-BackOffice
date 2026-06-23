import { cache } from "react"
import { userService } from "@/lib/services/user.service"

/**
 * Request-scoped display name of the authenticated user (own name).
 *
 * Thin `cache()` wrapper around {@link userService.getOwnDisplayName} so the
 * same server request (layout + page rendering together) performs a single
 * DB lookup + decrypt instead of one per call site. `cache()` is per-request
 * (no cross-request leakage of decrypted PII) and the call is a pure read.
 *
 * `sessionUserId` MUST be the caller's own id (see getOwnDisplayName security
 * note). Server-only by construction: importing this pulls `userService` →
 * Prisma, so any client import already fails at build.
 */
export const getCurrentUserDisplayName = cache(
  (sessionUserId: number) => userService.getOwnDisplayName(sessionUserId),
)

type NameParts = {
  title: string | null
  firstname: string | null
  lastname: string | null
}

/**
 * Shell display name (avatar/dropdown): `"firstname lastname"`, empty parts
 * dropped, `undefined` when nothing usable (the shell then falls back to its
 * default initials). No honorific — unlike the greeting. Pure — exported for
 * unit testing.
 */
export function formatShellName(name: NameParts | null): string | undefined {
  if (!name) return undefined
  return [name.firstname, name.lastname].filter(Boolean).join(" ") || undefined
}

/**
 * Shell user name for the authenticated user, read from the request headers
 * (`x-user-id`, the caller's OWN id). Returns `undefined` when there is no
 * valid id. Wraps the request-cached self lookup, so calling it from several
 * layouts in the same request hits the DB only once.
 */
export async function getShellUserName(
  headersList: { get(name: string): string | null },
): Promise<string | undefined> {
  const rawUserId = headersList.get("x-user-id")
  const userId = rawUserId ? Number(rawUserId) : NaN
  if (!Number.isInteger(userId) || userId <= 0) return undefined
  return formatShellName(await getCurrentUserDisplayName(userId))
}
