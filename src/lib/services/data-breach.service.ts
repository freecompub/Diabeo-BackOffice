/**
 * @module data-breach.service
 * @description Groupe 9 — US-2137 Notification violation données (RGPD Art. 33).
 *
 * Registre obligatoire RGPD : toute violation de données personnelles
 * doit être tracée. Si gravité ≥ high, notification CNIL sous 72h
 * (timer démarré à `detectedAt`). Si risque élevé pour les personnes
 * affectées, notification additionnelle aux users concernés (Art. 34).
 *
 * Machine d'états :
 *   draft → under_assessment → notified_cnil → notified_users → closed
 *   draft → closed (false_alarm)
 *   under_assessment → closed (non_qualifying — pas de violation réelle)
 *
 * Champs sensibles (description, remediation, cnilCaseNumber) chiffrés
 * AES-256-GCM avant stockage. Accès ADMIN-only.
 */

import {
  DataBreachSeverity,
  DataBreachStatus,
  type DataBreach,
  type Prisma,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService, type AuditContext } from "./audit.service"

// ─────────────────────────────────────────────────────────────
// Audit kinds typés
// ─────────────────────────────────────────────────────────────

export type DataBreachAuditKind =
  | "data_breach.declare"
  | "data_breach.read"
  | "data_breach.list"
  | "data_breach.assess"
  | "data_breach.notify.cnil"
  | "data_breach.notify.users"
  | "data_breach.close"

const AUDIT_KIND = {
  DECLARE: "data_breach.declare",
  READ: "data_breach.read",
  LIST: "data_breach.list",
  ASSESS: "data_breach.assess",
  NOTIFY_CNIL: "data_breach.notify.cnil",
  NOTIFY_USERS: "data_breach.notify.users",
  CLOSE: "data_breach.close",
} as const satisfies Record<string, DataBreachAuditKind>

// ─────────────────────────────────────────────────────────────
// Erreurs typées
// ─────────────────────────────────────────────────────────────

export class DataBreachValidationError extends Error {
  constructor(public field: string) {
    super(field)
    this.name = "DataBreachValidationError"
  }
}

export class DataBreachNotFoundError extends Error {
  constructor() {
    super("dataBreachNotFound")
    this.name = "DataBreachNotFoundError"
  }
}

export class DataBreachStateError extends Error {
  constructor(public from: DataBreachStatus, public to: DataBreachStatus) {
    super(`invalid data breach transition: ${from} → ${to}`)
    this.name = "DataBreachStateError"
  }
}

// ─────────────────────────────────────────────────────────────
// Bornes & FSM
// ─────────────────────────────────────────────────────────────

export const DATA_BREACH_BOUNDS = {
  MAX_TITLE_LEN: 200,
  MAX_DESCRIPTION_LEN: 5000,
  MAX_REMEDIATION_LEN: 5000,
  MAX_CNIL_CASE_NUMBER_LEN: 100,
  MAX_LIST_LIMIT: 200,
  /** Délai CNIL Art. 33 (heures depuis detectedAt). */
  CNIL_NOTIFICATION_DEADLINE_HOURS: 72,
} as const

/** Transitions FSM autorisées. */
const ALLOWED_TRANSITIONS: Record<DataBreachStatus, DataBreachStatus[]> = {
  draft: ["under_assessment", "closed"],
  under_assessment: ["notified_cnil", "closed"],
  notified_cnil: ["notified_users", "closed"],
  notified_users: ["closed"],
  closed: [],
}

function assertTransition(from: DataBreachStatus, to: DataBreachStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new DataBreachStateError(from, to)
  }
}

// ─────────────────────────────────────────────────────────────
// DTO
// ─────────────────────────────────────────────────────────────

export interface DataBreachDTO {
  id: number
  severity: DataBreachSeverity
  status: DataBreachStatus
  title: string
  description: string | null
  remediation: string | null
  cnilCaseNumber: string | null
  usersNotifiedCount: number
  detectedAt: Date
  declaredBy: number | null
  cnilNotifiedAt: Date | null
  usersNotifiedAt: Date | null
  closedAt: Date | null
  /** Heures restantes avant l'échéance CNIL 72h (si applicable). `null` si déjà notifié ou closed. */
  cnilDeadlineHoursRemaining: number | null
  createdAt: Date
  updatedAt: Date
}

interface DeclareInput {
  severity: DataBreachSeverity
  title: string
  description?: string
  detectedAt?: Date
}

interface UpdateInput {
  description?: string | null
  remediation?: string | null
  cnilCaseNumber?: string | null
  severity?: DataBreachSeverity
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function toDTO(b: DataBreach): DataBreachDTO {
  const now = Date.now()
  let cnilDeadlineHoursRemaining: number | null = null
  if (
    (b.status === "draft" || b.status === "under_assessment")
    && (b.severity === "high" || b.severity === "critical")
  ) {
    const deadlineMs = b.detectedAt.getTime() + DATA_BREACH_BOUNDS.CNIL_NOTIFICATION_DEADLINE_HOURS * 3_600_000
    cnilDeadlineHoursRemaining = Math.floor((deadlineMs - now) / 3_600_000)
  }
  return {
    id: b.id,
    severity: b.severity,
    status: b.status,
    title: b.title,
    description: safeDecryptField(b.descriptionEnc),
    remediation: safeDecryptField(b.remediationEnc),
    cnilCaseNumber: safeDecryptField(b.cnilCaseNumberEnc),
    usersNotifiedCount: b.usersNotifiedCount,
    detectedAt: b.detectedAt,
    declaredBy: b.declaredBy,
    cnilNotifiedAt: b.cnilNotifiedAt,
    usersNotifiedAt: b.usersNotifiedAt,
    closedAt: b.closedAt,
    cnilDeadlineHoursRemaining,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }
}

function validateDeclare(input: DeclareInput): void {
  if (!input.title || input.title.length > DATA_BREACH_BOUNDS.MAX_TITLE_LEN) {
    throw new DataBreachValidationError("title")
  }
  if (input.description != null && input.description.length > DATA_BREACH_BOUNDS.MAX_DESCRIPTION_LEN) {
    throw new DataBreachValidationError("description")
  }
  if (input.detectedAt != null) {
    const ts = input.detectedAt.getTime()
    if (!Number.isFinite(ts)) throw new DataBreachValidationError("detectedAt")
    // Pas de detection antidatée > 1 an, pas dans le futur.
    if (ts < Date.now() - 365 * 86_400_000) {
      throw new DataBreachValidationError("detectedAt.tooOld")
    }
    if (ts > Date.now() + 5 * 60_000) {
      throw new DataBreachValidationError("detectedAt.future")
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const dataBreachService = {
  /** Déclare une nouvelle violation (status=draft). */
  async declare(
    input: DeclareInput,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<DataBreachDTO> {
    validateDeclare(input)

    const breach = await prisma.$transaction(async (tx) => {
      const created = await tx.dataBreach.create({
        data: {
          severity: input.severity,
          status: "draft",
          title: input.title,
          descriptionEnc: input.description ? encryptField(input.description) : null,
          detectedAt: input.detectedAt ?? new Date(),
          declaredBy: auditUserId,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "DATA_BREACH",
        resourceId: String(created.id),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          kind: AUDIT_KIND.DECLARE,
          severity: input.severity,
        },
      })
      return created
    })

    return toDTO(breach)
  },

  /** Lecture détaillée — ADMIN-only au layer route. */
  async getById(
    id: number,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<DataBreachDTO | null> {
    const breach = await prisma.dataBreach.findUnique({ where: { id } })
    if (!breach) return null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "DATA_BREACH",
      resourceId: String(id),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { kind: AUDIT_KIND.READ },
    })

    return toDTO(breach)
  },

  /** Liste filtrée par status/severity. */
  async list(
    filters: {
      status?: DataBreachStatus
      severity?: DataBreachSeverity
      limit?: number
      cursor?: number
    },
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<DataBreachDTO[]> {
    const limit = Math.min(filters.limit ?? 50, DATA_BREACH_BOUNDS.MAX_LIST_LIMIT)
    const rows = await prisma.dataBreach.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.severity ? { severity: filters.severity } : {}),
      },
      orderBy: { detectedAt: "desc" },
      take: limit,
      ...(filters.cursor ? { skip: 1, cursor: { id: filters.cursor } } : {}),
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "DATA_BREACH",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        kind: AUDIT_KIND.LIST,
        count: rows.length,
        ...(filters.status ? { statusFilter: filters.status } : {}),
        ...(filters.severity ? { severityFilter: filters.severity } : {}),
      },
    })

    return rows.map(toDTO)
  },

  /**
   * Met à jour les champs textuels (description, remediation, cnilCaseNumber)
   * et/ou la sévérité. Pas de FSM transition ici — utiliser `transition*`.
   */
  async update(
    id: number,
    input: UpdateInput,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<DataBreachDTO> {
    if (input.cnilCaseNumber != null
      && input.cnilCaseNumber.length > DATA_BREACH_BOUNDS.MAX_CNIL_CASE_NUMBER_LEN) {
      throw new DataBreachValidationError("cnilCaseNumber")
    }
    if (input.description != null
      && input.description.length > DATA_BREACH_BOUNDS.MAX_DESCRIPTION_LEN) {
      throw new DataBreachValidationError("description")
    }
    if (input.remediation != null
      && input.remediation.length > DATA_BREACH_BOUNDS.MAX_REMEDIATION_LEN) {
      throw new DataBreachValidationError("remediation")
    }

    const data: Prisma.DataBreachUpdateInput = {}
    if (input.severity !== undefined) data.severity = input.severity
    if (input.description !== undefined) {
      data.descriptionEnc = input.description == null ? null : encryptField(input.description)
    }
    if (input.remediation !== undefined) {
      data.remediationEnc = input.remediation == null ? null : encryptField(input.remediation)
    }
    if (input.cnilCaseNumber !== undefined) {
      data.cnilCaseNumberEnc = input.cnilCaseNumber == null ? null : encryptField(input.cnilCaseNumber)
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.dataBreach.update({ where: { id }, data })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "DATA_BREACH",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          kind: AUDIT_KIND.ASSESS,
          fields: Object.keys(data),
        },
      })
      return u
    })

    return toDTO(updated)
  },

  /**
   * Effectue une transition FSM. `to` doit être autorisé depuis le
   * status courant ; le service met à jour les timestamps appropriés.
   */
  async transition(
    id: number,
    to: DataBreachStatus,
    auditUserId: number,
    extras: { usersNotifiedCount?: number } = {},
    ctx?: AuditContext,
  ): Promise<DataBreachDTO> {
    const existing = await prisma.dataBreach.findUnique({ where: { id } })
    if (!existing) throw new DataBreachNotFoundError()
    assertTransition(existing.status, to)

    const now = new Date()
    const data: Prisma.DataBreachUpdateInput = { status: to }
    let kind: DataBreachAuditKind
    switch (to) {
      case "notified_cnil":
        data.cnilNotifiedAt = now
        kind = AUDIT_KIND.NOTIFY_CNIL
        break
      case "notified_users":
        data.usersNotifiedAt = now
        if (extras.usersNotifiedCount != null) {
          if (!Number.isInteger(extras.usersNotifiedCount) || extras.usersNotifiedCount < 0) {
            throw new DataBreachValidationError("usersNotifiedCount")
          }
          data.usersNotifiedCount = extras.usersNotifiedCount
        }
        kind = AUDIT_KIND.NOTIFY_USERS
        break
      case "closed":
        data.closedAt = now
        kind = AUDIT_KIND.CLOSE
        break
      case "under_assessment":
        kind = AUDIT_KIND.ASSESS
        break
      default:
        kind = AUDIT_KIND.ASSESS
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.dataBreach.update({ where: { id }, data })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "DATA_BREACH",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          kind,
          previousStatus: existing.status,
          newStatus: to,
          ...(extras.usersNotifiedCount != null ? { usersNotifiedCount: extras.usersNotifiedCount } : {}),
        },
      })
      return u
    })

    return toDTO(updated)
  },
}
