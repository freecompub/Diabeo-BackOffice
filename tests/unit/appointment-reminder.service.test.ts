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

// CR-1 round 3 — mock cron-lock pour éviter d'instancier un vrai pg.Pool
// dans les tests. Le mock par défaut acquire le lock (returns fn()).
vi.mock("@/lib/db/cron-lock", () => ({
  withSessionAdvisoryLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
}))
import { withSessionAdvisoryLock } from "@/lib/db/cron-lock"
const mockWithSessionAdvisoryLock = vi.mocked(withSessionAdvisoryLock)

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
        // MED-5 round 3 — `timezone` retiré (V1 ignore le param formatDateTime).
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
  // CR-1 round 3 — re-établir le default behavior du mock cron-lock après
  // clearAllMocks (qui efface les implémentations).
  mockWithSessionAdvisoryLock.mockImplementation(
    async (_key: string, fn: () => Promise<unknown>) => fn(),
  )
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.appointmentReminder.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
  prismaMock.$queryRaw.mockResolvedValue([{ locked: true }] as any)
  // MED-1 round 3 — count opt-outs par défaut = 0.
  prismaMock.appointment.count.mockResolvedValue(0 as any)
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
    // CR-1 round 3 — `withSessionAdvisoryLock` retourne `null` si non acquis.
    mockWithSessionAdvisoryLock.mockResolvedValueOnce(null)
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

  // HI-2 round 3 — SMS mock V1 → persisté en SKIPPED (vs sent mensonger
  // round 2). En V3 (real Twilio/OVH), `status="sent"` reviendra.
  it("sms J-1 : mock V1 → status=skipped + errorReason='provider_mock_no_real_sms'", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const appt = makeAppointment({ phoneEnc: encryptField("+33612345678") })
    mockFindManyForChannel("sms", appt)
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    // HI-2 : skipped, pas sent. La timeline patient ne ment plus au médecin.
    expect(m.skipped).toBe(1)
    expect(m.sent).toBe(0)
    expect(smsService.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        cabinetId: 7,
        to: "+33612345678",
        contextKind: "appointment_reminder",
      }),
      null, ctx,
      expect.objectContaining({ patientId: 42, appointmentId: 1 }),
    )
    // Vérifie l'errorReason de skipped.
    expect(prismaMock.appointmentReminder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "skipped",
          errorMessage: "provider_mock_no_real_sms",
        }),
      }),
    )
  })

  // HI-2 round 3 — Quand un futur V3 retournera `status="sent"`, le persist
  // doit utiliser `sent` (vs skipped mock V1).
  it("HI-2 round 3 — SMS V3 real provider status='sent' → persist sent", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    vi.mocked(smsService.sendSms).mockResolvedValueOnce({
      sent: true, status: "sent", providerMessageId: "twilio-MX-123",
    })
    const appt = makeAppointment({ phoneEnc: encryptField("+33612345678") })
    mockFindManyForChannel("sms", appt)
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.sent).toBe(1)
    expect(m.skipped).toBe(0)
    expect(prismaMock.appointmentReminder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "sent",
          providerMessageId: "twilio-MX-123",
        }),
      }),
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

  // CR-1 round 3 — advisory lock via `withSessionAdvisoryLock` (pool dédié
  // max:1 garantit acquire + release sur même connexion physique). Round 2
  // utilisait `prisma.$queryRaw` partagé → bug pool.
  it("CR-1 round 3 — advisory lock via withSessionAdvisoryLock + key correcte", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    // 1 appel à withSessionAdvisoryLock avec la clé canonique.
    expect(mockWithSessionAdvisoryLock).toHaveBeenCalledTimes(1)
    expect(mockWithSessionAdvisoryLock).toHaveBeenCalledWith(
      "appointment-reminder-cron",
      expect.any(Function),
    )
  })

  // CR-1 round 3 — Si le lock n'est pas acquis (autre cron concurrent),
  // skippedConcurrent=true et findMany jamais appelé.
  it("CR-1 round 3 — lock non acquis → skippedConcurrent + audit cron.skipped_locked", async () => {
    mockWithSessionAdvisoryLock.mockResolvedValueOnce(null)
    const m = await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    expect(m.skippedConcurrent).toBe(true)
    expect(m.processed).toBe(0)
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled()
    const skippedAudit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === "appointment.reminder.cron.skipped_locked"
    })
    expect(skippedAudit).toBeDefined()
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

  // HI-1 round 3 — filtre `OR: [notifPreferences=null, medicalAppointments=true]`
  // (l'opt-in implicite : patient sans préférences explicites est inclus).
  // Round 2 utilisait `{medicalAppointments: true}` → EXISTS SQL excluait à
  // tort la majorité des patients (préférences créées lazily).
  it("HI-1 round 3 — filtre OR notifPreferences null OR medicalAppointments=true", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    const where = prismaMock.appointment.findMany.mock.calls[0]![0]!.where as any
    expect(where.patient.user.OR).toEqual([
      { notifPreferences: null },
      { notifPreferences: { medicalAppointments: true } },
    ])
  })

  // MED-1 round 3 — count opt-outs RGPD Art. 21 + audit cron.run metadata.
  it("MED-1 round 3 — opt-outs comptés + audit cron.run.metadata.optOutSkipped", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([])
    // Mock count : 3 opt-outs sur le step push, 0 sur sms et email.
    prismaMock.appointment.count
      .mockResolvedValueOnce(3 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any)
    await appointmentReminderService.processAppointmentReminders(new Date(), ctx)
    const runAudit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === "appointment.reminder.cron.run"
    })
    expect(runAudit).toBeDefined()
    const meta = (runAudit![0].data as any).metadata
    expect(meta.optOutSkipped).toBe(3)
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

  // HI-3 round 3 — Test C1 timezone renforcé : "14:00 stocké" doit toujours
  // rendre "14:00 affiché" quelle que soit la TZ du runtime Node. Round 2 le
  // test utilisait `stringContaining("14")` trop laxiste (matchait aussi
  // "14 mai 2026 à 02:00"). Pattern strict `\b14:00\b` + loop sur runtime TZ.
  it("HI-3 round 3 — timezone fidèle : 14:00 stocké → 14:00 affiché (runtime UTC + Paris + NYC)", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const originalTZ = process.env.TZ
    try {
      for (const runtimeTZ of ["UTC", "Europe/Paris", "America/New_York"]) {
        process.env.TZ = runtimeTZ
        vi.clearAllMocks()
        mockWithSessionAdvisoryLock.mockImplementation(
          async (_key: string, fn: () => Promise<unknown>) => fn(),
        )
        prismaMock.auditLog.create.mockResolvedValue({} as any)
        prismaMock.appointmentReminder.create.mockResolvedValue({} as any)
        prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
        prismaMock.appointment.count.mockResolvedValue(0 as any)
        vi.mocked(emailService.sendAppointmentReminder).mockResolvedValue({
          sent: true, id: "resend-1",
        })

        const appt = makeAppointment({
          emailEnc: encryptField("a@b.com"),
          hour: new Date("1970-01-01T14:00:00Z"),
        })
        mockFindManyForChannel("email", appt)
        await appointmentReminderService.processAppointmentReminders(
          new Date("2026-05-21T00:00:00Z"), ctx,
        )
        const call = vi.mocked(emailService.sendAppointmentReminder).mock.calls.at(-1)
        // Pattern strict : "14:00" exactement (vs "14 mai à 02:00" qui passait
        // round 2 par stringContaining laxiste).
        expect(call![0].dateTime).toMatch(/\b14:00\b/)
        // Anti-régression : pas de "16:00" (double conversion CEST) ni "02:00".
        expect(call![0].dateTime).not.toMatch(/\b16:00\b/)
        expect(call![0].dateTime).not.toMatch(/\b02:00\b/)
      }
    } finally {
      process.env.TZ = originalTZ
    }
  })
})
