/**
 * @description US-2502 — appointment-reminder.service unit tests.
 *
 * Couvre :
 *   - 3 channels (email J-2 / SMS J-1 / push J-0).
 *   - Idempotence UNIQUE(appointment, channel, step).
 *   - Advisory lock anti double-run.
 *   - Filtre RGPD Art. 17 (patient.deletedAt + user.status).
 *   - Filtre status IN [scheduled, confirmed].
 *   - sentToEnc chiffré + patientId pivot US-2268.
 *   - SMS skipped si cabinet disabled / no credits / no phone.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { Prisma } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/services/email.service", () => ({
  emailService: {
    sendAppointmentReminder: vi.fn().mockResolvedValue({ sent: true, id: "resend-1" }),
  },
}))

vi.mock("@/lib/services/fcm.service", () => ({
  fcmService: {
    sendToUser: vi.fn().mockResolvedValue({
      sent: 1, failed: 0,
      results: [{ registrationId: "reg-1", platform: "ios", status: "sent" }],
    }),
  },
}))

vi.mock("@/lib/services/sms.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/sms.service")>()
  return {
    ...actual,
    smsService: {
      sendSms: vi.fn().mockResolvedValue({
        sent: true, status: "mock", providerMessageId: "mock-xxx",
      }),
    },
  }
})

import { appointmentReminderService } from "@/lib/services/appointment-reminder.service"
import { emailService } from "@/lib/services/email.service"
import { fcmService } from "@/lib/services/fcm.service"
import { smsService, SmsDisabledError, SmsInsufficientCreditError } from "@/lib/services/sms.service"

const ctx = {
  ipAddress: "1.2.3.4",
  userAgent: "cron",
  requestId: "cron-1",
}

function makeAppointment(overrides: any = {}) {
  return {
    id: overrides.id ?? 1,
    patientId: overrides.patientId ?? 42,
    date: overrides.date ?? new Date("2026-05-21"),
    hour: overrides.hour ?? new Date("1970-01-01T14:00:00Z"),
    location: overrides.location ?? "in_person",
    member: overrides.member ?? { serviceId: 7 },
    patient: {
      user: {
        id: overrides.userId ?? 100,
        email: overrides.emailEnc ?? "encrypted-email",
        phone: overrides.phoneEnc ?? null,
        language: overrides.language ?? "fr",
      },
    },
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.appointmentReminder.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
  prismaMock.$queryRaw.mockResolvedValue([{ locked: true }] as any)
  prismaMock.appointment.findUnique.mockResolvedValue({ status: "scheduled" } as any)
})

describe("appointmentReminderService.processAppointmentReminders", () => {
  it("metrics empty si aucun appointment", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    const m = await appointmentReminderService.processAppointmentReminders(
      new Date(), ctx,
    )
    expect(m.processed).toBe(0)
    expect(m.skippedConcurrent).toBe(false)
  })

  it("skippedConcurrent=true si advisory lock non-acquis", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ locked: false }] as any)
    const m = await appointmentReminderService.processAppointmentReminders(
      new Date(), ctx,
    )
    expect(m.skippedConcurrent).toBe(true)
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled()
  })

  it("3 queries findMany (1 par step email/sms/push)", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(prismaMock.appointment.findMany).toHaveBeenCalledTimes(3)
  })

  it("filtre RGPD Art. 17 patient.deletedAt + user.status='active'", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    const where = prismaMock.appointment.findMany.mock.calls[0]![0]!.where as any
    expect(where.patient.deletedAt).toBe(null)
    expect(where.patient.user.status).toBe("active")
    expect(where.status).toEqual({ in: ["scheduled", "confirmed"] })
  })

  it("filtre date sur target J-N", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    const now = new Date("2026-05-19T10:00:00Z")
    await appointmentReminderService.processAppointmentReminders(now, ctx)
    // step_j_minus_2 : target = now + 2j = 2026-05-21
    const where = prismaMock.appointment.findMany.mock.calls[0]![0]!.where as any
    expect(where.date.gte.toISOString()).toContain("2026-05-21")
  })

  it("audit cron.run avec metrics + durationMs", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    const runAudit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === "appointment.reminder.cron.run"
    })
    expect(runAudit).toBeDefined()
    const data = runAudit![0].data as any
    expect(data.userId).toBe(null) // sentinel cron
    expect(typeof data.metadata.durationMs).toBe("number")
  })

  // ─── Email J-2 ────────────────────────────────────────────────
  it("email J-2 : envoie via emailService.sendAppointmentReminder", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ emailEnc: encryptField("patient@x.com") })
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([appt]) // email step
      .mockResolvedValueOnce([])      // sms step
      .mockResolvedValueOnce([])      // push step
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(emailService.sendAppointmentReminder).toHaveBeenCalledWith(
      expect.objectContaining({ email: "patient@x.com" }),
    )
    expect(m.sent).toBe(1)
    expect(m.byChannel.email.sent).toBe(1)
  })

  it("email decrypt fail → skipped", async () => {
    const appt = makeAppointment({ emailEnc: "bad-cipher" })
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([appt])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.skipped).toBe(1)
    expect(emailService.sendAppointmentReminder).not.toHaveBeenCalled()
  })

  // ─── SMS J-1 ──────────────────────────────────────────────────
  it("sms J-1 : skipped si phone null", async () => {
    const appt = makeAppointment()
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([appt]) // sms step
      .mockResolvedValueOnce([])
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.skipped).toBe(1)
    expect(smsService.sendSms).not.toHaveBeenCalled()
  })

  it("sms J-1 : skipped si cabinet smsEnabled=false (SmsDisabledError)", async () => {
    vi.mocked(smsService.sendSms).mockRejectedValueOnce(new SmsDisabledError(7))
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ phoneEnc: encryptField("+33612345678") })
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([appt])
      .mockResolvedValueOnce([])
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.skipped).toBe(1)
    expect(m.failed).toBe(0)
  })

  it("sms J-1 : skipped si SmsInsufficientCreditError", async () => {
    vi.mocked(smsService.sendSms).mockRejectedValueOnce(
      new SmsInsufficientCreditError(7, 0, 1),
    )
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ phoneEnc: encryptField("+33612345678") })
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([appt])
      .mockResolvedValueOnce([])
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.skipped).toBe(1)
  })

  it("sms J-1 : envoie OK avec phone + credits + smsEnabled", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ phoneEnc: encryptField("+33612345678") })
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([appt])
      .mockResolvedValueOnce([])
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.sent).toBe(1)
    expect(smsService.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        cabinetId: 7,
        to: "+33612345678",
        contextKind: "appointment_reminder",
      }),
      null, ctx,
      expect.objectContaining({ patientId: 42, appointmentId: 1 }),
    )
  })

  // ─── Push J-0 ──────────────────────────────────────────────────
  it("push J-0 : envoie via FCM data-only", async () => {
    const appt = makeAppointment()
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([appt])
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.sent).toBe(1)
    expect(fcmService.sendToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 100,
        data: expect.objectContaining({
          kind: "appointment_reminder",
          appointmentId: "1",
        }),
      }),
      ctx,
    )
  })

  it("push J-0 : skipped si aucun device enregistré", async () => {
    vi.mocked(fcmService.sendToUser).mockResolvedValueOnce({
      sent: 0, failed: 0, results: [],
    })
    const appt = makeAppointment()
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([appt])
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.skipped).toBe(1)
  })

  // ─── Idempotence + audit ──────────────────────────────────────
  it("idempotent : P2002 UNIQUE(appointment, channel, step) → silent skip", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ emailEnc: encryptField("a@b.com") })
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([appt])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002", clientVersion: "test",
      meta: { target: ["appointment_id", "channel", "step"] },
    })
    prismaMock.appointmentReminder.create.mockRejectedValueOnce(p2002)
    await expect(
      appointmentReminderService.processAppointmentReminders(new Date(), ctx),
    ).resolves.toBeDefined()
  })

  it("recheck status : skip persist si appointment passe a 'cancelled'", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ emailEnc: encryptField("a@b.com") })
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([appt])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    prismaMock.appointment.findUnique.mockResolvedValue({ status: "cancelled" } as any)
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    // Email parti, mais row pas persisté.
    expect(prismaMock.appointmentReminder.create).not.toHaveBeenCalled()
  })

  it("audit metadata.patientId pivot US-2268 + channel + step", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ emailEnc: encryptField("a@b.com") })
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([appt])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    const sentAudit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === "appointment.reminder.sent"
    })
    expect(sentAudit).toBeDefined()
    const meta = (sentAudit![0].data as any).metadata
    expect(meta.patientId).toBe(42)
    expect(meta.channel).toBe("email")
    expect(meta.step).toBe("j_minus_2")
  })

  it("sentToEnc chiffré (pas plaintext)", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ emailEnc: encryptField("plaintext@example.com") })
    prismaMock.appointment.findMany
      .mockResolvedValueOnce([appt])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    const reminder = prismaMock.appointmentReminder.create.mock.calls[0]![0]!.data as any
    expect(reminder.sentToEnc).toBeTruthy()
    expect(reminder.sentToEnc).not.toContain("plaintext@example.com")
  })
})
