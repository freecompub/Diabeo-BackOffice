/**
 * Test suite: rdv.service (Groupe 8 Batch 1 — 5 US, 36 SP)
 *
 * Covers:
 *  - US-2501 appointment CRUD (validation, encrypted note, status defaults)
 *  - US-2500 listInRange (range cap, audit count)
 *  - US-2503 cancel + propose-alternative + accept-alternative workflow
 *  - US-2504 memberUnavailability (overlap detection)
 *  - US-2505 memberBookingConfig + auto/validation mode side-effects
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  rdvAppointmentService,
  memberUnavailabilityService,
  memberBookingConfigService,
} from "@/lib/services/rdv.service"
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

const date = new Date("2026-06-10")
const hour = new Date("1970-01-01T09:00:00Z")

describe("rdvAppointmentService.create", () => {
  it("rejects invalid duration", async () => {
    await expect(
      rdvAppointmentService.create(
        { patientId: 7, memberId: 1, date, hour, durationMinutes: 5 }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects when patient is missing", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(
      rdvAppointmentService.create({ patientId: 7, memberId: 1, date, hour }, 9),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("rejects member with no service", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.healthcareMember.findUnique.mockResolvedValue({
      id: 1, serviceId: null, bookingMode: "auto", defaultAppointmentMinutes: null,
    } as any)
    await expect(
      rdvAppointmentService.create({ patientId: 7, memberId: 1, date, hour }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects slot overlap with existing appointment", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.healthcareMember.findUnique.mockResolvedValue({
      id: 1, serviceId: 10, bookingMode: "auto", defaultAppointmentMinutes: null,
    } as any)
    prismaMock.appointment.findMany.mockResolvedValue([
      { date, hour, durationMinutes: 30 } as any,
    ])
    await expect(
      rdvAppointmentService.create({ patientId: 7, memberId: 1, date, hour }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("C3 — rejects slot overlap that starts on day-before and spills past midnight", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.healthcareMember.findUnique.mockResolvedValue({
      id: 1, serviceId: 10, bookingMode: "auto", defaultAppointmentMinutes: null,
    } as any)
    // Existing appointment 2026-06-09 23:30 + 120 min → ends 2026-06-10 01:30 UTC.
    prismaMock.appointment.findMany.mockResolvedValue([
      {
        date: new Date("2026-06-09"),
        hour: new Date("1970-01-01T23:30:00Z"),
        durationMinutes: 120,
      } as any,
    ])
    prismaMock.memberUnavailability.findMany.mockResolvedValue([])
    // New slot 2026-06-10 00:30 → must conflict.
    await expect(
      rdvAppointmentService.create({
        patientId: 7, memberId: 1,
        date: new Date("2026-06-10"),
        hour: new Date("1970-01-01T00:30:00Z"),
        durationMinutes: 30,
      }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects slot overlap with an unavailability", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.healthcareMember.findUnique.mockResolvedValue({
      id: 1, serviceId: 10, bookingMode: "auto", defaultAppointmentMinutes: null,
    } as any)
    prismaMock.appointment.findMany.mockResolvedValue([])
    prismaMock.memberUnavailability.findMany.mockResolvedValue([{ id: 1 } as any])
    await expect(
      rdvAppointmentService.create({ patientId: 7, memberId: 1, date, hour }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("creates `scheduled` when bookingMode=auto", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.healthcareMember.findUnique.mockResolvedValue({
      id: 1, serviceId: 10, bookingMode: "auto", defaultAppointmentMinutes: 30,
    } as any)
    prismaMock.appointment.findMany.mockResolvedValue([])
    prismaMock.memberUnavailability.findMany.mockResolvedValue([])
    prismaMock.appointment.create.mockResolvedValue({
      id: 1, patientId: 7, memberId: 1, type: null, date, hour, durationMinutes: 30,
      location: null, status: "scheduled", motifEncrypted: null, noteEncrypted: null,
      proposedAlternativeAt: null, cancelledBy: null, cancelReasonEncrypted: null, cancelledAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await rdvAppointmentService.create(
      { patientId: 7, memberId: 1, date, hour }, 9,
    )
    expect(out.status).toBe("scheduled")
  })

  it("creates `pending_validation` when bookingMode=validation (US-2505)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.healthcareMember.findUnique.mockResolvedValue({
      id: 1, serviceId: 10, bookingMode: "validation", defaultAppointmentMinutes: 30,
    } as any)
    prismaMock.appointment.findMany.mockResolvedValue([])
    prismaMock.memberUnavailability.findMany.mockResolvedValue([])
    prismaMock.appointment.create.mockResolvedValue({
      id: 1, patientId: 7, memberId: 1, type: null, date, hour, durationMinutes: 30,
      location: null, status: "pending_validation", motifEncrypted: null, noteEncrypted: null,
      proposedAlternativeAt: null, cancelledBy: null, cancelReasonEncrypted: null, cancelledAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await rdvAppointmentService.create(
      { patientId: 7, memberId: 1, date, hour }, 9,
    )
    expect(out.status).toBe("pending_validation")
  })

  it("encrypts note before insertion", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.healthcareMember.findUnique.mockResolvedValue({
      id: 1, serviceId: 10, bookingMode: "auto", defaultAppointmentMinutes: 30,
    } as any)
    prismaMock.appointment.findMany.mockResolvedValue([])
    prismaMock.memberUnavailability.findMany.mockResolvedValue([])
    prismaMock.appointment.create.mockResolvedValue({
      id: 1, patientId: 7, memberId: 1, type: null, date, hour, durationMinutes: 30,
      location: null, status: "scheduled", motif: null, noteEncrypted: "cipher",
      proposedAlternativeAt: null, cancelledBy: null, cancelReason: null, cancelledAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await rdvAppointmentService.create(
      { patientId: 7, memberId: 1, date, hour, note: "Patient sensible aux pénicillines" }, 9,
    )
    const args = prismaMock.appointment.create.mock.calls[0][0] as any
    expect(args.data.noteEncrypted).not.toContain("pénicillines")
  })
})

describe("rdvAppointmentService.listInRange (US-2500)", () => {
  it("rejects range > 62 days", async () => {
    await expect(
      rdvAppointmentService.listInRange(
        { from: new Date("2026-01-01"), to: new Date("2026-04-01"), memberId: 1 }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects to < from", async () => {
    await expect(
      rdvAppointmentService.listInRange(
        { from: new Date("2026-02-01"), to: new Date("2026-01-01"), memberId: 1 }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects unscoped listing (C1 — cross-tenant PHI leak)", async () => {
    await expect(
      rdvAppointmentService.listInRange(
        { from: new Date("2026-06-01"), to: new Date("2026-06-15") }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("audits READ with count", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([] as any)
    const out = await rdvAppointmentService.listInRange(
      { from: new Date("2026-06-01"), to: new Date("2026-06-15"), memberId: 1 }, 9,
    )
    expect(out.items).toEqual([])
    expect(out.truncated).toBe(false)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.resource).toBe("APPOINTMENT")
    expect(audit.resourceId).toBe("list")
  })
  it("flags truncated=true when result exceeds limit", async () => {
    const row = {
      id: 1, patientId: 7, memberId: 1, type: null, date, hour,
      durationMinutes: 30, location: null, status: "scheduled",
      motifEncrypted: null, proposedAlternativeAt: null,
      cancelledBy: null, cancelledAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    }
    prismaMock.appointment.findMany.mockResolvedValue(
      Array.from({ length: 201 }, (_, i) => ({ ...row, id: i + 1 })) as any,
    )
    const out = await rdvAppointmentService.listInRange(
      { from: new Date("2026-06-01"), to: new Date("2026-06-15"), memberId: 1 }, 9,
    )
    expect(out.items.length).toBe(200)
    expect(out.truncated).toBe(true)
  })
})

describe("rdvAppointmentService.update (H5 / H6)", () => {
  it("H5 — rejects update on `completed`", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, patientId: 7, status: "completed", memberId: 1, date, hour, durationMinutes: 30,
    } as any)
    await expect(
      rdvAppointmentService.update(1, { type: "ide" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("H6 — explicit note=null clears the noteEncrypted column", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, patientId: 7, status: "scheduled", memberId: 1, date, hour, durationMinutes: 30,
    } as any)
    prismaMock.appointment.update.mockResolvedValue({
      id: 1, patientId: 7, memberId: 1, type: null, date, hour, durationMinutes: 30,
      location: null, status: "scheduled", motifEncrypted: null, noteEncrypted: null,
      proposedAlternativeAt: null, cancelledBy: null, cancelReasonEncrypted: null,
      cancelledAt: null, createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await rdvAppointmentService.update(1, { note: null }, 9)
    const args = prismaMock.appointment.update.mock.calls[0][0] as any
    expect(args.data.noteEncrypted).toBeNull()
  })
})

describe("rdvAppointmentService.cancel (US-2503)", () => {
  it("rejects already-cancelled", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, patientId: 7, status: "cancelled",
    } as any)
    await expect(
      rdvAppointmentService.cancel(1, { actor: "patient" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects completed", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, patientId: 7, status: "completed",
    } as any)
    await expect(
      rdvAppointmentService.cancel(1, { actor: "doctor" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("audits lateCancel=false when patient cancels > 24h before", async () => {
    const future = new Date(Date.now() + 48 * 3600_000)
    const futureDate = new Date(future)
    futureDate.setUTCHours(0, 0, 0, 0)
    const futureHour = new Date(future)
    futureHour.setUTCFullYear(1970, 0, 1)
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, patientId: 7, status: "scheduled",
      date: futureDate, hour: futureHour, durationMinutes: 30,
    } as any)
    prismaMock.appointment.update.mockResolvedValue({
      id: 1, patientId: 7, memberId: null, type: null, date: futureDate, hour: futureHour,
      durationMinutes: 30, location: null, status: "cancelled",
      motifEncrypted: null, noteEncrypted: null,
      proposedAlternativeAt: null, cancelledBy: "patient",
      cancelReasonEncrypted: null, cancelledAt: new Date(),
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await rdvAppointmentService.cancel(1, { actor: "patient" }, 9)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.lateCancel).toBe(false)
  })

  it("audits lateCancel=true when cancel happens within 24h", async () => {
    const soon = new Date(Date.now() + 2 * 3600_000) // 2h ahead
    const soonDate = new Date(soon)
    soonDate.setUTCHours(0, 0, 0, 0)
    const soonHour = new Date(soon)
    soonHour.setUTCFullYear(1970, 0, 1)
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, patientId: 7, status: "scheduled",
      date: soonDate, hour: soonHour, durationMinutes: 30,
    } as any)
    prismaMock.appointment.update.mockResolvedValue({
      id: 1, patientId: 7, memberId: null, type: null, date: soonDate, hour: soonHour,
      durationMinutes: 30, location: null, status: "cancelled",
      motifEncrypted: null, noteEncrypted: null,
      proposedAlternativeAt: null, cancelledBy: "patient",
      cancelReasonEncrypted: null, cancelledAt: new Date(),
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await rdvAppointmentService.cancel(1, { actor: "patient" }, 9)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.lateCancel).toBe(true)
  })
})

describe("rdvAppointmentService.proposeAlternative + accept (US-2503)", () => {
  it("rejects propose when not cancelled by doctor", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, status: "cancelled", cancelledBy: "patient",
    } as any)
    await expect(
      rdvAppointmentService.proposeAlternative(1, new Date(Date.now() + 86_400_000), 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects propose in the past", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, status: "cancelled", cancelledBy: "doctor",
    } as any)
    await expect(
      rdvAppointmentService.proposeAlternative(1, new Date("2020-01-01"), 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("H10 — propose checks overlap with existing appointments", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, patientId: 7, memberId: 1, status: "cancelled",
      cancelledBy: "doctor", durationMinutes: 30,
    } as any)
    prismaMock.appointment.findMany.mockResolvedValue([
      { date: new Date("2026-07-01"), hour: new Date("1970-01-01T10:00:00Z"), durationMinutes: 30 } as any,
    ])
    prismaMock.memberUnavailability.findMany.mockResolvedValue([])
    await expect(
      rdvAppointmentService.proposeAlternative(
        1, new Date("2026-07-01T10:15:00Z"), 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("M14 — accept rejects when status != cancelled", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, status: "scheduled", proposedAlternativeAt: new Date(Date.now() + 3600_000),
    } as any)
    await expect(rdvAppointmentService.acceptAlternative(1, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("M10 — accept rejects expired proposals (TTL 7d)", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, status: "cancelled",
      proposedAlternativeAt: new Date(Date.now() - 8 * 86_400_000), // 8d old
    } as any)
    await expect(rdvAppointmentService.acceptAlternative(1, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("accept-alternative resets the appointment to scheduled", async () => {
    const alt = new Date(Date.now() + 86_400_000)
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, patientId: 7, memberId: 1, status: "cancelled",
      proposedAlternativeAt: alt, durationMinutes: 30,
    } as any)
    prismaMock.appointment.findMany.mockResolvedValue([])
    prismaMock.memberUnavailability.findMany.mockResolvedValue([])
    prismaMock.appointment.update.mockResolvedValue({
      id: 1, patientId: 7, memberId: 1, type: null, date: alt, hour: alt,
      durationMinutes: 30, location: null, status: "scheduled",
      motifEncrypted: null, noteEncrypted: null,
      proposedAlternativeAt: null, cancelledBy: null, cancelReasonEncrypted: null, cancelledAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await rdvAppointmentService.acceptAlternative(1, 9)
    expect(out.status).toBe("scheduled")
  })
})

describe("rdvAppointmentService.confirm (US-2505)", () => {
  it("rejects when status != pending_validation", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, patientId: 7, status: "scheduled",
    } as any)
    await expect(rdvAppointmentService.confirm(1, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("confirms pending → confirmed + audit", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({
      id: 1, patientId: 7, status: "pending_validation",
    } as any)
    prismaMock.appointment.update.mockResolvedValue({
      id: 1, patientId: 7, memberId: 1, type: null, date, hour,
      durationMinutes: 30, location: null, status: "confirmed",
      motifEncrypted: null, noteEncrypted: null,
      proposedAlternativeAt: null, cancelledBy: null, cancelReasonEncrypted: null, cancelledAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await rdvAppointmentService.confirm(1, 9)
    expect(out.status).toBe("confirmed")
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.kind).toBe("confirm")
  })
})

describe("memberUnavailabilityService (US-2504)", () => {
  it("rejects endAt <= startAt", async () => {
    const start = new Date("2026-06-10T09:00:00Z")
    const end = new Date("2026-06-10T08:00:00Z")
    await expect(
      memberUnavailabilityService.create({ memberId: 1, startAt: start, endAt: end }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects range > 365 days", async () => {
    const start = new Date("2026-06-10T09:00:00Z")
    const end = new Date("2028-06-10T09:00:00Z")
    await expect(
      memberUnavailabilityService.create({ memberId: 1, startAt: start, endAt: end }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects when caller is not a member of the service", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue({ id: 1, serviceId: 10 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(
      memberUnavailabilityService.create(
        { memberId: 1,
          startAt: new Date("2026-06-10T09:00:00Z"),
          endAt: new Date("2026-06-10T10:00:00Z") },
        9,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
  it("happy path creates + audits", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue({ id: 1, serviceId: 10 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 99 } as any)
    prismaMock.memberUnavailability.create.mockResolvedValue({
      id: 1, memberId: 1,
      startAt: new Date("2026-06-10T09:00:00Z"),
      endAt: new Date("2026-06-10T10:00:00Z"),
      reasonEncrypted: null,
    } as any)
    const out = await memberUnavailabilityService.create({
      memberId: 1,
      startAt: new Date("2026-06-10T09:00:00Z"),
      endAt: new Date("2026-06-10T10:00:00Z"),
    }, 9)
    expect(out.id).toBe(1)
    expect(out.reason).toBeNull()
  })
  it("encrypts reason before storing (H8)", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue({ id: 1, serviceId: 10 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 99 } as any)
    prismaMock.memberUnavailability.create.mockResolvedValue({
      id: 1, memberId: 1,
      startAt: new Date("2026-06-10T09:00:00Z"),
      endAt: new Date("2026-06-10T10:00:00Z"),
      reasonEncrypted: "ciphertext",
    } as any)
    await memberUnavailabilityService.create({
      memberId: 1,
      startAt: new Date("2026-06-10T09:00:00Z"),
      endAt: new Date("2026-06-10T10:00:00Z"),
      reason: "Congé maladie",
    }, 9)
    const args = prismaMock.memberUnavailability.create.mock.calls[0][0] as any
    expect(args.data.reasonEncrypted).not.toContain("maladie")
    expect(args.data.reasonEncrypted).toBeTruthy()
  })
})

describe("memberBookingConfigService (US-2505)", () => {
  it("rejects defaultAppointmentMinutes out of range", async () => {
    await expect(
      memberBookingConfigService.update(1, { defaultAppointmentMinutes: 5 }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects when caller is not member of the service", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue({ id: 1, serviceId: 10 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(
      memberBookingConfigService.update(1, { bookingMode: "validation" }, 9),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
  it("updates + audits", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue({ id: 1, serviceId: 10 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 99 } as any)
    prismaMock.healthcareMember.update.mockResolvedValue({
      id: 1, bookingMode: "validation", defaultAppointmentMinutes: 45,
    } as any)
    const out = await memberBookingConfigService.update(
      1, { bookingMode: "validation", defaultAppointmentMinutes: 45 }, 9,
    )
    expect(out.bookingMode).toBe("validation")
    expect(out.defaultAppointmentMinutes).toBe(45)
  })
  it("get returns null when member missing", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue(null)
    const cfg = await memberBookingConfigService.get(999)
    expect(cfg).toBeNull()
  })
})
