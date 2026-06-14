/**
 * Test suite : doctor-dashboard.service (Groupe 9b Batch 1 — 5 US, ~34 SP).
 *
 * Couvre :
 *  - US-2401 urgencies : portfolio scoping, criticality sort, limit=5
 *  - US-2402 appointments : today window, scope, limit=3
 *  - US-2403 patients-at-risk : hypo threshold, silent detection, exclusion
 *    of open-urgency patients
 *  - US-2404 KPI : trend up/down/flat, TIR fraction, empty portfolio
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  EmergencyAlertStatus, EmergencyAlertType, EmergencyAlertSeverity,
  AppointmentStatus,
} from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/access-control", () => ({
  getAccessiblePatientIds: vi.fn(),
}))
// Isolate `unreadThreadsQuery` from the heavy messaging service (pepper/env,
// redis, encryption) — only `listThreads` + the bounds constant are consumed.
vi.mock("@/lib/services/messaging.service", () => ({
  messagingService: { listThreads: vi.fn() },
  MESSAGING_BOUNDS: { MAX_THREADS_PER_QUERY: 100 },
}))
import {
  urgenciesQuery, appointmentsQuery,
  patientsAtRiskQuery, kpisQuery, pendingProposalsQuery,
  unreadThreadsQuery,
} from "@/lib/services/doctor-dashboard.service"
import { getAccessiblePatientIds } from "@/lib/access-control"
import { messagingService } from "@/lib/services/messaging.service"

const mockedAccessible = vi.mocked(getAccessiblePatientIds)
const mockedListThreads = vi.mocked(messagingService.listThreads)
// Prisma's `groupBy` has a complex generic signature that defeats
// vitest-mock-extended's deep auto-mock typing ; cast once here so test
// `mockResolvedValue` calls type-check under CI's stricter tsc.
const pm = prismaMock as unknown as {
  emergencyAlert: {
    findMany: any; count: any; groupBy: any;
  }
  cgmEntry: { findMany: any; count: any; groupBy: any }
  appointment: { findMany: any }
  patient: { findMany: any }
  adjustmentProposal: { count: any; findMany: any }
  auditLog: { create: any }
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  mockedAccessible.mockReset()
  mockedListThreads.mockReset()
})

const CTX = { ipAddress: "127.0.0.1", userAgent: "test", requestId: "req-1" }

// ─── US-2401 urgencies ───────────────────────────────────────────────────

describe("urgenciesQuery (US-2401)", () => {
  it("returns [] when caller has empty portfolio", async () => {
    mockedAccessible.mockResolvedValue([])
    const out = await urgenciesQuery.forCaller(1, "DOCTOR", 1)
    expect(out).toEqual([])
    expect(prismaMock.emergencyAlert.findMany).not.toHaveBeenCalled()
  })

  it("sorts by criticality (DKA before hypo), limits to 5", async () => {
    mockedAccessible.mockResolvedValue([10, 20, 30])
    const now = new Date("2026-05-14T10:00:00Z")
    prismaMock.emergencyAlert.findMany.mockResolvedValue([
      {
        id: 1, patientId: 10, alertType: EmergencyAlertType.hypo,
        severity: EmergencyAlertSeverity.warning,
        status: EmergencyAlertStatus.open,
        triggeredAt: now, glucoseValueMgdl: null, ketoneValueMmol: null,
        patient: { id: 10, pathology: "DT1", user: { firstname: null } },
      },
      {
        id: 2, patientId: 20, alertType: EmergencyAlertType.ketone_dka,
        severity: EmergencyAlertSeverity.critical,
        status: EmergencyAlertStatus.open,
        triggeredAt: now, glucoseValueMgdl: null, ketoneValueMmol: null,
        patient: { id: 20, pathology: "DT1", user: { firstname: null } },
      },
    ] as any)
    const out = await urgenciesQuery.forCaller(1, "DOCTOR", 1)
    expect(out[0]!.alertType).toBe("ketone_dka") // most critical first
    expect(out).toHaveLength(2)
  })

  it("emits 1 audit row with kind = dashboard.medecin.urgencies", async () => {
    mockedAccessible.mockResolvedValue([10])
    prismaMock.emergencyAlert.findMany.mockResolvedValue([] as any)
    await urgenciesQuery.forCaller(1, "DOCTOR", 1)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("dashboard.medecin.urgencies")
  })
})

// ─── US-2402 appointments ────────────────────────────────────────────────

describe("appointmentsQuery (US-2402)", () => {
  it("returns [] when empty portfolio", async () => {
    mockedAccessible.mockResolvedValue([])
    const out = await appointmentsQuery.forCaller(1, "NURSE", 1)
    expect(out).toEqual([])
  })

  it("queries today's scheduled+pending_validation, limit 3", async () => {
    mockedAccessible.mockResolvedValue([10])
    prismaMock.appointment.findMany.mockResolvedValue([
      {
        id: 1, patientId: 10, date: new Date(), hour: new Date("2026-05-14T08:00:00Z"),
        type: "diabeto", status: AppointmentStatus.scheduled, location: "video",
        patient: { id: 10, pathology: "DT2", user: { firstname: null } },
      },
    ] as any)
    const out = await appointmentsQuery.forCaller(1, "NURSE", 1)
    expect(out).toHaveLength(1)
    expect(out[0]!.location).toBe("video")
    const callArg = prismaMock.appointment.findMany.mock.calls[0]![0]
    expect(callArg!.take).toBe(3)
  })
})

// ─── US-2403 patients-at-risk ────────────────────────────────────────────

describe("patientsAtRiskQuery (US-2403)", () => {
  it("returns [] when empty portfolio", async () => {
    mockedAccessible.mockResolvedValue([])
    const out = await patientsAtRiskQuery.forCaller(1, "DOCTOR", 1)
    expect(out).toEqual([])
  })

  it("flags hypos >=3/7d and excludes patients with open urgencies", async () => {
    mockedAccessible.mockResolvedValue([10, 20])
    // Patient 20 is in open urgency → excluded entirely.
    prismaMock.emergencyAlert.findMany.mockResolvedValue([
      { patientId: 20 },
    ] as any)
    pm.emergencyAlert.groupBy.mockResolvedValue([
      { patientId: 10, _count: { patientId: 4 } }, // flag recentHypos
      { patientId: 20, _count: { patientId: 5 } }, // excluded
    ] as any)
    // Patient 10 has recent CGM (no silence flag).
    pm.cgmEntry.groupBy.mockResolvedValue([
      { patientId: 10, _max: { timestamp: new Date() } },
      { patientId: 20, _max: { timestamp: new Date() } },
    ] as any)
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 10, pathology: "DT1", user: { firstname: null } },
    ] as any)
    const out = await patientsAtRiskQuery.forCaller(1, "DOCTOR", 1)
    expect(out).toHaveLength(1)
    expect(out[0]!.patientId).toBe(10)
    expect(out[0]!.reason).toBe("recentHypos")
  })

  it("flags silence > 5 days without CGM activity", async () => {
    mockedAccessible.mockResolvedValue([10])
    prismaMock.emergencyAlert.findMany.mockResolvedValue([] as any)
    pm.emergencyAlert.groupBy.mockResolvedValue([] as any)
    const oldCgm = new Date(Date.now() - 10 * 86_400_000)
    pm.cgmEntry.groupBy.mockResolvedValue([
      { patientId: 10, _max: { timestamp: oldCgm } },
    ] as any)
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 10, pathology: "DT1", user: { firstname: null } },
    ] as any)
    const out = await patientsAtRiskQuery.forCaller(1, "DOCTOR", 1)
    expect(out).toHaveLength(1)
    expect(out[0]!.reason).toBe("silentMonitoring")
  })

  it("flags patients with no CGM entry at all (assumed silent ≥ SILENT_DAYS+1)", async () => {
    mockedAccessible.mockResolvedValue([10])
    prismaMock.emergencyAlert.findMany.mockResolvedValue([] as any)
    pm.emergencyAlert.groupBy.mockResolvedValue([] as any)
    pm.cgmEntry.groupBy.mockResolvedValue([] as any) // no rows for 10
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 10, pathology: "DT1", user: { firstname: null } },
    ] as any)
    const out = await patientsAtRiskQuery.forCaller(1, "DOCTOR", 1)
    expect(out).toHaveLength(1)
    expect(out[0]!.reason).toBe("silentMonitoring")
  })

  it("audits per-patient (US-2268 pivot)", async () => {
    mockedAccessible.mockResolvedValue([10])
    prismaMock.emergencyAlert.findMany.mockResolvedValue([] as any)
    pm.emergencyAlert.groupBy.mockResolvedValue([
      { patientId: 10, _count: { patientId: 5 } },
    ] as any)
    pm.cgmEntry.groupBy.mockResolvedValue([] as any)
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 10, pathology: "DT1", user: { firstname: null } },
    ] as any)
    await patientsAtRiskQuery.forCaller(1, "DOCTOR", 1)
    // Last audit row has metadata.patientId = 10 (per-patient pivot).
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.patientId).toBe(10)
    expect(meta.metadata.kind).toBe("dashboard.medecin.patientsAtRisk")
  })
})

// ─── US-2404 KPIs ────────────────────────────────────────────────────────

describe("kpisQuery (US-2404)", () => {
  it("returns zeroed cards when empty portfolio (DOCTOR with no service)", async () => {
    mockedAccessible.mockResolvedValue([])
    const out = await kpisQuery.forCaller(1, "DOCTOR", 1)
    expect(out).toHaveLength(4)
    expect(out.every((c) => c.value === 0)).toBe(true)
  })

  it("computes activePatients + TIR + urgencies + proposals with trend", async () => {
    mockedAccessible.mockResolvedValue([10, 20])
    // 2 patients active now, 1 prev → delta +1, trend up.
    pm.cgmEntry.groupBy
      .mockResolvedValueOnce([{ patientId: 10 }, { patientId: 20 }] as any)
      .mockResolvedValueOnce([{ patientId: 10 }] as any)
    prismaMock.cgmEntry.count
      .mockResolvedValueOnce(100) // total now
      .mockResolvedValueOnce(70)  // in range now → 70%
      .mockResolvedValueOnce(80)  // total prev
      .mockResolvedValueOnce(56)  // in range prev → 70%
    prismaMock.emergencyAlert.count.mockResolvedValueOnce(3)
    prismaMock.adjustmentProposal.count.mockResolvedValueOnce(5)
    const out = await kpisQuery.forCaller(1, "DOCTOR", 1)
    const byCode = Object.fromEntries(out.map((c) => [c.code, c]))
    expect(byCode.activePatients!.value).toBe(2)
    expect(byCode.activePatients!.delta).toBe(1)
    expect(byCode.activePatients!.trend).toBe("up")
    expect(byCode.avgTir!.value).toBe(70)
    expect(byCode.weekUrgencies!.value).toBe(3)
    expect(byCode.pendingProposals!.value).toBe(5)
  })

  it("returns null trend for TIR when no prior data", async () => {
    mockedAccessible.mockResolvedValue([10])
    pm.cgmEntry.groupBy
      .mockResolvedValueOnce([{ patientId: 10 }] as any)
      .mockResolvedValueOnce([] as any)
    prismaMock.cgmEntry.count
      .mockResolvedValueOnce(50)
      .mockResolvedValueOnce(40)
      .mockResolvedValueOnce(0) // no prev
      .mockResolvedValueOnce(0)
    prismaMock.emergencyAlert.count.mockResolvedValueOnce(0)
    prismaMock.adjustmentProposal.count.mockResolvedValueOnce(0)
    const out = await kpisQuery.forCaller(1, "DOCTOR", 1)
    const tir = out.find((c) => c.code === "avgTir")!
    expect(tir.trend).toBeNull()
    expect(tir.delta).toBeNull()
  })

  // ─── code-review L4 — TIR drop scenario (down trend) ───────────────────
  it("L4 — TIR drop from prior window emits down trend + negative delta", async () => {
    mockedAccessible.mockResolvedValue([10])
    pm.cgmEntry.groupBy
      .mockResolvedValueOnce([{ patientId: 10 }] as any)
      .mockResolvedValueOnce([{ patientId: 10 }] as any)
    prismaMock.cgmEntry.count
      .mockResolvedValueOnce(100) // total now
      .mockResolvedValueOnce(50)  // in range now → 50%
      .mockResolvedValueOnce(100) // total prev
      .mockResolvedValueOnce(80)  // in range prev → 80%
    prismaMock.emergencyAlert.count.mockResolvedValueOnce(0)
    prismaMock.adjustmentProposal.count.mockResolvedValueOnce(0)
    const out = await kpisQuery.forCaller(1, "DOCTOR", 1)
    const tir = out.find((c) => c.code === "avgTir")!
    expect(tir.value).toBe(50)
    expect(tir.delta).toBe(-30) // 50 - 80
    expect(tir.trend).toBe("down")
  })
})

// ─── code-review L1 — CRITICALITY_ORDER invariants ─────────────────────

describe("CRITICALITY_ORDER (L1)", () => {
  it("orders DKA before severe_hypo before hypo before manual", async () => {
    const { CRITICALITY_ORDER } = await import(
      "@/lib/services/doctor-dashboard.service"
    )
    expect(CRITICALITY_ORDER.ketone_dka).toBeLessThan(CRITICALITY_ORDER.severe_hypo)
    expect(CRITICALITY_ORDER.severe_hypo).toBeLessThan(CRITICALITY_ORDER.hypo)
    expect(CRITICALITY_ORDER.hypo).toBeLessThan(CRITICALITY_ORDER.manual)
    expect(CRITICALITY_ORDER.ketone_moderate).toBeLessThan(CRITICALITY_ORDER.hypo)
  })
})

// ─── code-review L3 — HYPO_THRESHOLD_7D boundary ──────────────────────

describe("patientsAtRiskQuery boundaries (L3)", () => {
  it("does NOT flag at 2 hypos (below threshold)", async () => {
    mockedAccessible.mockResolvedValue([10])
    prismaMock.emergencyAlert.findMany.mockResolvedValue([] as any)
    pm.emergencyAlert.groupBy.mockResolvedValue([
      { patientId: 10, _count: { patientId: 2 } },
    ] as any)
    pm.cgmEntry.groupBy.mockResolvedValue([
      { patientId: 10, _max: { timestamp: new Date() } },
    ] as any)
    prismaMock.patient.findMany.mockResolvedValue([] as any)
    const out = await patientsAtRiskQuery.forCaller(1, "DOCTOR", 1)
    expect(out).toEqual([])
  })

  it("flags at exactly 3 hypos (boundary)", async () => {
    mockedAccessible.mockResolvedValue([10])
    prismaMock.emergencyAlert.findMany.mockResolvedValue([] as any)
    pm.emergencyAlert.groupBy.mockResolvedValue([
      { patientId: 10, _count: { patientId: 3 } },
    ] as any)
    pm.cgmEntry.groupBy.mockResolvedValue([
      { patientId: 10, _max: { timestamp: new Date() } },
    ] as any)
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 10, pathology: "DT1", user: { firstname: null } },
    ] as any)
    const out = await patientsAtRiskQuery.forCaller(1, "DOCTOR", 1)
    expect(out).toHaveLength(1)
    expect(out[0]!.reason).toBe("recentHypos")
  })
})

// ─── healthcare M2 — summary audit always emitted ─────────────────────

describe("patientsAtRiskQuery summary audit (healthcare M2)", () => {
  it("emits summary resourceId:0 row even on non-empty result", async () => {
    mockedAccessible.mockResolvedValue([10])
    prismaMock.emergencyAlert.findMany.mockResolvedValue([] as any)
    pm.emergencyAlert.groupBy.mockResolvedValue([
      { patientId: 10, _count: { patientId: 5 } },
    ] as any)
    pm.cgmEntry.groupBy.mockResolvedValue([
      { patientId: 10, _max: { timestamp: new Date() } },
    ] as any)
    prismaMock.patient.findMany.mockResolvedValue([
      { id: 10, pathology: "DT1", user: { firstname: null } },
    ] as any)
    await patientsAtRiskQuery.forCaller(1, "DOCTOR", 1)
    // Summary row should have resourceId="0" AND a per-patient row should
    // have metadata.patientId set.
    const calls = prismaMock.auditLog.create.mock.calls.map((c) => (c[0].data as any))
    const summary = calls.find((d) =>
      d.resourceId === "0"
      && d.metadata?.kind === "dashboard.medecin.patientsAtRisk"
      && d.metadata?.count === 1,
    )
    expect(summary).toBeDefined()
    const perPatient = calls.find((d) =>
      d.metadata?.patientId === 10
      && d.metadata?.kind === "dashboard.medecin.patientsAtRisk",
    )
    expect(perPatient).toBeDefined()
  })
})

// ─── US-2602 pending proposals ───────────────────────────────────────────

describe("pendingProposalsQuery (US-2602)", () => {
  it("returns [] when caller has empty portfolio", async () => {
    mockedAccessible.mockResolvedValue([])
    const out = await pendingProposalsQuery.forCaller(1, "DOCTOR", 1)
    expect(out).toEqual([])
    expect(pm.adjustmentProposal.findMany).not.toHaveBeenCalled()
  })

  it("filters status=pending and maps Decimal → number", async () => {
    mockedAccessible.mockResolvedValue([10, 20])
    pm.adjustmentProposal.findMany.mockResolvedValue([
      {
        id: "p1", patientId: 10, parameterType: "basalRate",
        currentValue: 1.2, proposedValue: 1.0, changePercent: -16.67,
        createdAt: new Date("2026-06-10T08:00:00Z"),
        patient: { id: 10, pathology: "DT1", user: { firstname: null } },
      },
    ] as any)
    const out = await pendingProposalsQuery.forCaller(1, "DOCTOR", 1)
    const where = pm.adjustmentProposal.findMany.mock.calls[0]![0].where
    expect(where.status).toBe("pending")
    expect(where.patientId).toEqual({ in: [10, 20] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: "p1", patientId: 10, parameterType: "basalRate",
      currentValue: 1.2, proposedValue: 1.0, patientFirstName: "",
    })
    expect(typeof out[0]!.changePercent).toBe("number")
  })

  it("audits a summary row (resourceId=0) and a per-patient pivot row", async () => {
    mockedAccessible.mockResolvedValue([10])
    pm.adjustmentProposal.findMany.mockResolvedValue([
      {
        id: "p1", patientId: 10, parameterType: "insulinToCarbRatio",
        currentValue: 10, proposedValue: 12, changePercent: 20,
        createdAt: new Date(), patient: { id: 10, pathology: "DT2", user: { firstname: null } },
      },
    ] as any)
    await pendingProposalsQuery.forCaller(1, "DOCTOR", 1)
    const calls = prismaMock.auditLog.create.mock.calls.map((c) => (c[0].data as any))
    const summary = calls.find((d) =>
      d.resourceId === "0"
      && d.resource === "ADJUSTMENT_PROPOSAL"
      && d.metadata?.kind === "dashboard.medecin.pendingProposals"
      && d.metadata?.count === 1,
    )
    expect(summary).toBeDefined()
    const perPatient = calls.find((d) =>
      d.metadata?.patientId === 10
      && d.metadata?.kind === "dashboard.medecin.pendingProposals",
    )
    expect(perPatient).toBeDefined()
  })
})

// ─── US-2602 unread threads ──────────────────────────────────────────────

describe("unreadThreadsQuery (US-2602)", () => {
  const thread = (key: string, unread: number, at: string) => ({
    conversationKey: key, otherUserId: 42, patientPublicRef: "ab12cd34",
    lastMessage: {
      id: `m-${key}`, fromUserId: 42, bodyPreview: "Bonjour",
      bodyPreviewTruncated: false, createdAt: new Date(at), isRead: false,
    },
    unreadCount: unread,
  })

  it("calls listThreads with poll trigger (coalesced audit)", async () => {
    mockedListThreads.mockResolvedValue([] as any)
    await unreadThreadsQuery.forCaller(1, CTX as any)
    expect(mockedListThreads).toHaveBeenCalledWith(1, CTX, 100, "poll")
  })

  it("keeps only threads with unreadCount > 0 and maps the shape", async () => {
    mockedListThreads.mockResolvedValue([
      thread("k1", 2, "2026-06-12T10:00:00Z"),
      thread("k2", 0, "2026-06-12T09:00:00Z"), // read → dropped
    ] as any)
    const out = await unreadThreadsQuery.forCaller(1, CTX as any)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      conversationKey: "k1", otherUserId: 42, patientPublicRef: "ab12cd34",
      preview: "Bonjour", previewTruncated: false, unreadCount: 2,
    })
  })

  it("caps the list at 5 threads", async () => {
    mockedListThreads.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => thread(`k${i}`, 1, "2026-06-12T10:00:00Z")) as any,
    )
    const out = await unreadThreadsQuery.forCaller(1, CTX as any)
    expect(out).toHaveLength(5)
  })
})
