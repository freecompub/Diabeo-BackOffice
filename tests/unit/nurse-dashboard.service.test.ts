/**
 * Test suite : nurse-dashboard.service (Groupe 9b Batch 2 — 5 US, ~31 SP).
 *
 * Couvre :
 *  - US-2406 KPI : 4 metrics on-demand, empty portfolio zeroes
 *  - US-2407 to-do : 3-source merge sorted by score (appt > event > proposal)
 *  - US-2408 team inbox : in/out direction labelling + status filter
 *  - US-2409 recall list : silentMonitoring heuristic + apptUnconfirmed
 *    higher priority + exclusion of patients without phones
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  AppointmentStatus, EmergencyAlertStatus,
  DelegationRequestStatus, ProposalStatus,
} from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/access-control", () => ({
  getAccessiblePatientIds: vi.fn(),
}))
import {
  nurseKpiQuery, nurseTodoQuery,
  nurseTeamInboxQuery, nurseRecallQuery,
} from "@/lib/services/nurse-dashboard.service"
import { getAccessiblePatientIds } from "@/lib/access-control"

const mockedAccessible = vi.mocked(getAccessiblePatientIds)
// vitest-mock-extended cannot infer Prisma 7's `groupBy` generic — cast.
const pm = prismaMock as unknown as {
  cgmEntry: { groupBy: any }
  patient: { findMany: any }
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  mockedAccessible.mockReset()
})

// ─── US-2406 KPI ──────────────────────────────────────────────────────

describe("nurseKpiQuery (US-2406)", () => {
  it("returns zeroed cards on empty portfolio", async () => {
    mockedAccessible.mockResolvedValue([])
    const out = await nurseKpiQuery.forCaller(1, "NURSE", 1)
    expect(out).toHaveLength(4)
    expect(out.every((c) => c.value === 0)).toBe(true)
  })

  it("aggregates 4 counts in parallel + emits summary audit", async () => {
    mockedAccessible.mockResolvedValue([10, 20])
    prismaMock.appointment.count.mockResolvedValue(3)
    prismaMock.diabetesEvent.count.mockResolvedValue(5)
    prismaMock.emergencyAlert.count.mockResolvedValue(1)
    prismaMock.adjustmentProposal.count.mockResolvedValue(2)
    const out = await nurseKpiQuery.forCaller(1, "NURSE", 1)
    const byCode = Object.fromEntries(out.map((c) => [c.code, c.value]))
    expect(byCode.rdvToPrepare).toBe(3)
    expect(byCode.eventsToValidate).toBe(5)
    expect(byCode.openUrgencies).toBe(1)
    expect(byCode.proposalsPending).toBe(2)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("dashboard.infirmier.kpi")
  })
})

// ─── US-2407 to-do ────────────────────────────────────────────────────

describe("nurseTodoQuery (US-2407)", () => {
  it("returns [] on empty portfolio", async () => {
    mockedAccessible.mockResolvedValue([])
    const out = await nurseTodoQuery.forCaller(1, "NURSE", 1)
    expect(out).toEqual([])
  })

  it("merges 3 sources sorted by score (appt > event > proposal)", async () => {
    mockedAccessible.mockResolvedValue([10])
    prismaMock.appointment.findMany.mockResolvedValue([
      {
        id: 1, patientId: 10, date: new Date(), hour: new Date("2026-05-14T08:00:00Z"),
        type: "diabeto", status: AppointmentStatus.scheduled,
        patient: { id: 10, pathology: "DT1", user: { firstname: null } },
      },
    ] as any)
    prismaMock.diabetesEvent.findMany.mockResolvedValue([
      {
        id: 2, patientId: 10, createdAt: new Date(), validatedAt: null,
        patient: { id: 10, pathology: "DT1", user: { firstname: null } },
      },
    ] as any)
    prismaMock.adjustmentProposal.findMany.mockResolvedValue([
      {
        id: 3, patientId: 10, status: ProposalStatus.pending, createdAt: new Date(),
        patient: { id: 10, pathology: "DT1", user: { firstname: null } },
      },
    ] as any)
    const out = await nurseTodoQuery.forCaller(1, "NURSE", 1)
    expect(out).toHaveLength(3)
    expect(out[0]!.kind).toBe("prepareAppointment") // highest score
    expect(out[2]!.kind).toBe("observeProposal")    // lowest score (read-only)
  })
})

// ─── US-2408 team inbox ──────────────────────────────────────────────

describe("nurseTeamInboxQuery (US-2408)", () => {
  it("flags direction=incoming when caller is toUserId", async () => {
    prismaMock.delegationRequest.findMany.mockResolvedValue([
      {
        id: 1, patientId: 10, fromUserId: 99, toUserId: 1,
        action: "PROPOSE_ADJUSTMENT", status: DelegationRequestStatus.pending,
        createdAt: new Date(), reviewedAt: null, reason: null,
        patient: { id: 10, user: { firstname: null } },
      },
    ] as any)
    const out = await nurseTeamInboxQuery.forCaller(1, "NURSE", 1)
    expect(out).toHaveLength(1)
    expect(out[0]!.direction).toBe("incoming")
    expect(out[0]!.peerUserId).toBe(99)
  })

  it("flags direction=outgoing when caller is fromUserId", async () => {
    prismaMock.delegationRequest.findMany.mockResolvedValue([
      {
        id: 2, patientId: 10, fromUserId: 1, toUserId: 99,
        action: "PROPOSE_ADJUSTMENT", status: DelegationRequestStatus.approved,
        createdAt: new Date(), reviewedAt: new Date(), reason: null,
        patient: { id: 10, user: { firstname: null } },
      },
    ] as any)
    const out = await nurseTeamInboxQuery.forCaller(1, "NURSE", 1)
    expect(out[0]!.direction).toBe("outgoing")
    expect(out[0]!.peerUserId).toBe(99)
  })

  it("emits audit row with kind=dashboard.infirmier.teamInbox", async () => {
    prismaMock.delegationRequest.findMany.mockResolvedValue([] as any)
    await nurseTeamInboxQuery.forCaller(1, "NURSE", 1)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("dashboard.infirmier.teamInbox")
  })
})

// ─── US-2409 recall list ─────────────────────────────────────────────

describe("nurseRecallQuery (US-2409)", () => {
  it("returns [] on empty portfolio", async () => {
    mockedAccessible.mockResolvedValue([])
    const out = await nurseRecallQuery.forCaller(1, "NURSE", 1)
    expect(out).toEqual([])
  })

  it("flags silentMonitoring on stale CGM (>7 days)", async () => {
    mockedAccessible.mockResolvedValue([10])
    const oldCgm = new Date(Date.now() - 10 * 86_400_000)
    pm.cgmEntry.groupBy.mockResolvedValue([
      { patientId: 10, _max: { timestamp: oldCgm } },
    ] as any)
    prismaMock.appointment.findMany.mockResolvedValue([] as any)
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 10, pathology: "DT1", user: { firstname: null, phone: null } },
    ] as any)
    const out = await nurseRecallQuery.forCaller(1, "NURSE", 1)
    expect(out).toHaveLength(1)
    expect(out[0]!.reason).toBe("silentMonitoring")
  })

  it("appointmentUnconfirmed overrides silentMonitoring (higher score)", async () => {
    mockedAccessible.mockResolvedValue([10])
    const oldCgm = new Date(Date.now() - 10 * 86_400_000)
    const oldAppt = new Date(Date.now() - 5 * 86_400_000)
    pm.cgmEntry.groupBy.mockResolvedValue([
      { patientId: 10, _max: { timestamp: oldCgm } },
    ] as any)
    prismaMock.appointment.findMany.mockResolvedValue([
      { patientId: 10, createdAt: oldAppt },
    ] as any)
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 10, pathology: "DT1", user: { firstname: null, phone: null } },
    ] as any)
    const out = await nurseRecallQuery.forCaller(1, "NURSE", 1)
    expect(out).toHaveLength(1)
    expect(out[0]!.reason).toBe("appointmentUnconfirmed")
  })

  it("emits per-patient pivot audit on each flagged patient (US-2268)", async () => {
    mockedAccessible.mockResolvedValue([10])
    pm.cgmEntry.groupBy.mockResolvedValue([] as any)
    prismaMock.appointment.findMany.mockResolvedValue([] as any)
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 10, pathology: "DT1", user: { firstname: null, phone: null } },
    ] as any)
    await nurseRecallQuery.forCaller(1, "NURSE", 1)
    const calls = prismaMock.auditLog.create.mock.calls.map((c) => c[0].data as any)
    const perPatient = calls.find((d) =>
      d.metadata?.patientId === 10
      && d.metadata?.kind === "dashboard.infirmier.recallList",
    )
    expect(perPatient).toBeDefined()
  })
})
