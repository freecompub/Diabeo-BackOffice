/**
 * @module session-management.service
 * @description Groupe 9 — US-2007 Sessions multiples UI.
 *
 * Permet à un user de voir et révoquer ses sessions actives. Backend
 * Session déjà en place (createSession + invalidateSession) ; cette
 * couche expose une API user-facing pour le compte personnel.
 *
 * Audit US-2268 : `resourceId = session.id`, `metadata.kind` typé.
 */

import { prisma } from "@/lib/db/client"
import { revokeSession } from "@/lib/auth/revocation"
import { auditService, type AuditContext } from "./audit.service"

// ─────────────────────────────────────────────────────────────
// Audit kinds typés
// ─────────────────────────────────────────────────────────────

export type SessionMgmtAuditKind =
  | "session.list"
  | "session.revoke.one"
  | "session.revoke.others"

const AUDIT_KIND = {
  LIST: "session.list",
  REVOKE_ONE: "session.revoke.one",
  REVOKE_OTHERS: "session.revoke.others",
} as const satisfies Record<string, SessionMgmtAuditKind>

// ─────────────────────────────────────────────────────────────
// Erreurs typées
// ─────────────────────────────────────────────────────────────

export class SessionNotFoundError extends Error {
  constructor() {
    super("sessionNotFound")
    this.name = "SessionNotFoundError"
  }
}

export class SessionAccessError extends Error {
  constructor() {
    super("notOwnSession")
    this.name = "SessionAccessError"
  }
}

// ─────────────────────────────────────────────────────────────
// DTO
// ─────────────────────────────────────────────────────────────

export interface SessionDTO {
  id: string
  /** `true` si c'est la session du JWT actuel (UI surligne "Cette session"). */
  isCurrent: boolean
  mfaVerified: boolean
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
  lastSeenAt: Date
  expires: Date
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const sessionManagementService = {
  /**
   * Liste les sessions actives du user, ordonnées par fraîcheur.
   * Marque `isCurrent=true` pour la session du JWT en cours.
   */
  async listOwn(
    userId: number,
    currentSessionId: string,
    ctx?: AuditContext,
  ): Promise<SessionDTO[]> {
    const rows = await prisma.session.findMany({
      where: {
        userId,
        // Filtre sessions expirées au layer DB (clean-up paresseux).
        expires: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    })

    await auditService.log({
      userId,
      action: "READ",
      resource: "SESSION",
      resourceId: String(userId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        kind: AUDIT_KIND.LIST,
        count: rows.length,
      },
    })

    return rows.map((s) => ({
      id: s.id,
      isCurrent: s.id === currentSessionId,
      mfaVerified: s.mfaVerified,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expires: s.expires,
    }))
  },

  /**
   * Révoque une session spécifique. Le user ne peut révoquer QUE ses
   * propres sessions (vérifié par `userId` dans le WHERE). Si la
   * session ciblée est la session courante, c'est équivalent à un
   * logout — le client est informé via la réponse.
   */
  async revokeOne(
    userId: number,
    sessionId: string,
    currentSessionId: string,
    ctx?: AuditContext,
  ): Promise<{ revoked: boolean; wasCurrent: boolean }> {
    const session = await prisma.session.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    })
    if (!session) {
      // Soit la session n'existe pas, soit elle n'appartient pas au user.
      // On retourne 404 sans distinguer (anti-énumération).
      throw new SessionNotFoundError()
    }

    // Revoke côté Redis cache + DB.
    await revokeSession(sessionId)
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => null)

    await auditService.log({
      userId,
      action: "DELETE",
      resource: "SESSION",
      resourceId: sessionId,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        kind: AUDIT_KIND.REVOKE_ONE,
        wasCurrent: sessionId === currentSessionId,
      },
    })

    return { revoked: true, wasCurrent: sessionId === currentSessionId }
  },

  /**
   * Révoque toutes les sessions du user SAUF celle en cours. Pattern
   * "déconnecter tous les autres appareils" — utile après changement
   * de mot de passe ou suspicion de compromission.
   */
  async revokeOthers(
    userId: number,
    currentSessionId: string,
    ctx?: AuditContext,
  ): Promise<{ revoked: number }> {
    const sessions = await prisma.session.findMany({
      where: { userId, id: { not: currentSessionId } },
      select: { id: true },
    })
    await Promise.all(sessions.map((s) => revokeSession(s.id)))
    const result = await prisma.session.deleteMany({
      where: { userId, id: { not: currentSessionId } },
    })

    await auditService.log({
      userId,
      action: "DELETE",
      resource: "SESSION",
      resourceId: String(userId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        kind: AUDIT_KIND.REVOKE_OTHERS,
        revoked: result.count,
        currentSessionId,
      },
    })

    return { revoked: result.count }
  },
}
