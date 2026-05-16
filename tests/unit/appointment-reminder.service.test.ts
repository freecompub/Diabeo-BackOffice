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
    // `hour` peut être explicit `null` (M13) → utiliser `in` plutôt que `??`.
    hour: "hour" in overrides ? overrides.hour : new Date("1970-01-01T14:00:00Z"),
    location: overrides.location ?? "in_person",
    member: overrides.member ?? { serviceId: 7 },
    patient: {
      user: {
        id: overrides.userId ?? 100,
        email: overrides.emailEnc ?? "encrypted-email",
        phone: overrides.phoneEnc ?? null,
        language: overrides.language ?? "fr",
        // C1 round 2 — timezone per-patient.
        timezone: overrides.timezone ?? null,
      },
    },
  } as any
}

// M10 round 2 — Ordre steps inversé : push J-0 → SMS J-1 → email J-2.
// Helpers pour pos appointment dans le mock de findMany selon le channel.
function mockFindManyForChannel(channel: "push" | "sms" | "email", appt: any) {
  // Order : push (0), sms (1), email (2).
  const order = { push: 0, sms: 1, email: 2 }[channel]
  const calls: any[][] = [[], [], []]
  calls[order] = [appt]
  for (const c of calls) prismaMock.appointment.findMany.mockResolvedValueOnce(c)
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

  it("filtre date sur target J-N (M10 round 2 ordre push J-0 first)", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    const now = new Date("2026-05-19T10:00:00Z")
    await appointmentReminderService.processAppointmentReminders(now, ctx)
    // M10 — 1er step est push j_0 (daysBeforeDate=0) → target = now (2026-05-19).
    const where = prismaMock.appointment.findMany.mock.calls[0]![0]!.where as any
    expect(where.date.gte.toISOString()).toContain("2026-05-19")
    // 3e step = email j_minus_2 → target = now+2j = 2026-05-21.
    const whereEmail = prismaMock.appointment.findMany.mock.calls[2]![0]!.where as any
    expect(whereEmail.date.gte.toISOString()).toContain("2026-05-21")
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
    // M10 ordre push → sms → email : email est en 3ème position.
    mockFindManyForChannel("email", appt)
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(emailService.sendAppointmentReminder).toHaveBeenCalledWith(
      expect.objectContaining({ email: "patient@x.com" }),
    )
    expect(m.sent).toBe(1)
    expect(m.byChannel.email.sent).toBe(1)
  })

  it("email decrypt fail → skipped", async () => {
    const appt = makeAppointment({ emailEnc: "bad-cipher" })
    mockFindManyForChannel("email", appt)
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.skipped).toBe(1)
    expect(emailService.sendAppointmentReminder).not.toHaveBeenCalled()
  })

  // ─── SMS J-1 ──────────────────────────────────────────────────
  it("sms J-1 : skipped si phone null", async () => {
    const appt = makeAppointment()
    mockFindManyForChannel("sms", appt)
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.skipped).toBe(1)
    expect(smsService.sendSms).not.toHaveBeenCalled()
  })

  it("sms J-1 : skipped si cabinet smsEnabled=false (SmsDisabledError)", async () => {
    vi.mocked(smsService.sendSms).mockRejectedValueOnce(new SmsDisabledError(7))
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ phoneEnc: encryptField("+33612345678") })
    mockFindManyForChannel("sms", appt)
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
    mockFindManyForChannel("sms", appt)
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.skipped).toBe(1)
  })

  it("sms J-1 : envoie OK avec phone + credits + smsEnabled", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ phoneEnc: encryptField("+33612345678") })
    mockFindManyForChannel("sms", appt)
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
    mockFindManyForChannel("push", appt)
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.sent).toBe(1)
    expect(fcmService.sendToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 100,
        // C2 round 2 — senderId: null sentinel système (vs 0 qui violait FK).
        senderId: null,
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
    mockFindManyForChannel("push", appt)
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.skipped).toBe(1)
  })

  // ─── Idempotence + audit ──────────────────────────────────────
  it("idempotent : P2002 UNIQUE(appointment, channel, step) → silent skip", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ emailEnc: encryptField("a@b.com") })
    mockFindManyForChannel("email", appt)
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
    mockFindManyForChannel("email", appt)
    prismaMock.appointment.findUnique.mockResolvedValue({ status: "cancelled" } as any)
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    // Email parti, mais row pas persisté.
    expect(prismaMock.appointmentReminder.create).not.toHaveBeenCalled()
  })

  it("audit metadata.patientId pivot US-2268 + channel + step", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ emailEnc: encryptField("a@b.com") })
    mockFindManyForChannel("email", appt)
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
    // M11 round 2 — runId pivot pour grouper events d'un run cron.
    expect(meta.runId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("sentToEnc chiffré (pas plaintext) channel=email", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ emailEnc: encryptField("plaintext@example.com") })
    mockFindManyForChannel("email", appt)
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    const reminder = prismaMock.appointmentReminder.create.mock.calls[0]![0]!.data as any
    expect(reminder.sentToEnc).toBeTruthy()
    expect(reminder.sentToEnc).not.toContain("plaintext@example.com")
  })

  // C3 round 2 — advisory lock SESSION-level (vs xact-level qui imposait
  // outer $transaction 50s → timeout Prisma 5s default).
  it("C3 round 2 — advisory lock session : acquire + release via pg_advisory_*lock", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    // Au moins 2 appels $queryRaw : acquire (try_lock) + release (unlock).
    expect(prismaMock.$queryRaw.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  // M11 round 2 — runId UUID au lieu de sentinel "cron".
  it("M11 round 2 — runId UUID propagé dans audit cron.run", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.runId).toMatch(/^[0-9a-f-]{36}$/)
    const runAudit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === "appointment.reminder.cron.run"
    })
    expect(runAudit).toBeDefined()
    const data = runAudit![0].data as any
    expect(data.resourceId).toBe(m.runId)
    expect(data.metadata.runId).toBe(m.runId)
  })

  // M1 round 2 — push partial errors metadata.
  it("M1 round 2 — push partial : metadata.recipientCount/sent/failed", async () => {
    vi.mocked(fcmService.sendToUser).mockResolvedValueOnce({
      sent: 1, failed: 2,
      results: [
        { registrationId: "reg-1", platform: "ios", status: "sent" },
        { registrationId: "reg-2", platform: "android", status: "failed", error: "INVALID_TOKEN" },
        { registrationId: "reg-3", platform: "web", status: "failed", error: "QUOTA" },
      ],
    })
    const appt = makeAppointment()
    mockFindManyForChannel("push", appt)
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    const sentAudit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === "appointment.reminder.sent" && d.metadata?.channel === "push"
    })
    expect(sentAudit).toBeDefined()
    const meta = (sentAudit![0].data as any).metadata
    expect(meta.recipientCount).toBe(3)
    expect(meta.sent).toBe(1)
    expect(meta.failed).toBe(2)
  })

  // H1 round 2 — filtre notifPreferences.medicalAppointments=true (Art. 21).
  it("H1 round 2 — filtre user.notifPreferences.medicalAppointments=true", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    const where = prismaMock.appointment.findMany.mock.calls[0]![0]!.where as any
    expect(where.patient.user.notifPreferences.medicalAppointments).toBe(true)
  })

  // M5 round 2 — orderBy date asc (priorise oldest in target day).
  it("M5 round 2 — orderBy date asc (priorise oldest dans la journée cible)", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    const call = prismaMock.appointment.findMany.mock.calls[0]![0]!
    expect((call as any).orderBy).toEqual({ date: "asc" })
  })

  // M13 round 2 — push body si hour=null
  it("M13 round 2 — hour=null → body sans heure (vs ancien 'à 2026')", async () => {
    const appt = makeAppointment({ hour: null })
    mockFindManyForChannel("push", appt)
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(fcmService.sendToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Votre rendez-vous est prévu aujourd'hui",
      }),
      ctx,
    )
  })

  // C1 round 2 — timezone Europe/Paris par défaut.
  it("C1 round 2 — timezone Europe/Paris par défaut + User.timezone override", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    // appt à 14:00 (timezone-less, considéré local cabinet)
    const appt = makeAppointment({
      emailEnc: encryptField("a@b.com"),
      hour: new Date("1970-01-01T14:00:00Z"),
      timezone: "Europe/Paris",
    })
    mockFindManyForChannel("email", appt)
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(emailService.sendAppointmentReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        // Heure 14:00 Paris → reste 14:00 dans le rendu (vs ancien 14:00 UTC).
        dateTime: expect.stringContaining("14"),
      }),
    )
  })
})
