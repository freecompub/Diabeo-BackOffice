/**
 * @module nurse-dashboard.service
 * @description Groupe 9b Batch 2 — Dashboard infirmier (5 US, ~31 SP).
 *
 *  - US-2405 page principale (page conteneur — server component)
 *  - US-2406 KPI ma journée (4 metrics : RDV à préparer, événements à
 *    valider, urgences observées, propositions à connaître)
 *  - US-2407 to-do du jour (READ-ONLY dans ce PR — compute on-demand
 *    depuis Appointment + DiabetesEvent + AdjustmentProposal ; checkbox
 *    completion + 30s undo + notification doctor deferred — exige une
 *    table `NurseTaskItem` dédiée)
 *  - US-2408 coordination équipe (réutilise `DelegationRequest` comme
 *    inbox workflow nurse ↔ doctor ; libre chat deferred — exige
 *    `TeamMessage` table)
 *  - US-2409 relances en attente (heuristique fallback : Patient sans
 *    CGM >7j OU Appointment pending_validation >3j ; Twilio SMS deferred
 *    — UI utilise `tel:` + `sms:` URI natif)
 *
 * Tous endpoints NURSE+ avec portfolio scope via `getAccessiblePatientIds`.
 *
 * ⚠️ Deferred to follow-up issues :
 *  - `NurseTaskItem` table + checkbox completion + 30s undo (US-2407 v2)
 *  - `TeamMessage` libre chat (US-2408 v2)
 *  - `PatientRecallLog` + Twilio SMS server-side (US-2409 v2)
 *  - US-2800 risk algorithm integration (V4 dependency)
 */

import {
  AppointmentStatus,
  EmergencyAlertStatus,
  DelegationRequestStatus,
  ProposalStatus,
  type Prisma,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { getAccessiblePatientIds } from "@/lib/access-control"
import { auditService, type AuditContext } from "./audit.service"
import { safeDecryptField } from "@/lib/crypto/fields"
import { todayBounds, todayDateBounds } from "@/lib/cabinet-time"
import type { Role } from "@prisma/client"

// ─────────────────────────────────────────────────────────────
// Shared helpers (mirrors doctor-dashboard.service)
// ─────────────────────────────────────────────────────────────

/**
 * Build the patient-portfolio `WHERE` clause for cross-patient queries.
 * Returns `null` for empty portfolio (caller short-circuits).
 * Always includes `patient.deletedAt: null` (RGPD Art. 17 cascade).
 */
function patientScopeWhere(
  ids: number[] | null,
): { patientId?: { in: number[] }; patient?: { deletedAt: null } } | null {
  if (ids === null) return { patient: { deletedAt: null } }
  if (ids.length === 0) return null
  return { patientId: { in: ids }, patient: { deletedAt: null } }
}

const CABINET_TIMEZONE = "Europe/Paris"

// Bornes « aujourd'hui » importées de @/lib/cabinet-time (source unique testée,
// cf. cabinet-time.test.ts) :
//  - todayBounds()      → timestamptz décalés TZ cabinet, pour les colonnes
//    @db.Timestamptz (DiabetesEvent.createdAt, EmergencyAlert.triggeredAt).
//  - todayDateBounds()  → minuit UTC du jour cabinet, pour la colonne @db.Date
//    Appointment.date (sinon Prisma tronque les bornes décalées et exclut le
//    jour courant). Plus de copie locale → plus de dérive.

// ─────────────────────────────────────────────────────────────
// US-2406 — KPI "Ma journée"
// ─────────────────────────────────────────────────────────────

export type NurseKpiCard = {
  code: "rdvToPrepare" | "eventsToValidate" | "openUrgencies" | "proposalsPending"
  value: number
  unit: string | null
}

export const nurseKpiQuery = {
  async forCaller(
    userId: number, role: Role,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<NurseKpiCard[]> {
    const ids = await getAccessiblePatientIds(userId, role)
    const scope = patientScopeWhere(ids)
    if (scope === null) {
      const zero: NurseKpiCard[] = [
        { code: "rdvToPrepare", value: 0, unit: null },
        { code: "eventsToValidate", value: 0, unit: null },
        { code: "openUrgencies", value: 0, unit: null },
        { code: "proposalsPending", value: 0, unit: null },
      ]
      return zero
    }
    const { start, end } = todayBounds()
    // Appointment.date = @db.Date → bornes date-only (cf. todayDateBounds).
    const { start: dayStart, end: dayEnd } = todayDateBounds()
    const [rdvToPrepare, eventsToValidate, openUrgencies, proposalsPending]
      = await Promise.all([
        prisma.appointment.count({
          where: {
            ...scope,
            date: { gte: dayStart, lt: dayEnd },
            status: { in: [AppointmentStatus.scheduled, AppointmentStatus.pending_validation] },
          },
        }),
        prisma.diabetesEvent.count({
          where: {
            ...scope,
            validatedAt: null,
            createdAt: { gte: start, lt: end },
          },
        }),
        prisma.emergencyAlert.count({
          where: {
            ...scope,
            status: { in: [EmergencyAlertStatus.open, EmergencyAlertStatus.acknowledged] },
          },
        }),
        prisma.adjustmentProposal.count({
          where: {
            ...scope,
            status: ProposalStatus.pending,
          },
        }),
      ])

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.infirmier.kpi" },
    })

    return [
      { code: "rdvToPrepare", value: rdvToPrepare, unit: null },
      { code: "eventsToValidate", value: eventsToValidate, unit: null },
      { code: "openUrgencies", value: openUrgencies, unit: null },
      { code: "proposalsPending", value: proposalsPending, unit: null },
    ]
  },
}

// ─────────────────────────────────────────────────────────────
// US-2407 — To-do du jour (READ-ONLY, on-demand)
// ─────────────────────────────────────────────────────────────

export type TodoItem = {
  /** Composite id : `${kind}-${nativeId}` (no DB row yet — table deferred). */
  id: string
  kind: "prepareAppointment" | "validateEvent" | "observeProposal"
  patientId: number
  patientFirstName: string
  pathology: string | null
  /** Either a clock-time (HH:MM) or null for "today flexible". */
  dueLabel: string | null
  /** Free-form label suitable for a UI row. */
  label: string
  /** Higher = more urgent. */
  score: number
}

const TODO_LIMIT = 20

export const nurseTodoQuery = {
  /**
   * Compute the to-do list on-demand from three sources :
   *  - Today's appointments (status scheduled/pending_validation) → prepare folder
   *  - DiabetesEvent created today with validatedAt=null → validate measurement
   *  - AdjustmentProposal pending → observe (read-only for NURSE per RBAC)
   *
   * READ-ONLY in this PR : checkbox completion + 30s undo + notification
   * doctor deferred (requires `NurseTaskItem` table — V2).
   */
  async forCaller(
    userId: number, role: Role,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<TodoItem[]> {
    const ids = await getAccessiblePatientIds(userId, role)
    const scope = patientScopeWhere(ids)
    if (scope === null) return []
    const { start, end } = todayBounds()
    // Appointment.date = @db.Date → bornes date-only (cf. todayDateBounds).
    const { start: dayStart, end: dayEnd } = todayDateBounds()

    const include = {
      patient: {
        select: {
          id: true, pathology: true,
          user: { select: { firstname: true } },
        },
      },
    } as const

    const [appts, events, proposals] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          ...scope,
          date: { gte: dayStart, lt: dayEnd },
          status: { in: [AppointmentStatus.scheduled, AppointmentStatus.pending_validation] },
        },
        include,
        orderBy: [{ hour: "asc" }],
        take: TODO_LIMIT,
      }),
      prisma.diabetesEvent.findMany({
        where: {
          ...scope,
          validatedAt: null,
          createdAt: { gte: start, lt: end },
        },
        include,
        orderBy: [{ createdAt: "desc" }],
        take: TODO_LIMIT,
      }),
      prisma.adjustmentProposal.findMany({
        where: {
          ...scope,
          status: ProposalStatus.pending,
        },
        include,
        orderBy: [{ createdAt: "desc" }],
        take: TODO_LIMIT,
      }),
    ])

    const fmtHour = (h: Date | null): string | null => {
      if (!h) return null
      return new Date(h).toLocaleTimeString("fr-FR", {
        hour: "2-digit", minute: "2-digit", timeZone: CABINET_TIMEZONE,
      })
    }

    // code-review M1 (re-review) — score truly imminent appointments higher.
    //   minutesUntilAppt = (apptDateTime - now) / 60_000, clamped to ±24h.
    //   100 - clamp/14.4 : 0min away → 100, 24h away → ~0, already passed
    //   → small positive (caps via clamp lower bound).
    const nowMs = Date.now()
    const items: TodoItem[] = []
    for (const a of appts) {
      const firstname = safeDecryptField(a.patient.user.firstname ?? "") ?? ""
      const time = fmtHour(a.hour)
      let score = 50 // no time → default
      if (a.hour) {
        const minutesUntil = (new Date(a.hour).getTime() - nowMs) / 60_000
        const clamped = Math.max(-60, Math.min(1440, minutesUntil))
        score = 100 - clamped / 14.4
      }
      items.push({
        id: `appt-${a.id}`,
        kind: "prepareAppointment",
        patientId: a.patientId,
        patientFirstName: firstname,
        pathology: a.patient.pathology,
        dueLabel: time,
        label: time
          ? `Préparer le dossier — RDV ${time}`
          : "Préparer le dossier patient",
        score,
      })
    }
    for (const e of events) {
      const firstname = safeDecryptField(e.patient.user.firstname ?? "") ?? ""
      items.push({
        id: `event-${e.id}`,
        kind: "validateEvent",
        patientId: e.patientId,
        patientFirstName: firstname,
        pathology: e.patient.pathology,
        dueLabel: fmtHour(e.createdAt),
        label: "Valider la mesure saisie",
        score: 70,
      })
    }
    for (const p of proposals) {
      const firstname = safeDecryptField(p.patient.user.firstname ?? "") ?? ""
      items.push({
        id: `proposal-${p.id}`,
        kind: "observeProposal",
        patientId: p.patientId,
        patientFirstName: firstname,
        pathology: p.patient.pathology,
        dueLabel: null,
        label: "Proposition à observer (DOCTOR valide)",
        score: 30, // lowest — NURSE read-only
      })
    }

    const top = items.sort((a, b) => b.score - a.score).slice(0, TODO_LIMIT)

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.infirmier.todo", count: top.length },
    })

    return top
  },
}

// ─────────────────────────────────────────────────────────────
// US-2408 — Coordination équipe (inbox DelegationRequest)
// ─────────────────────────────────────────────────────────────

export type TeamInboxItem = {
  id: number
  patientId: number
  patientFirstName: string
  action: string
  status: DelegationRequestStatus
  /** Direction wrt caller : "incoming" if user is `toUserId`, "outgoing" otherwise. */
  direction: "incoming" | "outgoing"
  /** Peer user id (the other party of the delegation). */
  peerUserId: number
  createdAt: Date
  reviewedAt: Date | null
  reason: string | null
}

const TEAM_INBOX_LIMIT = 5

export const nurseTeamInboxQuery = {
  async forCaller(
    userId: number, role: Role,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<TeamInboxItem[]> {
    // code-review H1 (re-review) — cabinet scope. Restrict delegations to
    //   patients the caller can access (`getAccessiblePatientIds`). Without
    //   this, a NURSE covering for another cabinet would see incoming/outgoing
    //   delegations from outside her primary service (RBAC leak).
    //
    // code-review L5 — `expired` excluded from the inbox by design : nurse
    //   workflow surfaces only actionable rows. Expired delegations remain
    //   in the audit log + history view but don't clutter the dashboard.
    const ids = await getAccessiblePatientIds(userId, role)
    if (ids !== null && ids.length === 0) return []
    const rows = await prisma.delegationRequest.findMany({
      where: {
        OR: [{ fromUserId: userId }, { toUserId: userId }],
        status: { in: [
          DelegationRequestStatus.pending,
          DelegationRequestStatus.approved,
          DelegationRequestStatus.rejected,
        ] },
        patient: { deletedAt: null },
        ...(ids ? { patientId: { in: ids } } : {}),
      },
      include: {
        patient: {
          select: {
            id: true,
            user: { select: { firstname: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: TEAM_INBOX_LIMIT,
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "DELEGATION_REQUEST",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "dashboard.infirmier.teamInbox", count: rows.length },
    })

    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      patientFirstName: safeDecryptField(r.patient.user.firstname ?? "") ?? "",
      action: r.action,
      status: r.status,
      direction: r.toUserId === userId ? "incoming" : "outgoing",
      peerUserId: r.toUserId === userId ? r.fromUserId : r.toUserId,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      reason: r.reason,
    }))
  },
}

// ─────────────────────────────────────────────────────────────
// US-2409 — Relances en attente (heuristique fallback)
// ─────────────────────────────────────────────────────────────

// code-review M2 (re-review) — `neverSynced` distinguishes a never-active
//   patient from one who went silent. UI displays a different label and
//   skips the misleading "14 j sans saisie" message.
export type RecallReason =
  | "silentMonitoring"
  | "appointmentUnconfirmed"
  | "neverSynced"

export type RecallItem = {
  patientId: number
  patientFirstName: string
  pathology: string | null
  reason: RecallReason
  metricLabel: string
  /** Encrypted phone — frontend decrypts via `safeDecryptField` (already done here). */
  phone: string | null
  score: number
}

const RECALL_LIMIT = 5
const SILENT_DAYS = 7
const APPT_PENDING_DAYS = 3

export const nurseRecallQuery = {
  /**
   * Compute relances on-demand using two heuristics :
   *  - silentMonitoring : Patient with no CGM entry in 7+ days
   *  - appointmentUnconfirmed : Appointment with status=pending_validation
   *    created more than 3 days ago
   *
   * V2 (deferred) : driven by US-2800 risk algorithm output + persisted
   * `PatientRecallLog` table for action audit.
   */
  async forCaller(
    userId: number, role: Role,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<RecallItem[]> {
    const ids = await getAccessiblePatientIds(userId, role)
    if (ids !== null && ids.length === 0) return []
    const now = new Date()
    const silentCutoff = new Date(now.getTime() - SILENT_DAYS * 86_400_000)
    const apptPendingCutoff = new Date(now.getTime() - APPT_PENDING_DAYS * 86_400_000)
    const patientFilter = { patient: { deletedAt: null } }

    const [latestCgm, unconfirmedAppts, adminPortfolio] = await Promise.all([
      prisma.cgmEntry.groupBy({
        by: ["patientId"],
        where: {
          ...(ids ? { patientId: { in: ids } } : {}),
          ...patientFilter,
        },
        _max: { timestamp: true },
      }),
      prisma.appointment.findMany({
        where: {
          ...(ids ? { patientId: { in: ids } } : {}),
          ...patientFilter,
          status: AppointmentStatus.pending_validation,
          createdAt: { lte: apptPendingCutoff },
        },
        select: { patientId: true, createdAt: true },
        distinct: ["patientId"],
      }),
      // code-review M3 (re-review) — ADMIN portfolio cap 1000 patients.
      //   Intentional bound on the silent-monitoring scan ; for >1000-patient
      //   deployments the top 5 may under-report (sorted by `Patient.id` asc).
      //   Audit metadata flags `wasTruncated: true` when the cap hits so
      //   forensics knows the dataset is incomplete.
      ids === null
        ? prisma.patient.findMany({
            where: { deletedAt: null },
            select: { id: true },
            take: 1000,
          })
        : Promise.resolve(null),
    ])

    const latestByPatient = new Map(
      latestCgm.map((r) => [r.patientId, r._max.timestamp]),
    )
    const flags = new Map<number, RecallItem>()

    // Heuristic 1 — silentMonitoring vs neverSynced.
    const portfolioIds = ids ?? (adminPortfolio ?? []).map((p) => p.id)
    for (const pid of portfolioIds) {
      const last = latestByPatient.get(pid)
      if (last === undefined || last === null) {
        // No CGM entry ever → distinct reason ; no fake day count.
        flags.set(pid, {
          patientId: pid,
          patientFirstName: "",
          pathology: null,
          reason: "neverSynced",
          metricLabel: "Aucune saisie enregistrée",
          phone: null,
          score: 50,
        })
      } else if (last < silentCutoff) {
        const days = Math.floor((now.getTime() - last.getTime()) / 86_400_000)
        flags.set(pid, {
          patientId: pid,
          patientFirstName: "",
          pathology: null,
          reason: "silentMonitoring",
          metricLabel: `${days} j sans saisie`,
          phone: null,
          score: 50 + Math.min(50, days),
        })
      }
    }

    // Heuristic 2 — appointmentUnconfirmed (higher priority).
    for (const a of unconfirmedAppts) {
      const days = Math.floor((now.getTime() - a.createdAt.getTime()) / 86_400_000)
      flags.set(a.patientId, {
        patientId: a.patientId,
        patientFirstName: "",
        pathology: null,
        reason: "appointmentUnconfirmed",
        metricLabel: `RDV non confirmé ${days}j`,
        phone: null,
        score: 100 + days,
      })
    }

    const top = Array.from(flags.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, RECALL_LIMIT)

    // Summary audit + wasTruncated flag (M3 forensics).
    const adminTruncated = ids === null && (adminPortfolio?.length ?? 0) >= 1000
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT",
      resourceId: "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: {
        kind: "dashboard.infirmier.recallList",
        count: top.length,
        ...(adminTruncated ? { wasTruncated: true } : {}),
      },
    })

    if (top.length === 0) return []

    // Hydrate firstname + pathology + phone for top N.
    const patients = await prisma.patient.findMany({
      where: { id: { in: top.map((t) => t.patientId) }, deletedAt: null },
      select: {
        id: true, pathology: true,
        user: { select: { firstname: true, phone: true } },
      },
    })
    const byId = new Map(patients.map((p) => [p.id, p]))

    // Per-patient pivot audit (US-2268 forensic).
    await Promise.allSettled(top.map((t) =>
      auditService.log({
        userId: auditUserId, action: "READ", resource: "PATIENT",
        resourceId: String(t.patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: t.patientId,
          kind: "dashboard.infirmier.recallList",
          reason: t.reason,
        },
      }),
    ))

    return top.map((t) => {
      const p = byId.get(t.patientId)
      return {
        patientId: t.patientId,
        patientFirstName: safeDecryptField(p?.user?.firstname ?? "") ?? "",
        pathology: p?.pathology ?? null,
        reason: t.reason,
        metricLabel: t.metricLabel,
        phone: safeDecryptField(p?.user?.phone ?? "") ?? null,
        score: t.score,
      }
    })
  },
}

// Suppress unused import warning when used only in tests.
export type { Prisma as _Prisma }
