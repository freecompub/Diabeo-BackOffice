/**
 * @module user-management.service
 * @description US-2148 — Admin operations on user accounts.
 *
 * Distinct from `user.service` (which handles a user's own profile). This
 * service exposes ADMIN-only operations: list, get, update role, suspend,
 * archive. The actual login is gated by `User.status` in the auth flow.
 *
 * **Scoping** : ADMIN cabinet ne voit que les users de son service via
 * `HealthcareMember`. Super-ADMIN voit tout. Le scoping est appliqué côté
 * service (pas seulement par RBAC route).
 *
 * **HDS / RGPD** :
 *  - Lecture audit READ
 *  - Modification audit UPDATE avec oldValue / newValue
 *  - Suspension / archivage audit UPDATE avec metadata.transition
 *  - Décryption email pour affichage admin (jamais loggé en clair)
 */

import { prisma } from "@/lib/db/client"
import { Prisma } from "@prisma/client"
import { safeDecryptField } from "@/lib/crypto/fields"
import { hmacField } from "@/lib/crypto/hmac"
import { revokeSession } from "@/lib/auth/revocation"
import { clearActivity } from "@/lib/auth/activity"
import { invalidateAllUserSessions } from "@/lib/auth/session"
import { auditService } from "./audit.service"
import { logger } from "@/lib/logger"
import type { AuditContext } from "./audit.service"
import type { Role, UserStatus } from "@prisma/client"

/**
 * TTL (seconds) used when revoking a session on suspend — matches the
 * 15-min JWT validity. Revocation TTL >= remaining JWT TTL so the token
 * cannot be used after suspension.
 */
const SESSION_REVOKE_TTL_S = 900

/** Maximum page size for admin users list — bounds memory + payload. */
const MAX_LIST_LIMIT = 100

interface ListFilter {
  /** Filtre rôle (peut combiner plusieurs valeurs). */
  roles?: Role[]
  /** Filtre statut. */
  statuses?: UserStatus[]
  /** Recherche full-text — applique sur firstnameHmac/lastnameHmac. */
  search?: string
  /** Service ID — restreint aux users membres de ce service (cabinet ADMIN). */
  serviceScope?: number | null
  limit?: number
  cursor?: number
}

/**
 * Public DTO d'un user pour l'admin UI. PII sensibles déchiffrés à la volée.
 * Aucun champ chiffré (en `bytes`) ne quitte le service.
 */
export interface AdminUserView {
  id: number
  email: string | null
  firstname: string | null
  lastname: string | null
  role: Role
  status: UserStatus
  statusChangedAt: Date | null
  mfaEnabled: boolean
  language: string | null
  createdAt: Date
  updatedAt: Date
}

function toAdminView(u: {
  id: number
  email: string
  firstname: string | null
  lastname: string | null
  role: Role
  status: UserStatus
  statusChangedAt: Date | null
  mfaEnabled: boolean
  language: string | null
  createdAt: Date
  updatedAt: Date
}): AdminUserView {
  return {
    id: u.id,
    email: safeDecryptField(u.email),
    firstname: safeDecryptField(u.firstname),
    lastname: safeDecryptField(u.lastname),
    role: u.role,
    status: u.status,
    statusChangedAt: u.statusChangedAt,
    mfaEnabled: u.mfaEnabled,
    language: u.language,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }
}

export const userManagementService = {
  /**
   * Liste paginée des users — scoping cabinet via `serviceScope`.
   * Retourne `{ items, nextCursor }`.
   */
  async list(filter: ListFilter, auditUserId: number, ctx?: AuditContext) {
    const limit = Math.min(filter.limit ?? 25, MAX_LIST_LIMIT)

    const where: Prisma.UserWhereInput = {
      ...(filter.roles?.length && { role: { in: filter.roles } }),
      ...(filter.statuses?.length && { status: { in: filter.statuses } }),
      ...(filter.serviceScope != null && {
        // Scoping cabinet ADMIN : seulement les users membres du service.
        // (`HealthcareMember.userId` est unique → 1:1 user↔member)
        // On ne fait PAS de jointure inverse via `User.healthcareMember` (relation
        // inexistante côté Prisma) — on filtre sur l'union des userIds.
      }),
    }

    // Cabinet scoping appliqué via une 2ᵉ requête pour éviter une jointure
    // complexe sans relation déclarée. Si serviceScope défini, on récupère
    // d'abord les userIds membres du service puis on filtre dessus.
    if (filter.serviceScope != null) {
      const memberUserIds = await prisma.healthcareMember.findMany({
        where: { serviceId: filter.serviceScope, userId: { not: null } },
        select: { userId: true },
      })
      where.id = { in: memberUserIds.map((m) => m.userId!) }
    }

    if (filter.search?.trim()) {
      // Le search est appliqué sur lastnameHmac (HMAC déterministe) — exact-match.
      // Pour faire un trigram search, le HMAC ne le permet pas (par design).
      // L'admin doit donc taper le nom EXACT pour matcher. Trade-off PHI/UX.
      const hmac = hmacField(filter.search.trim().toLowerCase())
      where.OR = [
        { lastnameHmac: hmac },
        { firstnameHmac: hmac },
      ]
    }

    const items = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstname: true,
        lastname: true,
        role: true,
        status: true,
        statusChangedAt: true,
        mfaEnabled: true,
        language: true,
        createdAt: true,
        updatedAt: true,
      },
      // Order by id desc so cursor pagination (cursor: { id }) is consistent.
      // The route layer can re-order client-side if needed for display.
      orderBy: { id: "desc" },
      take: limit + 1,
      ...(filter.cursor && { cursor: { id: filter.cursor }, skip: 1 }),
    })

    const hasMore = items.length > limit
    const page = hasMore ? items.slice(0, limit) : items
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "USER",
      resourceId: "admin:users:list",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { count: page.length, scoped: filter.serviceScope != null },
    })

    return {
      items: page.map(toAdminView),
      nextCursor,
    }
  },

  /**
   * Détail d'un user pour l'admin (PII déchiffrées).
   */
  async getById(targetUserId: number, auditUserId: number, ctx?: AuditContext) {
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        firstname: true,
        lastname: true,
        role: true,
        status: true,
        statusChangedAt: true,
        mfaEnabled: true,
        language: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!user) return null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "USER",
      resourceId: String(targetUserId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
    })

    return toAdminView(user)
  },

  /**
   * Mise à jour du rôle d'un user (ADMIN only). Audit oldValue/newValue.
   * Refuse de rétrograder le dernier ADMIN restant (anti-lock-out).
   */
  async updateRole(
    targetUserId: number,
    newRole: Role,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    // Anti-self-demote : un ADMIN ne peut pas se rétrograder lui-même
    // (symétrique à `cannot_change_own_status`). Évite le scénario où un
    // ADMIN unique se rétrograde et lock le cabinet.
    if (targetUserId === auditUserId && newRole !== "ADMIN") {
      throw new Error("cannot_demote_self")
    }
    // Serializable isolation prevents the anti-lockout count from being
    // racy under concurrent admin actions (two admins demoting the two
    // last admins simultaneously could both pass `count === 0` check).
    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: targetUserId },
          select: { role: true, status: true },
        })
        if (!current) throw new Error("user_not_found")
        if (current.role === newRole) {
          return { id: targetUserId, role: newRole, changed: false }
        }

        // Anti-lock-out : si on rétrograde un ADMIN, vérifier qu'il en reste au moins 1.
        if (current.role === "ADMIN" && newRole !== "ADMIN") {
          const remainingAdmins = await tx.user.count({
            where: { role: "ADMIN", status: "active", id: { not: targetUserId } },
          })
          if (remainingAdmins === 0) {
            throw new Error("last_admin_cannot_be_demoted")
          }
        }

        const updated = await tx.user.update({
          where: { id: targetUserId },
          // US-2619/F7 — bump authVersion : invalide les JWT antérieurs au refresh.
          data: { role: newRole, authVersion: { increment: 1 } },
          select: { id: true, role: true },
        })

        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "UPDATE",
          resource: "USER",
          resourceId: String(targetUserId),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          oldValue: { role: current.role },
          newValue: { role: newRole },
        })

        return { ...updated, changed: true }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

    // US-2619/F7 — effet immédiat : révoque les sessions actives (Redis + activité)
    // pour forcer une réémission de JWT avec le nouveau rôle (best-effort, hors tx).
    if (result.changed) {
      await invalidateAllUserSessions(targetUserId).catch((err) => {
        logger.error("user-mgmt", "Failed to invalidate sessions after role change", {
          userId: auditUserId,
        }, err)
      })
    }

    return result
  },

  /**
   * Transition de statut (suspend / réactiver / archiver).
   * Refuse de suspendre soi-même (anti-self-lockout).
   * Refuse de suspendre le dernier ADMIN actif.
   */
  async setStatus(
    targetUserId: number,
    newStatus: UserStatus,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    if (targetUserId === auditUserId) {
      throw new Error("cannot_change_own_status")
    }

    // Step 1 — DB transition (Serializable to prevent race on anti-lockout)
    // also collects the live session IDs we will need to revoke at the
    // Redis layer (JWT revocation list — `session.deleteMany` alone leaves
    // an issued JWT valid until exp, exploitable bypass).
    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: targetUserId },
          select: { status: true, role: true },
        })
        if (!current) throw new Error("user_not_found")
        if (current.status === newStatus) {
          return {
            id: targetUserId,
            status: newStatus,
            statusChangedAt: null as Date | null,
            changed: false,
            revokedSids: [] as string[],
          }
        }

        // Anti-lock-out : ne pas suspendre/archiver le dernier ADMIN actif.
        if (
          current.role === "ADMIN" &&
          current.status === "active" &&
          newStatus !== "active"
        ) {
          const remainingActiveAdmins = await tx.user.count({
            where: { role: "ADMIN", status: "active", id: { not: targetUserId } },
          })
          if (remainingActiveAdmins === 0) {
            throw new Error("last_active_admin_cannot_be_suspended")
          }
        }

        const updated = await tx.user.update({
          where: { id: targetUserId },
          data: {
            status: newStatus,
            statusChangedAt: new Date(),
            statusChangedBy: auditUserId,
            // US-2619/F7 — bump authVersion : un token émis avant la suspension
            // est rejeté au refresh (en plus de la révocation des sessions).
            authVersion: { increment: 1 },
          },
          select: { id: true, status: true, statusChangedAt: true },
        })

        let revokedSids: string[] = []
        if (newStatus !== "active") {
          // Capture session IDs BEFORE deleting so we can revoke their JWTs
          // outside the transaction (Redis call — must not be in tx).
          // We MUST select `id` (the cuid used as JWT `sid` claim) — the
          // middleware's `isSessionRevoked(payload.sid)` keys on this value.
          // (`sessionToken` is a different cuid used as session lookup key
          // and not what the JWT carries.)
          const sids = await tx.session.findMany({
            where: { userId: targetUserId },
            select: { id: true },
          })
          revokedSids = sids.map((s) => s.id)
          await tx.session.deleteMany({ where: { userId: targetUserId } })
        }

        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "UPDATE",
          resource: "USER",
          resourceId: String(targetUserId),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          oldValue: { status: current.status },
          newValue: { status: newStatus },
          metadata: {
            transition: `${current.status}->${newStatus}`,
            revokedSessionsCount: revokedSids.length,
          },
        })

        return { ...updated, changed: true, revokedSids }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

    // Step 2 — Revoke live JWTs in Redis (outside the transaction).
    // ⚠️ Le middleware Edge enforce via Redis (révocation + activité), PAS via la
    // DB : si l'ÉCRITURE Redis échoue ici, le token reste utilisable sur les routes
    // protégées jusqu'au prochain `/api/auth/refresh` (où `av`/statut le rejettent),
    // soit ≤ 15 min. La suppression DB des sessions n'est donc PAS un filet pour le
    // middleware (seulement pour le refresh). On logue tout échec pour alerter ops
    // (fenêtre dégradée), authVersion étant la borne garantie.
    if (result.revokedSids.length > 0) {
      await Promise.all(
        result.revokedSids.flatMap((sid) => [
          revokeSession(sid, SESSION_REVOKE_TTL_S).catch((err) => {
            logger.error("user-mgmt", "Failed to revoke session in Redis", {
              userId: auditUserId,
            }, err)
          }),
          // US-2621 — ferme aussi la fenêtre d'activité du sid révoqué.
          clearActivity(sid).catch((err) => {
            logger.error("user-mgmt", "Failed to clear activity window in Redis", {
              userId: auditUserId,
            }, err)
          }),
        ]),
      )
    }

    if (result.changed) {
      logger.info("user-mgmt", "User status transition", {
        userId: auditUserId,
        statusCode: 200,
        action: "UPDATE",
        resource: "USER",
      })
    }

    return {
      id: result.id,
      status: result.status,
      statusChangedAt: result.statusChangedAt,
      changed: result.changed,
    }
  },
}
