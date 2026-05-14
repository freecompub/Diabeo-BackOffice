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

async function assertPatientAlive(patientId: number, tx: Tx = prisma): Promise<void> {
  const p = await tx.patient.findFirst({
    where: { id: patientId, deletedAt: null }, select: { id: true },
  })
  if (!p) throw new NotFoundError()
}

/** Combine date + hour columns into a single UTC instant. `hour` is a `Time`
 *  (no zone) ; we treat it as already-UTC. */
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
 */
async function assertNoOverlap(
  tx: Tx,
  memberId: number,
  startAt: Date,
  endAt: Date,
  excludeAppointmentId?: number,
): Promise<void> {
  const activeStatuses: AppointmentStatus[] = ["scheduled", "pending_validation", "confirmed"]
  // Appointments: rough filter on `date` THEN check overlap in JS using hour.
  // Limit scan to the day(s) the slot touches.
  const dayFloor = new Date(startAt)
  dayFloor.setUTCHours(0, 0, 0, 0)
  const dayCeil = new Date(endAt)
  dayCeil.setUTCHours(23, 59, 59, 999)

  const sameDay = await tx.appointment.findMany({
    where: {
      memberId,
      status: { in: activeStatuses },
      date: { gte: dayFloor, lte: dayCeil },
      ...(excludeAppointmentId ? { NOT: { id: excludeAppointmentId } } : {}),
    },
    select: { date: true, hour: true, durationMinutes: true },
  })
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
  motif: string | null
  note: string | null   // decrypted
  proposedAlternativeAt: Date | null
  cancelledBy: string | null
  cancelReason: string | null
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function toAppointmentDTO(a: {
  id: number; patientId: number; memberId: number | null;
  type: string | null; date: Date; hour: Date | null;
  durationMinutes: number | null;
  location: AppointmentLocation | null; status: AppointmentStatus;
  motif: string | null; noteEncrypted: string | null;
  proposedAlternativeAt: Date | null;
  cancelledBy: string | null; cancelReason: string | null; cancelledAt: Date | null;
  createdAt: Date; updatedAt: Date;
}): AppointmentDTO {
  return {
    id: a.id, patientId: a.patientId, memberId: a.memberId,
    type: a.type, date: a.date, hour: a.hour,
    durationMinutes: a.durationMinutes,
    location: a.location, status: a.status,
    motif: a.motif,
    note: a.noteEncrypted ? safeDecryptField(a.noteEncrypted) : null,
    proposedAlternativeAt: a.proposedAlternativeAt,
    cancelledBy: a.cancelledBy, cancelReason: a.cancelReason, cancelledAt: a.cancelledAt,
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
          motif: input.motif ?? null,
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
   */
  async listInRange(
    input: {
      from: Date; to: Date;
      memberId?: number; patientId?: number;
      status?: AppointmentStatus;
    },
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<AppointmentDTO[]> {
    if (input.to < input.from) throw new ValidationError("dateRange")
    const days = (input.to.getTime() - input.from.getTime()) / 86_400_000
    if (days > RANGE_MAX_DAYS) throw new ValidationError("rangeTooLarge")

    const where: Prisma.AppointmentWhereInput = {
      date: { gte: input.from, lte: input.to },
      ...(input.memberId !== undefined && { memberId: input.memberId }),
      ...(input.patientId !== undefined && { patientId: input.patientId }),
      ...(input.status && { status: input.status }),
    }
    const rows = await prisma.appointment.findMany({
      where, orderBy: [{ date: "asc" }, { hour: "asc" }], take: 500,
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "APPOINTMENT",
      resourceId: "list",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: {
        from: input.from.toISOString(), to: input.to.toISOString(),
        memberId: input.memberId ?? null, patientId: input.patientId ?? null,
        count: rows.length,
      },
    })
    return rows.map(toAppointmentDTO)
  },

  async update(
    id: number,
    patch: {
      date?: Date; hour?: Date; durationMinutes?: number;
      location?: AppointmentLocation; type?: string;
      motif?: string; note?: string | null;
    },
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<AppointmentDTO> {
    if (patch.motif !== undefined && patch.motif.length > MOTIF_MAX) {
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
      if (existing.status === "cancelled" || existing.status === "no_show") {
        throw new ValidationError("alreadyClosed")
      }

      // If date/hour/duration change AND member is set, re-check overlap.
      const newDate = patch.date ?? existing.date
      const newHour = patch.hour ?? existing.hour
      const newDuration = patch.durationMinutes ?? existing.durationMinutes
      if (existing.memberId !== null && (patch.date || patch.hour || patch.durationMinutes)) {
        const startAt = combineDateHour(newDate, newHour)
        const endAt = computeEnd(startAt, newDuration)
        await assertNoOverlap(tx, existing.memberId, startAt, endAt, id)
      }

      const noteUpdate: { noteEncrypted?: string | null } =
        patch.note === undefined
          ? {}
          : patch.note === null
            ? { noteEncrypted: null }
            : { noteEncrypted: encryptField(patch.note) }

      const updated = await tx.appointment.update({
        where: { id },
        data: {
          date: patch.date,
          hour: patch.hour,
          durationMinutes: patch.durationMinutes,
          location: patch.location,
          type: patch.type,
          motif: patch.motif,
          ...noteUpdate,
        },
      })
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
   * US-2503 — Cancel an appointment. `cancelledBy` distinguishes
   * patient/doctor for the audit pivot and triggers different UX flows:
   * a patient cancel within `CANCEL_GRACE_HOURS` is recorded without
   * penalty. A doctor cancel typically proposes an alternative via
   * `proposeAlternative`.
   */
  async cancel(
    id: number,
    input: { by: "patient" | "doctor"; reason?: string },
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
      const withinGrace = hoursUntil >= CANCEL_GRACE_HOURS

      const updated = await tx.appointment.update({
        where: { id },
        data: {
          status: "cancelled",
          cancelledBy: input.by,
          cancelReason: input.reason?.slice(0, 500) ?? null,
          cancelledAt: now,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "APPOINTMENT",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: existing.patientId,
          kind: "cancel", by: input.by,
          withinGrace, hoursUntil: Math.round(hoursUntil),
        },
      })
      return toAppointmentDTO(updated)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  /** US-2503 — doctor proposes a new date/hour to a cancelled appointment. */
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

  /** US-2503 — patient accepts the alternative → revert cancellation. */
  async acceptAlternative(
    id: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<AppointmentDTO> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      if (!existing.proposedAlternativeAt) throw new ValidationError("noAlternative")

      const alt = existing.proposedAlternativeAt
      const newDate = new Date(alt)
      newDate.setUTCHours(0, 0, 0, 0)
      const newHour = new Date(Date.UTC(1970, 0, 1, alt.getUTCHours(), alt.getUTCMinutes()))

      if (existing.memberId !== null) {
        const startAt = combineDateHour(newDate, newHour)
        const endAt = computeEnd(startAt, existing.durationMinutes)
        await assertNoOverlap(tx, existing.memberId, startAt, endAt, id)
      }

      const updated = await tx.appointment.update({
        where: { id },
        data: {
          status: "scheduled",
          date: newDate, hour: newHour,
          proposedAlternativeAt: null,
          cancelledBy: null, cancelReason: null, cancelledAt: null,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "APPOINTMENT",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: existing.patientId,
          kind: "accept-alternative",
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
        where: { id }, data: { status: "confirmed" },
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

      const row = await tx.memberUnavailability.create({
        data: {
          memberId: input.memberId,
          startAt: input.startAt,
          endAt: input.endAt,
          reason: input.reason?.slice(0, 200),
          createdBy: auditUserId,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "MEMBER_UNAVAILABILITY",
        resourceId: String(row.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { memberId: input.memberId, serviceId: member.serviceId },
      })
      return { id: row.id, memberId: row.memberId, startAt: row.startAt, endAt: row.endAt, reason: row.reason }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async listForMember(
    memberId: number,
    range: { from: Date; to: Date },
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<UnavailabilityDTO[]> {
    const member = await prisma.healthcareMember.findUnique({
      where: { id: memberId }, select: { id: true, serviceId: true },
    })
    if (!member) throw new NotFoundError()
    if (member.serviceId === null) throw new ValidationError("memberHasNoService")
    await assertServiceMember(auditUserId, member.serviceId)

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
    return rows.map((r) => ({
      id: r.id, memberId: r.memberId, startAt: r.startAt, endAt: r.endAt, reason: r.reason,
    }))
  },

  async delete(id: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const u = await tx.memberUnavailability.findUnique({
        where: { id },
        select: { id: true, memberId: true, member: { select: { serviceId: true } } },
      })
      if (!u) throw new NotFoundError()
      if (u.member.serviceId === null) throw new ValidationError("memberHasNoService")
      await assertServiceMember(auditUserId, u.member.serviceId, tx)
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
    input: { bookingMode?: BookingMode; defaultAppointmentMinutes?: number | null },
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

      const updated = await tx.healthcareMember.update({
        where: { id: memberId },
        data: {
          bookingMode: input.bookingMode,
          defaultAppointmentMinutes: input.defaultAppointmentMinutes ?? undefined,
        },
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
