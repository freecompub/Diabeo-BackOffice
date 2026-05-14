/**
 * @module rdv.service
 * @description Groupe 8 Batch 1 — Gestion des RDV (5 US, 36 SP).
 *
 *  - US-2500 `appointmentService.listInRange` (calendrier)
 *  - US-2501 `appointmentService.create/get/update/cancel` (CRUD + note chiffrée)
 *  - US-2503 cancel/reschedule bilatéral (state machine)
 *  - US-2504 `memberUnavailabilityService` (plages bloquées)
 *  - US-2505 `memberBookingConfigService` (auto vs validation)
 *
 * Conventions (post-reviews PR #388/389/390/391) :
 *  - Typed errors (`team-workflow.errors`)
 *  - US-2268 audit pivot `metadata.patientId`
 *  - Transactions Serializable sur les écritures (overlap checks intra-tx)
 *  - AES-256-GCM sur `Appointment.noteEncrypted`
 *  - `patientShareConsent` côté route (RGPD Art. 7.3)
 *  - `canAccessPatient` côté route (RBAC)
 */

import {
  Prisma,
  type AppointmentLocation,
  type AppointmentStatus,
  type BookingMode,
  type CancellationActor,
  type Role,
} from "@prisma/client"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./team-workflow.errors"

const DURATION_MIN = 15
const DURATION_MAX = 240
const MOTIF_MAX = 200
const NOTE_MAX = 4096
const RANGE_MAX_DAYS = 62 // ≈ 2 months window
const CANCEL_GRACE_HOURS = 24 // delay below which "doctor cancel" must propose alt
const PROPOSAL_TTL_MS = 7 * 86_400_000 // M10 — alternatives expire after 7 days

async function assertServiceMember(
  userId: number,
  serviceId: number,
  tx: Tx = prisma,
): Promise<void> {
  const link = await tx.healthcareMember.findFirst({
    where: { userId, serviceId }, select: { id: true },
  })
  if (!link) throw new ForbiddenError()
}

/**
 * H11/H2 — guard for routes that scope by `memberId` rather than `patientId`.
 * Ensures the caller is a member of the same service as the target member.
 *
 * **Returns `ForbiddenError` for all failure modes** (member missing, member
 * has no service, caller is not in the same service) — collapses 404 vs 403
 * into a single response shape to prevent cross-tenant memberId enumeration.
 *
 * H7 — single-query implementation : join the membership check with the
 * target lookup to avoid two sequential round-trips.
 */
export async function assertMemberServiceAccess(
  callerUserId: number, memberId: number,
): Promise<void> {
  const target = await prisma.healthcareMember.findFirst({
    where: {
      id: memberId,
      serviceId: { not: null },
      service: { members: { some: { userId: callerUserId } } },
    },
    select: { id: true },
  })
  if (!target) throw new ForbiddenError()
}

async function assertPatientAlive(patientId: number, tx: Tx = prisma): Promise<void> {
  const p = await tx.patient.findFirst({
    where: { id: patientId, deletedAt: null }, select: { id: true },
  })
  if (!p) throw new NotFoundError()
}

/**
 * Combine a `date` (calendar day) + `hour` (time-of-day) into a single UTC
 * instant.
 *
 * **Timezone contract** : both columns are persisted as UTC clock values.
 * The backoffice contract is "absolute UTC wall-clock" — no DST adjustment is
 * applied. Clients (web UI, iOS) are responsible for translating user-local
 * times to UTC before submission, and re-translating UTC back for display.
 * This avoids ambiguity around the autumn DST fall-back hour and keeps the
 * service stateless w.r.t. the patient/practitioner's local zone.
 *
 * If `hour` is null we assume midnight (00:00 UTC).
 */
function combineDateHour(date: Date, hour: Date | null): Date {
  const d = new Date(date)
  if (hour) {
    d.setUTCHours(hour.getUTCHours(), hour.getUTCMinutes(), 0, 0)
  } else {
    d.setUTCHours(0, 0, 0, 0)
  }
  return d
}

/** Compute the end timestamp from start + duration (minutes). */
function computeEnd(start: Date, durationMinutes: number | null): Date {
  return new Date(start.getTime() + (durationMinutes ?? 30) * 60_000)
}

/**
 * Reject if the requested slot overlaps an existing active appointment or
 * unavailability for the member. Active = status NOT IN (cancelled, no_show).
 *
 * `excludeAppointmentId` lets `update/cancel/reschedule` skip the row being
 * modified.
 *
 * Day-bound query expands by 1 day backwards to catch prior-day appointments
 * whose hour+duration spills past midnight into the requested slot (fix C3).
 */
async function assertNoOverlap(
  tx: Tx,
  memberId: number,
  startAt: Date,
  endAt: Date,
  excludeAppointmentId?: number,
): Promise<void> {
  const activeStatuses: AppointmentStatus[] = ["scheduled", "pending_validation", "confirmed"]
  const dayFloor = new Date(startAt)
  dayFloor.setUTCHours(0, 0, 0, 0)
  dayFloor.setUTCDate(dayFloor.getUTCDate() - 1) // include yesterday for cross-midnight
  const dayCeil = new Date(endAt)
  dayCeil.setUTCHours(23, 59, 59, 999)

  const OVERLAP_TAKE = 1000
  const sameDay = await tx.appointment.findMany({
    where: {
      memberId,
      status: { in: activeStatuses },
      date: { gte: dayFloor, lte: dayCeil },
      ...(excludeAppointmentId ? { NOT: { id: excludeAppointmentId } } : {}),
    },
    select: { date: true, hour: true, durationMinutes: true },
    take: OVERLAP_TAKE, // M3 safety cap
  })
  if (sameDay.length === OVERLAP_TAKE) {
    // M4 — silent truncation would miss conflicts beyond position 1000.
    //      Refuse the booking conservatively rather than risk a double-book.
    throw new ValidationError("overlapQueryTruncated")
  }
  for (const a of sameDay) {
    const aStart = combineDateHour(a.date, a.hour)
    const aEnd = computeEnd(aStart, a.durationMinutes)
    if (startAt < aEnd && endAt > aStart) {
      throw new ValidationError("slotOverlapAppointment")
    }
  }

  const unav = await tx.memberUnavailability.findMany({
    where: {
      memberId,
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
    take: 100,
  })
  if (unav.length > 0) throw new ValidationError("slotOverlapUnavailability")
}

// ─────────────────────────────────────────────────────────────
// US-2501 / US-2500 — Appointment CRUD + list
// ─────────────────────────────────────────────────────────────

export type AppointmentDTO = {
  id: number
  patientId: number
  memberId: number | null
  type: string | null
  date: Date
  hour: Date | null
  durationMinutes: number | null
  location: AppointmentLocation | null
  status: AppointmentStatus
  motif: string | null  // decrypted
  note: string | null   // decrypted (only on detail)
  proposedAlternativeAt: Date | null
  cancelledBy: CancellationActor | null
  cancelReason: string | null  // decrypted
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Light DTO for list view — never contains decrypted note or cancelReason. */
export type AppointmentListItemDTO = Omit<AppointmentDTO, "note" | "cancelReason">

type AppointmentRow = {
  id: number; patientId: number; memberId: number | null;
  type: string | null; date: Date; hour: Date | null;
  durationMinutes: number | null;
  location: AppointmentLocation | null; status: AppointmentStatus;
  motifEncrypted: string | null; noteEncrypted: string | null;
  proposedAlternativeAt: Date | null;
  cancelledBy: CancellationActor | null;
  cancelReasonEncrypted: string | null;
  cancelledAt: Date | null;
  createdAt: Date; updatedAt: Date;
}

function toAppointmentDTO(a: AppointmentRow): AppointmentDTO {
  return {
    id: a.id, patientId: a.patientId, memberId: a.memberId,
    type: a.type, date: a.date, hour: a.hour,
    durationMinutes: a.durationMinutes,
    location: a.location, status: a.status,
    motif: a.motifEncrypted ? safeDecryptField(a.motifEncrypted) : null,
    note: a.noteEncrypted ? safeDecryptField(a.noteEncrypted) : null,
    proposedAlternativeAt: a.proposedAlternativeAt,
    cancelledBy: a.cancelledBy,
    cancelReason: a.cancelReasonEncrypted ? safeDecryptField(a.cancelReasonEncrypted) : null,
    cancelledAt: a.cancelledAt,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  }
}

/** List DTO — strips encrypted/sensitive free-text fields. Avoids bulk decrypt. */
function toAppointmentListItemDTO(a: Omit<AppointmentRow, "noteEncrypted" | "cancelReasonEncrypted">): AppointmentListItemDTO {
  return {
    id: a.id, patientId: a.patientId, memberId: a.memberId,
    type: a.type, date: a.date, hour: a.hour,
    durationMinutes: a.durationMinutes,
    location: a.location, status: a.status,
    motif: a.motifEncrypted ? safeDecryptField(a.motifEncrypted) : null,
    proposedAlternativeAt: a.proposedAlternativeAt,
    cancelledBy: a.cancelledBy,
    cancelledAt: a.cancelledAt,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  }
}

export type AppointmentCreateInput = {
  patientId: number
  memberId: number
  date: Date           // YYYY-MM-DD
  hour: Date           // HH:MM:SS UTC
  durationMinutes?: number
  location?: AppointmentLocation
  type?: string
  motif?: string
  note?: string
}

/** M7 — named patch types so callers don't depend on positional `Parameters<>`
 *  indexing into private function signatures. */
export type AppointmentUpdatePatch = {
  date?: Date; hour?: Date; durationMinutes?: number;
  location?: AppointmentLocation; type?: string;
  motif?: string | null; note?: string | null;
}
export type MemberBookingConfigUpdateInput = {
  bookingMode?: BookingMode;
  defaultAppointmentMinutes?: number | null;
}

export const rdvAppointmentService = {
  async create(
    input: AppointmentCreateInput,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<AppointmentDTO> {
    if (input.motif && input.motif.length > MOTIF_MAX) throw new ValidationError("motif")
    if (input.note && input.note.length > NOTE_MAX) throw new ValidationError("note")
    if (
      input.durationMinutes !== undefined &&
      (input.durationMinutes < DURATION_MIN || input.durationMinutes > DURATION_MAX)
    ) {
      throw new ValidationError("durationMinutes")
    }

    return prisma.$transaction(async (tx) => {
      await assertPatientAlive(input.patientId, tx)

      const member = await tx.healthcareMember.findUnique({
        where: { id: input.memberId },
        select: { id: true, serviceId: true, bookingMode: true, defaultAppointmentMinutes: true },
      })
      if (!member) throw new NotFoundError()
      if (member.serviceId === null) throw new ValidationError("memberHasNoService")

      // Overlap check (US-2504 unavailability + active appointments).
      const startAt = combineDateHour(input.date, input.hour)
      const duration = input.durationMinutes ?? member.defaultAppointmentMinutes ?? 30
      const endAt = computeEnd(startAt, duration)
      await assertNoOverlap(tx, input.memberId, startAt, endAt)

      // US-2505 — booking mode drives initial status.
      const initialStatus: AppointmentStatus =
        member.bookingMode === "validation" ? "pending_validation" : "scheduled"

      const created = await tx.appointment.create({
        data: {
          patientId: input.patientId,
          memberId: input.memberId,
          type: input.type ?? null,
          date: input.date,
          hour: input.hour,
          durationMinutes: duration,
          location: input.location ?? null,
          status: initialStatus,
          motifEncrypted: input.motif ? encryptField(input.motif) : null,
          noteEncrypted: input.note ? encryptField(input.note) : null,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "APPOINTMENT",
        resourceId: String(created.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: input.patientId, memberId: input.memberId,
          status: initialStatus, location: input.location ?? null,
        },
      })
      return toAppointmentDTO(created)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async getById(
    id: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<AppointmentDTO | null> {
    const row = await prisma.appointment.findUnique({ where: { id } })
    if (!row) return null
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "APPOINTMENT",
      resourceId: String(id),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId: row.patientId },
    })
    return toAppointmentDTO(row)
  },

  /**
   * US-2500 — list appointments in a date range. Filterable by member or patient
   * scope (route enforces RBAC). Hard-cap on range (62 days) to avoid heavy queries.
   *
   * Returns lighter `AppointmentListItemDTO` (no decrypted note / cancelReason).
   * Soft-deleted patients are excluded (M1). Result is paginated/limited at 200
   * with `truncated` flag so the UI can warn the user (M2).
   */
  async listInRange(
    input: {
      from: Date; to: Date;
      memberId?: number; patientId?: number;
      status?: AppointmentStatus;
    },
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<{ items: AppointmentListItemDTO[]; truncated: boolean }> {
    if (input.to < input.from) throw new ValidationError("dateRange")
    const days = (input.to.getTime() - input.from.getTime()) / 86_400_000
    if (days > RANGE_MAX_DAYS) throw new ValidationError("rangeTooLarge")
    // C1 — refuse unscoped listings ; route enforces RBAC per scope.
    if (input.memberId === undefined && input.patientId === undefined) {
      throw new ValidationError("scopeRequired")
    }

    const LIST_LIMIT = 200
    // M2 — widen `from` by 1 day so cross-midnight appointments starting the
    //      day before the queried range are returned, then re-filter in JS to
    //      keep only those whose end-time falls inside [input.from, input.to].
    const widenedFrom = new Date(input.from)
    widenedFrom.setUTCDate(widenedFrom.getUTCDate() - 1)
    const where: Prisma.AppointmentWhereInput = {
      date: { gte: widenedFrom, lte: input.to },
      // M1 — exclude soft-deleted patients.
      patient: { deletedAt: null },
      ...(input.memberId !== undefined && { memberId: input.memberId }),
      ...(input.patientId !== undefined && { patientId: input.patientId }),
      ...(input.status && { status: input.status }),
    }
    const rowsRaw = await prisma.appointment.findMany({
      where,
      orderBy: [{ date: "asc" }, { hour: "asc" }],
      take: LIST_LIMIT + 1,
      select: {
        id: true, patientId: true, memberId: true,
        type: true, date: true, hour: true,
        durationMinutes: true,
        location: true, status: true,
        motifEncrypted: true,
        proposedAlternativeAt: true,
        cancelledBy: true,
        cancelledAt: true,
        createdAt: true, updatedAt: true,
      },
    })
    // Filter day-before rows whose end ≤ input.from (they don't spill into the
    // requested window).
    const rows = rowsRaw.filter((r) => {
      const start = combineDateHour(r.date, r.hour)
      const end = computeEnd(start, r.durationMinutes)
      return end > input.from && start <= input.to
    })
    const truncated = rows.length > LIST_LIMIT
    const items = (truncated ? rows.slice(0, LIST_LIMIT) : rows).map(toAppointmentListItemDTO)

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "APPOINTMENT",
      resourceId: "list",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: {
        from: input.from.toISOString(), to: input.to.toISOString(),
        memberId: input.memberId ?? null, patientId: input.patientId ?? null,
        count: items.length, truncated,
      },
    })
    return { items, truncated }
  },

  async update(
    id: number,
    patch: AppointmentUpdatePatch,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<AppointmentDTO> {
    if (patch.motif !== undefined && patch.motif !== null && patch.motif.length > MOTIF_MAX) {
      throw new ValidationError("motif")
    }
    if (patch.note !== undefined && patch.note !== null && patch.note.length > NOTE_MAX) {
      throw new ValidationError("note")
    }
    if (
      patch.durationMinutes !== undefined &&
      (patch.durationMinutes < DURATION_MIN || patch.durationMinutes > DURATION_MAX)
    ) {
      throw new ValidationError("durationMinutes")
    }

    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      // H5 — terminal states (cancelled, completed, no_show) are immutable.
      if (
        existing.status === "cancelled" ||
        existing.status === "completed" ||
        existing.status === "no_show"
      ) {
        throw new ValidationError("alreadyClosed")
      }

      // If date/hour/duration change AND member is set, re-check overlap.
      const newDate = patch.date ?? existing.date
      const newHour = patch.hour ?? existing.hour
      const newDuration = patch.durationMinutes ?? existing.durationMinutes
      const rescheduled =
        patch.date !== undefined ||
        patch.hour !== undefined ||
        patch.durationMinutes !== undefined
      if (existing.memberId !== null && rescheduled) {
        const startAt = combineDateHour(newDate, newHour)
        const endAt = computeEnd(startAt, newDuration)
        await assertNoOverlap(tx, existing.memberId, startAt, endAt, id)
      }

      // H6 — `null` is the explicit clear signal ; build update fields explicitly so
      //       Prisma writes `null` instead of treating it as "unchanged".
      const data: Prisma.AppointmentUpdateInput = {}
      if (patch.date) data.date = patch.date
      if (patch.hour) data.hour = patch.hour
      if (patch.durationMinutes !== undefined) data.durationMinutes = patch.durationMinutes
      if (patch.location !== undefined) data.location = patch.location
      if (patch.type !== undefined) data.type = patch.type
      if (patch.motif !== undefined) {
        data.motifEncrypted = patch.motif === null ? null : encryptField(patch.motif)
      }
      if (patch.note !== undefined) {
        data.noteEncrypted = patch.note === null ? null : encryptField(patch.note)
      }
      // M6 — reschedule clears any stale alternative proposal.
      if (rescheduled) data.proposedAlternativeAt = null

      const updated = await tx.appointment.update({ where: { id }, data })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "APPOINTMENT",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: existing.patientId,
          updatedFields: Object.keys(patch).filter((k) =>
            patch[k as keyof typeof patch] !== undefined,
          ),
        },
      })
      return toAppointmentDTO(updated)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  /**
   * US-2503 — Cancel an appointment. `actor` is derived by the route from the
   * caller's role (NEVER from request body — H4) and recorded in the immutable
   * audit log. A patient cancel within `CANCEL_GRACE_HOURS` of the start time
   * is flagged `lateCancel=true` for downstream UX (penalty / notification).
   * A doctor cancel typically proposes an alternative via `proposeAlternative`.
   */
  async cancel(
    id: number,
    input: { actor: CancellationActor; reason?: string; callerRole?: Role },
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<AppointmentDTO> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      if (existing.status === "cancelled") throw new ValidationError("alreadyCancelled")
      if (existing.status === "completed" || existing.status === "no_show") {
        throw new ValidationError("alreadyClosed")
      }

      const now = new Date()
      const startAt = combineDateHour(existing.date, existing.hour)
      const hoursUntil = (startAt.getTime() - now.getTime()) / 3_600_000
      // H2 — semantic fix: late = cancel within grace window before start.
      const lateCancel = hoursUntil >= 0 && hoursUntil < CANCEL_GRACE_HOURS

      const reasonClipped = input.reason?.slice(0, 500)
      const updated = await tx.appointment.update({
        where: { id },
        data: {
          status: "cancelled",
          cancelledBy: input.actor,
          cancelReasonEncrypted: reasonClipped ? encryptField(reasonClipped) : null,
          cancelledAt: now,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "APPOINTMENT",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: existing.patientId,
          kind: "cancel", actor: input.actor,
          callerRole: input.callerRole ?? null,
          lateCancel, hoursUntil: Math.round(hoursUntil),
        },
      })
      return toAppointmentDTO(updated)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  /** US-2503 — doctor proposes a new date/hour to a cancelled appointment.
   *  H10 — overlap-check the proposed slot so the patient doesn't accept a
   *  slot that has become unavailable since the cancel.
   *
   *  L7 — re-proposal is idempotent (overwrites any stale `proposedAlternativeAt`).
   *       The TTL (`PROPOSAL_TTL_MS`) is only checked on the accept-side so an
   *       expired proposal can be refreshed by the doctor without a state transition.
   */
  async proposeAlternative(
    id: number, alternativeAt: Date, auditUserId: number, ctx?: AuditContext,
  ): Promise<AppointmentDTO> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      if (existing.status !== "cancelled" || existing.cancelledBy !== "doctor") {
        throw new ValidationError("notDoctorCancelled")
      }
      if (alternativeAt <= new Date()) throw new ValidationError("alternativeInPast")

      if (existing.memberId !== null) {
        const endAt = computeEnd(alternativeAt, existing.durationMinutes)
        await assertNoOverlap(tx, existing.memberId, alternativeAt, endAt, id)
      }

      const updated = await tx.appointment.update({
        where: { id },
        data: { proposedAlternativeAt: alternativeAt },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "APPOINTMENT",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: existing.patientId,
          kind: "propose-alternative",
          alternativeAt: alternativeAt.toISOString(),
        },
      })
      return toAppointmentDTO(updated)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  /** US-2503 — patient accepts the alternative → revert cancellation.
   *  M14 — must still be `cancelled`. M10 — TTL applied (proposal expires after 7d).
   *  L6 — preserve seconds in the new hour. L9 — audit on conflict.
   *  H8 — `callerRole` is logged alongside the accept action so forensics
   *       can distinguish patient self-accept vs staff accept-on-behalf. */
  async acceptAlternative(
    id: number, auditUserId: number, ctx?: AuditContext, callerRole?: Role,
  ): Promise<AppointmentDTO> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      if (existing.status !== "cancelled") throw new ValidationError("notCancelled")
      if (!existing.proposedAlternativeAt) throw new ValidationError("noAlternative")
      if (Date.now() - existing.proposedAlternativeAt.getTime() > PROPOSAL_TTL_MS) {
        throw new ValidationError("alternativeExpired")
      }

      const alt = existing.proposedAlternativeAt
      const newDate = new Date(alt)
      newDate.setUTCHours(0, 0, 0, 0)
      const newHour = new Date(Date.UTC(
        1970, 0, 1, alt.getUTCHours(), alt.getUTCMinutes(), alt.getUTCSeconds(),
      ))

      if (existing.memberId !== null) {
        const startAt = combineDateHour(newDate, newHour)
        const endAt = computeEnd(startAt, existing.durationMinutes)
        try {
          await assertNoOverlap(tx, existing.memberId, startAt, endAt, id)
        } catch (err) {
          // L9 — audit the conflict so forensics can correlate which proposal raced.
          await auditService.logWithTx(tx, {
            userId: auditUserId, action: "UPDATE", resource: "APPOINTMENT",
            resourceId: String(id),
            ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
            metadata: {
              patientId: existing.patientId,
              kind: "accept-alternative-conflict",
              alternativeAt: alt.toISOString(),
            },
          })
          throw err
        }
      }

      const updated = await tx.appointment.update({
        where: { id },
        data: {
          status: "scheduled",
          date: newDate, hour: newHour,
          proposedAlternativeAt: null,
          cancelledBy: null, cancelReasonEncrypted: null, cancelledAt: null,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "APPOINTMENT",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: existing.patientId,
          kind: "accept-alternative",
          callerRole: callerRole ?? null,
          newAt: alt.toISOString(),
        },
      })
      return toAppointmentDTO(updated)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  /** US-2505 — member confirms a `pending_validation` appointment. */
  async confirm(
    id: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<AppointmentDTO> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      if (existing.status !== "pending_validation") {
        throw new ValidationError("notPending")
      }
      const updated = await tx.appointment.update({
        where: { id },
        data: { status: "confirmed", proposedAlternativeAt: null },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "APPOINTMENT",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: existing.patientId, kind: "confirm" },
      })
      return toAppointmentDTO(updated)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  /** Helper for routes — fetch the patient owning an appointment. */
  async getPatientIdFor(id: number): Promise<number | null> {
    const a = await prisma.appointment.findUnique({
      where: { id }, select: { patientId: true },
    })
    return a?.patientId ?? null
  },
}

// ─────────────────────────────────────────────────────────────
// US-2504 — Member unavailability
// ─────────────────────────────────────────────────────────────

const UNAVAIL_MAX_RANGE_DAYS = 365

export type UnavailabilityDTO = {
  id: number
  memberId: number
  startAt: Date
  endAt: Date
  reason: string | null
}

const UNAVAIL_REASON_MAX = 200

function decodeUnavailability(r: {
  id: number; memberId: number; startAt: Date; endAt: Date;
  reasonEncrypted: string | null;
}): UnavailabilityDTO {
  return {
    id: r.id, memberId: r.memberId, startAt: r.startAt, endAt: r.endAt,
    reason: r.reasonEncrypted ? safeDecryptField(r.reasonEncrypted) : null,
  }
}

export const memberUnavailabilityService = {
  async create(
    input: { memberId: number; startAt: Date; endAt: Date; reason?: string },
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<UnavailabilityDTO> {
    if (input.endAt <= input.startAt) throw new ValidationError("dateRange")
    if (input.endAt.getTime() - input.startAt.getTime() > UNAVAIL_MAX_RANGE_DAYS * 86_400_000) {
      throw new ValidationError("rangeTooLong")
    }
    return prisma.$transaction(async (tx) => {
      const member = await tx.healthcareMember.findUnique({
        where: { id: input.memberId }, select: { id: true, serviceId: true },
      })
      if (!member) throw new NotFoundError()
      if (member.serviceId === null) throw new ValidationError("memberHasNoService")
      await assertServiceMember(auditUserId, member.serviceId, tx)

      const reasonClipped = input.reason?.slice(0, UNAVAIL_REASON_MAX)
      try {
        const row = await tx.memberUnavailability.create({
          data: {
            memberId: input.memberId,
            startAt: input.startAt,
            endAt: input.endAt,
            reasonEncrypted: reasonClipped ? encryptField(reasonClipped) : null,
            createdBy: auditUserId,
          },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId, action: "CREATE", resource: "MEMBER_UNAVAILABILITY",
          resourceId: String(row.id),
          ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
          metadata: { memberId: input.memberId, serviceId: member.serviceId },
        })
        return decodeUnavailability(row)
      } catch (err) {
        // H3/C2 — Postgres EXCLUDE constraint violations raise sqlstate 23P01.
        // @prisma/adapter-pg does NOT remap 23P01 to a `PrismaClientKnownRequestError`,
        // so the error surfaces as `PrismaClientUnknownRequestError` with the raw
        // driver code embedded in `.message`. We must catch both flavours.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          throw new ValidationError("unavailabilityOverlap") // UNIQUE fallback
        }
        if (
          err instanceof Prisma.PrismaClientUnknownRequestError &&
          err.message.includes("23P01")
        ) {
          throw new ValidationError("unavailabilityOverlap")
        }
        throw err
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async listForMember(
    memberId: number,
    range: { from: Date; to: Date },
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<UnavailabilityDTO[]> {
    // H2 — uniform `ForbiddenError` (no 404 vs 403 oracle on member enumeration).
    await assertMemberServiceAccess(auditUserId, memberId)

    const rows = await prisma.memberUnavailability.findMany({
      where: { memberId, startAt: { lt: range.to }, endAt: { gt: range.from } },
      orderBy: { startAt: "asc" }, take: 200,
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "MEMBER_UNAVAILABILITY",
      resourceId: String(memberId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { memberId, count: rows.length },
    })
    return rows.map(decodeUnavailability)
  },

  async delete(id: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      // H2 — fold the membership check + existence check into one query so
      // a cross-tenant caller sees a uniform `ForbiddenError` regardless of
      // whether the unavailability exists.
      const u = await tx.memberUnavailability.findFirst({
        where: {
          id,
          member: {
            serviceId: { not: null },
            service: { members: { some: { userId: auditUserId } } },
          },
        },
        select: { id: true, memberId: true, member: { select: { serviceId: true } } },
      })
      if (!u) throw new ForbiddenError()
      await tx.memberUnavailability.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "MEMBER_UNAVAILABILITY",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { memberId: u.memberId, serviceId: u.member.serviceId },
      })
      return { deleted: true }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2505 — Member booking config (auto vs validation)
// ─────────────────────────────────────────────────────────────

export type MemberBookingConfigDTO = {
  memberId: number
  bookingMode: BookingMode
  defaultAppointmentMinutes: number | null
}

export const memberBookingConfigService = {
  async get(memberId: number): Promise<MemberBookingConfigDTO | null> {
    const m = await prisma.healthcareMember.findUnique({
      where: { id: memberId },
      select: { id: true, bookingMode: true, defaultAppointmentMinutes: true },
    })
    if (!m) return null
    return {
      memberId: m.id,
      bookingMode: m.bookingMode,
      defaultAppointmentMinutes: m.defaultAppointmentMinutes,
    }
  },

  async update(
    memberId: number,
    input: MemberBookingConfigUpdateInput,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<MemberBookingConfigDTO> {
    if (
      input.defaultAppointmentMinutes !== undefined &&
      input.defaultAppointmentMinutes !== null &&
      (input.defaultAppointmentMinutes < DURATION_MIN ||
        input.defaultAppointmentMinutes > DURATION_MAX)
    ) {
      throw new ValidationError("defaultAppointmentMinutes")
    }

    return prisma.$transaction(async (tx) => {
      const m = await tx.healthcareMember.findUnique({
        where: { id: memberId }, select: { id: true, serviceId: true },
      })
      if (!m) throw new NotFoundError()
      if (m.serviceId === null) throw new ValidationError("memberHasNoService")
      await assertServiceMember(auditUserId, m.serviceId, tx)

      // H1 — distinguish "not provided" (undefined → no-op) from
      // "explicit clear" (null → set to NULL). Coalescing to `undefined`
      // silently swallowed the null and prevented clears.
      const data: Prisma.HealthcareMemberUpdateInput = {}
      if (input.bookingMode !== undefined) data.bookingMode = input.bookingMode
      if (input.defaultAppointmentMinutes !== undefined) {
        data.defaultAppointmentMinutes = input.defaultAppointmentMinutes
      }
      const updated = await tx.healthcareMember.update({
        where: { id: memberId }, data,
        select: { id: true, bookingMode: true, defaultAppointmentMinutes: true },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "MEMBER_BOOKING_CONFIG",
        resourceId: String(memberId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          memberId, serviceId: m.serviceId,
          bookingMode: input.bookingMode ?? null,
        },
      })
      return {
        memberId: updated.id,
        bookingMode: updated.bookingMode,
        defaultAppointmentMinutes: updated.defaultAppointmentMinutes,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}
