/**
 * Tests — US-2638 : détection CGM/BGM dans `buildPatientRecordData`.
 *
 * Garde clinique AC-1 (fail-closed) : un patient SANS capteur (BGM) ne reçoit
 * JAMAIS d'indicateur CGM-only (TIR-temps, GMI). `dataSource="bgm"`, `stats=null`,
 * bloc `bgm` peuplé (% en cible ≠ TIR, HbA1c labo ≠ GMI). Et le cas CGM inverse.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { patientHasCgm, glycemicProfile, bgmStats, getLastHba1c } = vi.hoisted(() => ({
  patientHasCgm: vi.fn(),
  glycemicProfile: vi.fn(),
  bgmStats: vi.fn(),
  getLastHba1c: vi.fn(),
}))

vi.mock("@/lib/services/cgm-status.service", () => ({ cgmStatusService: { patientHasCgm } }))
vi.mock("@/lib/services/analytics.service", () => ({ analyticsService: { glycemicProfile, bgmStats } }))
vi.mock("@/lib/services/glycemia.service", () => ({
  glycemiaService: {
    getLastHba1c,
    getCgmEntries: vi.fn().mockResolvedValue([]),
    getLatestCgmFreshness: vi.fn().mockResolvedValue(null),
  },
}))
vi.mock("@/lib/services/patient.service", () => ({
  patientService: {
    getById: vi.fn().mockResolvedValue({
      id: 42,
      publicRef: "ref-42",
      pathology: "DT1",
      user: { firstname: "Jean", lastname: "Dupont", birthday: new Date("1990-01-01"), sex: "M" },
      medicalData: { yearDiag: 2015 },
      referent: { pro: { name: "Dr House" } },
      cgmObjectives: null,
      treatments: [],
      devices: [],
    }),
  },
}))
vi.mock("@/lib/services/insulin-therapy.service", () => ({
  insulinTherapyService: { getSettings: vi.fn().mockResolvedValue(null) },
}))
vi.mock("@/lib/services/document.service", () => ({ documentService: { list: vi.fn().mockResolvedValue([]) } }))
vi.mock("@/lib/services/doctor-dashboard.service", () => ({ getPatientFlags: vi.fn().mockResolvedValue(null) }))

import { buildPatientRecordData } from "@/app/(dashboard)/patients/[id]/build-patient-record"

const CTX = { ipAddress: "i", userAgent: "u", requestId: "r" }

describe("buildPatientRecordData — CGM/BGM detection (US-2638)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("BGM patient: dataSource='bgm', stats=null (no TIR/GMI), bgm block populated — AC-1 fail-closed", async () => {
    patientHasCgm.mockResolvedValue(false)
    bgmStats.mockResolvedValue({
      period: { days: 14 }, total: 40, avgMgdl: 158, inRangePercent: 62.5,
      readingsPerDay: 2.9, targetRangeMgdl: { low: 70, high: 180 },
      points: [{ timeMinutes: 480, mgdl: 120 }],
    })
    getLastHba1c.mockResolvedValue({ value: 7.4, date: "2026-05-01T00:00:00.000Z", ageDays: 60, stale: false })

    const data = (await buildPatientRecordData(42, "DOCTOR" as never, 1, CTX))!
    expect(data.dataSource).toBe("bgm")
    expect(data.stats).toBeNull() // AC-1 : aucun TIR-temps/GMI en BGM
    expect(data.bgm).toMatchObject({ avgMgdl: 158, inRangePercent: 62.5, readingsPerDay: 2.9 })
    expect(data.bgm?.hba1c?.value).toBe(7.4) // HbA1c labo, pas un GMI
    // Aucun GMI/eA1c nulle part dans le DTO BGM (AC-3).
    expect(JSON.stringify(data)).not.toMatch(/"gmi"/)
    expect(glycemicProfile).not.toHaveBeenCalled() // pas de lecture CGM en BGM
    expect(bgmStats).toHaveBeenCalledWith(42, "14d", 1, CTX)
  })

  it("CGM patient: dataSource='cgm', stats populated, bgm=null", async () => {
    patientHasCgm.mockResolvedValue(true)
    glycemicProfile.mockResolvedValue({
      readingCount: 1200, captureRate: 92, warning: null,
      metrics: { averageGlucoseMgdl: 158, gmi: 7.1, coefficientOfVariation: 34 },
      tir: { severeHypo: 1, hypo: 3, inRange: 75, elevated: 17, hyper: 4 },
    })

    const data = (await buildPatientRecordData(42, "DOCTOR" as never, 1, CTX))!
    expect(data.dataSource).toBe("cgm")
    expect(data.bgm).toBeNull()
    expect(data.stats?.gmi).toBe(7.1)
    expect(data.stats?.tir.inRange).toBe(75)
    expect(bgmStats).not.toHaveBeenCalled()
    expect(getLastHba1c).not.toHaveBeenCalled()
  })
})
