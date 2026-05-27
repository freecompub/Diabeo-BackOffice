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

/**
 * Transitions FSM autorisées.
 *
 * M5 (review re-1 PR #409) — `closed` est **terminal** : pas de
 * réouverture. Si une violation est clôturée à tort, la procédure
 * est de créer un nouveau dossier référençant l'ancien via
 * `description`. Documenter dans l'UI admin que la fermeture est
 * irréversible.
 */
/**
 * Fix H3 round 1 review PR #457 — exporté `as const` pour réutilisation UI
 * via DTO `allowedTransitions` (single source of truth — UI ne duplique
 * plus les transitions hardcoded, élimine risque divergence backend ↔ UI).
 */
export const ALLOWED_TRANSITIONS: Record<DataBreachStatus, readonly DataBreachStatus[]> = {
  draft: ["under_assessment", "closed"],
  under_assessment: ["notified_cnil", "closed"],
  notified_cnil: ["notified_users", "closed"],
  notified_users: ["closed"],
  closed: [],
} as const

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
  /**
   * Heures restantes avant l'échéance CNIL 72h (si applicable).
   * `null` si severity < high OU si déjà notifié/closed.
   *
   * M1 (review re-1 PR #409) — cap floor à 0 (jamais négatif).
   * Le flag `cnilDeadlineExceeded` indique le dépassement réel.
   */
  cnilDeadlineHoursRemaining: number | null
  /** M1 — `true` si severity ≥ high ET deadline 72h dépassée sans notification CNIL. */
  cnilDeadlineExceeded: boolean
  /**
   * Fix H3 round 1 review PR #457 — Transitions FSM autorisées depuis
   * le `status` actuel. UI consomme ce champ directement (vs ancien
   * `ALLOWED_TRANSITIONS` hardcoded côté UI qui risquait divergence si
   * backend ajoutait une transition).
   */
  allowedTransitions: readonly DataBreachStatus[]
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
  let cnilDeadlineExceeded = false
  if (
    (b.status === "draft" || b.status === "under_assessment")
    && (b.severity === "high" || b.severity === "critical")
  ) {
    const deadlineMs = b.detectedAt.getTime() + DATA_BREACH_BOUNDS.CNIL_NOTIFICATION_DEADLINE_HOURS * 3_600_000
    const rawHours = Math.floor((deadlineMs - now) / 3_600_000)
    // M1 (review re-1) — cap floor à 0, flag dépassement explicite.
    cnilDeadlineHoursRemaining = Math.max(0, rawHours)
    cnilDeadlineExceeded = rawHours < 0
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
    cnilDeadlineExceeded,
    // Fix H3 round 1 PR #457 — single source of truth FSM côté backend.
    allowedTransitions: ALLOWED_TRANSITIONS[b.status],
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }
}

/**
 * M2 (review re-1 PR #409) — Heuristique anti-PHI dans le `title`.
 * Le title n'est PAS chiffré (search/listing) → un admin pourrait
 * y mettre du PHI par erreur. On reject les patterns probables :
 *   - NIRPP (15 chiffres bruts)
 *   - Numéro INS (15 chars commence par 1 ou 2)
 *   - Numéro téléphone FR (10 digits ou +33...)
 *
 * Ces patterns sont conservateurs — un admin qui écrit "Lot 1850734
 * compromis" hit le NIRPP-like check par erreur. Acceptable :
 * l'admin reformule le title sans identifiant numérique. Documentation
 * dans la JSDoc du model.
 */
function assertNoPiiInTitle(title: string): void {
  // NIRPP / INS = 15 digits consecutifs.
  if (/\d{15}/.test(title)) {
    throw new DataBreachValidationError("title.piiPattern")
  }
  // Téléphone FR : +33 puis 9 digits, ou 0 puis 9 digits.
  if (/(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}/.test(title)) {
    throw new DataBreachValidationError("title.piiPattern")
  }
  // Email littéral.
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(title)) {
    throw new DataBreachValidationError("title.piiPattern")
  }
}

function validateDeclare(input: DeclareInput): void {
  if (!input.title || input.title.length > DATA_BREACH_BOUNDS.MAX_TITLE_LEN) {
    throw new DataBreachValidationError("title")
  }
  assertNoPiiInTitle(input.title)
  if (input.description != null && input.description.length > DATA_BREACH_BOUNDS.MAX_DESCRIPTION_LEN) {
    throw new DataBreachValidationError("description")
  }
  if (input.detectedAt != null) {
    const ts = input.detectedAt.getTime()
    if (!Number.isFinite(ts)) throw new DataBreachValidationError("detectedAt")
    // L5 (review re-1) — fenêtre étendue à 5 ans (rétention RGPD typique).
    // Couvre les violations découvertes longtemps après les faits.
    if (ts < Date.now() - 5 * 365 * 86_400_000) {
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
        // L3 (review re-1) — cursor inclus pour forensique pagination.
        ...(filters.cursor ? { cursor: filters.cursor } : {}),
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
    // L1 (review re-1 PR #409) — audit `fields` expose les noms
    // business (description, remediation, cnilCaseNumber) au lieu
    // des noms internes Prisma chiffrés (descriptionEnc, etc.) qui
    // exposent l'implémentation. Clé du business sans rien révéler.
    const auditFields: string[] = []
    if (input.severity !== undefined) {
      data.severity = input.severity
      auditFields.push("severity")
    }
    if (input.description !== undefined) {
      data.descriptionEnc = input.description == null ? null : encryptField(input.description)
      auditFields.push("description")
    }
    if (input.remediation !== undefined) {
      data.remediationEnc = input.remediation == null ? null : encryptField(input.remediation)
      auditFields.push("remediation")
    }
    if (input.cnilCaseNumber !== undefined) {
      data.cnilCaseNumberEnc = input.cnilCaseNumber == null ? null : encryptField(input.cnilCaseNumber)
      auditFields.push("cnilCaseNumber")
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
          fields: auditFields,
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
