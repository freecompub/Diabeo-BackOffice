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
