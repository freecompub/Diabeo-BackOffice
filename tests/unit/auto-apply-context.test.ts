/**
 * US-2657 (slice C2a) — Assemblage du contexte d'auto-application (glycémie + cétones + anti-cliquet).
 * Comportement testé : fenêtre planchée à 14 j, union des cétones (2 sources) filtrée, anti-cliquet
 * scopé (heures depuis dernier + cumul %/7 j).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { buildEnvelopeContext } from "@/lib/insulin/auto-apply-context"

const NOW = new Date("2026-07-08T12:00:00.000Z")

describe("buildEnvelopeContext", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.cgmEntry.findMany.mockResolvedValue(
      Array.from({ length: 200 }, () => ({ valueGl: 1.2 })) as never,
    )
    prismaMock.glycemiaEntry.findMany.mockResolvedValue([{ ketones: 0.8 }, { ketones: 1.6 }] as never)
    prismaMock.diabetesEvent.findMany.mockResolvedValue([{ ketones: 2.1 }] as never)
    prismaMock.autoApplyEvent.findFirst.mockResolvedValue({
      appliedAt: new Date(NOW.getTime() - 10 * 3_600_000), // 10 h avant
    } as never)
    prismaMock.autoApplyEvent.findMany.mockResolvedValue([{ deltaPercent: 4 }, { deltaPercent: -3 }] as never)
  })

  it("plancher : windowDays 5 demandé → 14 j effectifs", async () => {
    const ctx = await buildEnvelopeContext(7, "insulinSensitivityFactor", "22-06", 1.5, NOW, 5)
    expect(ctx.glycemia.windowDays).toBe(14)
  })

  it("fenêtre plus large respectée (≥ 14)", async () => {
    const ctx = await buildEnvelopeContext(7, "insulinSensitivityFactor", "22-06", 1.5, NOW, 30)
    expect(ctx.glycemia.windowDays).toBe(30)
  })

  it("glucosesGl + capture assemblés ; cétones = union des 2 sources (finies)", async () => {
    const ctx = await buildEnvelopeContext(7, "insulinSensitivityFactor", "22-06", 1.5, NOW)
    expect(ctx.glycemia.glucosesGl).toHaveLength(200)
    expect(ctx.glycemia.glucosesGl[0]).toBe(1.2)
    expect(ctx.glycemia.capturePercent).toBeGreaterThan(0)
    expect(ctx.glycemia.recentKetonesMmol).toEqual([0.8, 1.6, 2.1]) // glycemia ∪ event
    expect(ctx.glycemia.ketoneModerateThreshold).toBe(1.5)
  })

  it("anti-cliquet : heures depuis dernier + cumul |Δ%| sur 7 j", async () => {
    const ctx = await buildEnvelopeContext(7, "insulinSensitivityFactor", "22-06", 1.5, NOW)
    expect(ctx.ratchet.hoursSinceLastAutoApply).toBeCloseTo(10, 5)
    expect(ctx.ratchet.cumulativeAbsPercentThisWeek).toBe(7) // |4| + |-3|
  })

  it("aucune auto-application antérieure → hoursSinceLastAutoApply null, cumul 0", async () => {
    prismaMock.autoApplyEvent.findFirst.mockResolvedValue(null as never)
    prismaMock.autoApplyEvent.findMany.mockResolvedValue([] as never)
    const ctx = await buildEnvelopeContext(7, "insulinSensitivityFactor", "22-06", 1.5, NOW)
    expect(ctx.ratchet.hoursSinceLastAutoApply).toBeNull()
    expect(ctx.ratchet.cumulativeAbsPercentThisWeek).toBe(0)
  })

  it("scoping : chaque requête est filtrée par patientId (+ plage physiologique CGM, + créneau anti-cliquet)", async () => {
    await buildEnvelopeContext(7, "insulinSensitivityFactor", "22-06", 1.5, NOW)
    // CGM : patientId + plage valueGl (gt 0, pas de plancher bas — inclut les hypos sévères) + fenêtre bornée.
    expect(prismaMock.cgmEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patientId: 7,
          valueGl: expect.objectContaining({ gt: expect.any(Number), lte: expect.any(Number) }),
          timestamp: expect.objectContaining({ gte: expect.any(Date), lte: NOW }),
        }),
      }),
    )
    // Cétones : patientId + non null + récence 48 h bornée, sur les 2 sources.
    expect(prismaMock.glycemiaEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ patientId: 7, ketones: { not: null }, createdAt: expect.objectContaining({ gte: expect.any(Date), lte: NOW }) }),
      }),
    )
    expect(prismaMock.diabetesEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ patientId: 7, ketones: { not: null }, eventDate: expect.objectContaining({ gte: expect.any(Date), lte: NOW }) }),
      }),
    )
    // Anti-cliquet : scopé (patient × paramètre × créneau) ; le cumul est borné sur 7 j.
    expect(prismaMock.autoApplyEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ patientId: 7, parameterType: "insulinSensitivityFactor", slotKey: "22-06" }) }),
    )
    expect(prismaMock.autoApplyEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ patientId: 7, parameterType: "insulinSensitivityFactor", slotKey: "22-06", appliedAt: expect.objectContaining({ gte: expect.any(Date), lte: NOW }) }),
      }),
    )
  })

  it("CGM vide → glucosesGl [] + capture 0 (données manquantes non masquées)", async () => {
    prismaMock.cgmEntry.findMany.mockResolvedValue([] as never)
    const ctx = await buildEnvelopeContext(7, "insulinSensitivityFactor", "22-06", 1.5, NOW)
    expect(ctx.glycemia.glucosesGl).toEqual([])
    expect(ctx.glycemia.capturePercent).toBe(0)
  })

  it("aucune cétone (2 sources vides) → recentKetonesMmol []", async () => {
    prismaMock.glycemiaEntry.findMany.mockResolvedValue([] as never)
    prismaMock.diabetesEvent.findMany.mockResolvedValue([] as never)
    const ctx = await buildEnvelopeContext(7, "insulinSensitivityFactor", "22-06", 1.5, NOW)
    expect(ctx.glycemia.recentKetonesMmol).toEqual([])
  })

  it("capillaire mg/dL-only → intégré à hypoGlucosesGl (COALESCE, fail-open corrigé)", async () => {
    // La requête capillaire (where.OR gl/mgdl) renvoie une hypo saisie en mg/dL SEUL (glycemiaGl null) ;
    // la requête cétones (where.ketones) reste vide. hypoGlucosesGl doit contenir 45 mg/dL ÷ 100 = 0,45.
    prismaMock.glycemiaEntry.findMany.mockImplementation((args: any) =>
      (args?.where?.OR
        ? Promise.resolve([{ glycemiaGl: null, glycemiaMgdl: 45 }])
        : Promise.resolve([])) as never,
    )
    const ctx = await buildEnvelopeContext(7, "insulinSensitivityFactor", "22-06", 1.5, NOW)
    expect(ctx.glycemia.hypoGlucosesGl).toContain(0.45)
    // C6b (glucosesGl) reste CGM-only : le capillaire n'y entre pas.
    expect(ctx.glycemia.glucosesGl.every((v) => v === 1.2)).toBe(true)
  })
})
