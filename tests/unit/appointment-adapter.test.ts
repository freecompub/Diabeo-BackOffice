/**
 * Tests unitaires pour l'adapter `AppointmentListItem` → ScheduleXEvent.
 *
 * Fix H-8 round 2 review PR #431 — couvre les edge cases identifiés :
 *   - CR-3 : rollover minuit (`23:45 + 60min` → J+1 00:45)
 *   - HSA MED-4 : fallback hour=null silencieux (badge à venir M-3)
 *   - L-3 : status fallback inconnu → `scheduled`
 *   - Anti-PHI : title = type uppercase uniquement, jamais motif/nom
 */

import { describe, it, expect } from "vitest"
import { appointmentToScheduleXEvent, APPOINTMENT_CALENDARS } from "@/components/diabeo/appointments/adapter"
import type { AppointmentListItem } from "@/components/diabeo/appointments/useAppointments"

function makeAppt(overrides: Partial<AppointmentListItem> = {}): AppointmentListItem {
  return {
    id: 1,
    patientId: 42,
    memberId: 7,
    type: "diabeto",
    date: "2026-05-15",
    hour: "09:30:00",
    durationMinutes: 30,
    location: "in_person",
    status: "scheduled",
    proposedAlternativeAt: null,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("appointmentToScheduleXEvent", () => {
  describe("date/time combine", () => {
    it("combine date yyyy-mm-dd + hour hh:mm:ss → 'yyyy-mm-dd hh:mm'", () => {
      const evt = appointmentToScheduleXEvent(makeAppt())
      expect(evt.start).toBe("2026-05-15 09:30")
    })

    it("supporte hour au format ISO complet (post-JSON serialization)", () => {
      const evt = appointmentToScheduleXEvent(
        makeAppt({ hour: "1970-01-01T09:30:00.000Z" }),
      )
      expect(evt.start).toBe("2026-05-15 09:30")
    })

    it("hour=null fallback à 09:00 (V1 — TODO M-3 badge UI à venir)", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ hour: null }))
      expect(evt.start).toBe("2026-05-15 09:00")
    })
  })

  describe("addMinutes rollover (fix CR-3)", () => {
    it("rollover minuit J → J+1 (22:00 + 180min → J+1 01:00)", () => {
      const evt = appointmentToScheduleXEvent(
        makeAppt({ hour: "22:00:00", durationMinutes: 180 }),
      )
      expect(evt.start).toBe("2026-05-15 22:00")
      expect(evt.end).toBe("2026-05-16 01:00")
    })

    it("rollover fin de mois (31 → 01 du mois suivant)", () => {
      const evt = appointmentToScheduleXEvent(
        makeAppt({ date: "2026-05-31", hour: "23:45:00", durationMinutes: 30 }),
      )
      expect(evt.start).toBe("2026-05-31 23:45")
      expect(evt.end).toBe("2026-06-01 00:15")
    })

    it("durée standard 30 min sans rollover", () => {
      const evt = appointmentToScheduleXEvent(
        makeAppt({ hour: "09:30:00", durationMinutes: 30 }),
      )
      expect(evt.end).toBe("2026-05-15 10:00")
    })

    it("durée max 240 min ne corrompt pas si pas de rollover", () => {
      const evt = appointmentToScheduleXEvent(
        makeAppt({ hour: "08:00:00", durationMinutes: 240 }),
      )
      expect(evt.end).toBe("2026-05-15 12:00")
    })

    it("fallback durationMinutes=null → 30 min", () => {
      const evt = appointmentToScheduleXEvent(
        makeAppt({ hour: "09:30:00", durationMinutes: null }),
      )
      expect(evt.end).toBe("2026-05-15 10:00")
    })
  })

  describe("status → calendarId mapping", () => {
    it("scheduled → 'scheduled'", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ status: "scheduled" }))
      expect(evt.calendarId).toBe("scheduled")
    })

    it("pending_validation → 'pendingValidation' (snake → camel)", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ status: "pending_validation" }))
      expect(evt.calendarId).toBe("pendingValidation")
    })

    it("confirmed → 'confirmed'", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ status: "confirmed" }))
      expect(evt.calendarId).toBe("confirmed")
    })

    it("cancelled → 'cancelled'", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ status: "cancelled" }))
      expect(evt.calendarId).toBe("cancelled")
    })

    it("completed → 'completed'", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ status: "completed" }))
      expect(evt.calendarId).toBe("completed")
    })

    it("no_show → 'noShow'", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ status: "no_show" }))
      expect(evt.calendarId).toBe("noShow")
    })

    it("status inconnu (futur ajout enum) → fallback 'scheduled'", () => {
      const evt = appointmentToScheduleXEvent(
        // @ts-expect-error testing fallback on unknown status
        makeAppt({ status: "unknown_status" }),
      )
      expect(evt.calendarId).toBe("scheduled")
    })
  })

  describe("title anti-PHI strict (whitelist L-3)", () => {
    it("title = type uppercase si type whitelisted (diabeto)", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ type: "diabeto" }))
      expect(evt.title).toBe("DIABETO")
    })

    it("title = type uppercase pour ide / hdj", () => {
      expect(appointmentToScheduleXEvent(makeAppt({ type: "ide" })).title).toBe("IDE")
      expect(appointmentToScheduleXEvent(makeAppt({ type: "hdj" })).title).toBe("HDJ")
    })

    it("L-3 : type INCONNU (PHI accidentelle) → 'OTHER' au lieu de raw uppercase", () => {
      // Simule backend qui laisse passer un type arbitraire (anti-PHI leak)
      const evt = appointmentToScheduleXEvent(makeAppt({ type: "Mme Martine Dupont" }))
      expect(evt.title).toBe("OTHER")
      expect(evt.title).not.toContain("MARTINE")
      expect(evt.title).not.toContain("DUPONT")
    })

    it("title = 'RDV' fallback si type null", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ type: null }))
      expect(evt.title).toBe("RDV")
    })

    it("title NE contient JAMAIS de PHI identifiable", () => {
      const evt = appointmentToScheduleXEvent(makeAppt())
      expect(evt.title).not.toContain("42") // patientId
      expect(evt.title).not.toContain("M.") // pas de civilité
      expect(evt.title).not.toContain("@")  // pas d'email
    })
  })

  describe("M-3 : RDV sans heure → calendarId unscheduled (visuel distinct)", () => {
    it("hour=null → calendarId 'unscheduled' (couleur grise)", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ hour: null }))
      expect(evt.calendarId).toBe("unscheduled")
    })

    it("hour présent → calendarId selon status (pas unscheduled)", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ hour: "09:30:00", status: "confirmed" }))
      expect(evt.calendarId).toBe("confirmed")
    })
  })

  describe("id mapping", () => {
    it("id = String(appt.id)", () => {
      const evt = appointmentToScheduleXEvent(makeAppt({ id: 999 }))
      expect(evt.id).toBe("999")
    })
  })

  describe("APPOINTMENT_CALENDARS palette WCAG AA", () => {
    it("expose 7 calendars (6 statuts + unscheduled M-3)", () => {
      expect(Object.keys(APPOINTMENT_CALENDARS)).toHaveLength(7)
      expect(APPOINTMENT_CALENDARS.scheduled.lightColors.main).toBe("#0D9488")
      expect(APPOINTMENT_CALENDARS.noShow.lightColors.main).toBe("#991B1B")
      expect(APPOINTMENT_CALENDARS.unscheduled.lightColors.main).toBe("#9CA3AF")
    })
  })
})
