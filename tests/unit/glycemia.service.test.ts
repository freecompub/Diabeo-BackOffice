/**
 * Test suite: Glycemia Service — CGM and Punctual Glucose Data Access
 *
 * Clinical behavior tested:
 * - Retrieval of CGM entries (continuous glucose monitor readings) for a patient
 *   within a caller-specified date range, used to populate trend graphs and
 *   compute TIR statistics
 * - Enforcement of a 30-day maximum window per request to prevent excessive
 *   data loads that could degrade performance for the partitioned CgmEntry table
 * - Access to punctual glycemia measurements (capillary finger-stick readings)
 *   alongside CGM data to give a complete glucose picture
 * - Every data-read operation produces an audit log entry recording the
 *   requesting user, patient ID, and time window queried
 *
 * Associated risks:
 * - A missing date-range guard allowing unbounded queries could trigger a full
 *   partition scan on the CGM table, causing denial-of-service for other users
 * - Returning CGM entries for a patient the requesting user is not authorized
 *   to access would constitute a cross-patient data breach
 * - A missing audit log on CGM reads would break HDS traceability requirements
 *   for access to sensitive health data
 *
 * Edge cases:
 * - Date range of exactly 30 days (boundary — must be accepted)
 * - Date range of 30 days + 1 second (must be rejected with a clear error)
 * - Patient with no CGM entries in the requested window (must return empty array)
 * - from > to (invalid range — must be rejected)
 * - BigInt primary keys on CgmEntry serialized correctly in the response
 */
import { describe, it, expect } from "vitest"
import { Prisma } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"

import { glycemiaService } from "@/lib/services/glycemia.service"

describe("glycemiaService", () => {
  describe("getCgmEntries", () => {
    it("returns CGM entries within date range", async () => {
      // Mock data must include createdAt: the service now serialises the
      // entry to a DTO (BigInt → string, Decimal → number, Date → ISO).
      const entries = [{
        id: BigInt(1),
        patientId: 1,
        // Vraie Decimal Prisma (g/L, 2 décimales) pour exercer le chemin
        // Decimal → number et VÉRIFIER qu'aucune précision n'est perdue.
        valueGl: new Prisma.Decimal("1.26"),
        timestamp: new Date(),
        isManual: false,
        deviceId: null,
        createdAt: new Date(),
      }]
      prismaMock.cgmEntry.findMany.mockResolvedValue(entries as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const from = new Date("2026-03-01")
      const to = new Date("2026-03-15")
      const result = await glycemiaService.getCgmEntries(1, from, to, 1)

      expect(result).toHaveLength(1)
      // BigInt → string + Decimal → number — JSON-safe contract.
      expect(typeof result[0].id).toBe("string")
      expect(result[0].id).toBe("1")
      expect(typeof result[0].valueGl).toBe("number")
      // Intégrité clinique : la glycémie n'est ni tronquée ni arrondie.
      expect(result[0].valueGl).toBe(1.26)
    })

    it("audits READ CGM_ENTRY with the metadata.patientId pivot (ADR #18)", async () => {
      prismaMock.cgmEntry.findMany.mockResolvedValue([] as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)
      await glycemiaService.getCgmEntries(42, new Date("2026-03-01"), new Date("2026-03-10"), 1)
      const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
      expect(audit.resource).toBe("CGM_ENTRY")
      expect(audit.metadata.patientId).toBe(42)
    })

    it("throws when period exceeds 30 days", async () => {
      const from = new Date("2026-01-01")
      const to = new Date("2026-03-01")

      await expect(glycemiaService.getCgmEntries(1, from, to, 1))
        .rejects.toThrow("Period cannot exceed 30 days")
    })

    it("throws when from > to", async () => {
      const from = new Date("2026-03-15")
      const to = new Date("2026-03-01")

      await expect(glycemiaService.getCgmEntries(1, from, to, 1))
        .rejects.toThrow("'from' must be before 'to'")
    })
  })

  describe("getLatestCgmFreshness", () => {
    const from = new Date("2026-03-01")
    const to = new Date("2026-03-10")

    it("classifies a below-floor most-recent raw reading + counts out-of-range (severe hypo / sensor LOW)", async () => {
      prismaMock.cgmEntry.findFirst.mockResolvedValue({
        timestamp: new Date("2026-03-10T08:00:00.000Z"),
        valueGl: new Prisma.Decimal("0.35"), // 35 mg/dL < plancher 0.40
      } as any)
      // belowFloorCount=2 puis aboveCeilingCount=0 (ordre des count dans Promise.all).
      prismaMock.cgmEntry.count.mockResolvedValueOnce(2 as any).mockResolvedValueOnce(0 as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const r = await glycemiaService.getLatestCgmFreshness(1, from, to, 1)
      expect(r).toEqual({
        timestamp: "2026-03-10T08:00:00.000Z",
        belowFloor: true,
        aboveCeiling: false,
        belowFloorCount: 2,
        aboveCeilingCount: 0,
      })
    })

    it("returns null when there is no reading in the window", async () => {
      prismaMock.cgmEntry.findFirst.mockResolvedValue(null)
      prismaMock.cgmEntry.count.mockResolvedValue(0 as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)
      expect(await glycemiaService.getLatestCgmFreshness(1, from, to, 1)).toBeNull()
    })

    it("fail-closed: a null valueGl (impossible today, NOT NULL col) is treated as below floor", async () => {
      prismaMock.cgmEntry.findFirst.mockResolvedValue({
        timestamp: new Date("2026-03-10T07:00:00.000Z"),
        valueGl: null,
      } as any)
      prismaMock.cgmEntry.count.mockResolvedValue(0 as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)
      const r = await glycemiaService.getLatestCgmFreshness(1, from, to, 1)
      expect(r).toEqual({
        timestamp: "2026-03-10T07:00:00.000Z",
        belowFloor: true, aboveCeiling: false,
        belowFloorCount: 0, aboveCeilingCount: 0,
      })
    })

    it("does not classify an in-range most-recent reading; surfaces out-of-range counts", async () => {
      prismaMock.cgmEntry.findFirst.mockResolvedValue({
        timestamp: new Date("2026-03-10T09:00:00.000Z"),
        valueGl: new Prisma.Decimal("1.20"),
      } as any)
      // 1 relevé sous plancher + 1 au-dessus plafond ailleurs dans la fenêtre.
      prismaMock.cgmEntry.count.mockResolvedValueOnce(1 as any).mockResolvedValueOnce(1 as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)
      const r = await glycemiaService.getLatestCgmFreshness(1, from, to, 1)
      expect(r).toEqual({
        timestamp: "2026-03-10T09:00:00.000Z",
        belowFloor: false, aboveCeiling: false,
        belowFloorCount: 1, aboveCeilingCount: 1,
      })
    })

    it("audits READ CGM_ENTRY with the patientId pivot + freshness purpose", async () => {
      prismaMock.cgmEntry.findFirst.mockResolvedValue(null)
      prismaMock.cgmEntry.count.mockResolvedValue(0 as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)
      await glycemiaService.getLatestCgmFreshness(42, from, to, 1)
      const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
      expect(audit.resource).toBe("CGM_ENTRY")
      expect(audit.metadata.patientId).toBe(42)
      expect(audit.metadata.purpose).toBe("cgm-freshness-signal")
    })

    it("enforces the 30-day max period", async () => {
      await expect(
        glycemiaService.getLatestCgmFreshness(1, new Date("2026-01-01"), new Date("2026-03-01"), 1),
      ).rejects.toThrow("Period cannot exceed 30 days")
    })
  })

  describe("getGlycemiaEntries", () => {
    it("returns glycemia entries", async () => {
      prismaMock.glycemiaEntry.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await glycemiaService.getGlycemiaEntries(
        1, new Date("2026-03-01"), new Date("2026-03-15"), 1,
      )
      expect(result).toEqual([])
    })
  })

  describe("getAverageData", () => {
    it("groups averages by period type", async () => {
      // Prisma enum with @map: TS-side values are `current`, `d7`, `d30`;
      // the @map target (`7d`/`30d`) is only the DB column content.
      // Mocks include updatedAt: the service now serialises Date → ISO string.
      prismaMock.averageData.findMany.mockResolvedValue([
        { id: 1, patientId: 1, periodType: "current", mealType: "breakfast", glycemia: null, color: null, glycemia1h: null, color1h: null, updatedAt: new Date() },
        { id: 2, patientId: 1, periodType: "d7", mealType: "breakfast", glycemia: null, color: null, glycemia1h: null, color1h: null, updatedAt: new Date() },
      ] as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await glycemiaService.getAverageData(1, 1)
      expect(result.current).toHaveLength(1)
      expect(result.avg7d).toHaveLength(1)
      expect(result.avg30d).toHaveLength(0)
    })
  })

  describe("getInsulinFlow", () => {
    it("returns insulin flow entries", async () => {
      prismaMock.insulinFlowEntry.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await glycemiaService.getInsulinFlow(
        1, new Date("2026-03-01"), new Date("2026-03-15"), 1,
      )
      expect(result).toEqual([])
    })
  })

  describe("getPumpEvents", () => {
    it("returns pump events with optional type filter", async () => {
      prismaMock.pumpEvent.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await glycemiaService.getPumpEvents(
        1, new Date("2026-03-01"), new Date("2026-03-15"), 1, undefined, "alarm",
      )
      expect(result).toEqual([])
    })
  })

  // ─── US-2631 socle BGM — dernier HbA1c labo ──────────────────────────────
  describe("getLastHba1c", () => {
    it("returns the most recent non-null HbA1c with its date, audited", async () => {
      prismaMock.glycemiaEntry.findFirst.mockResolvedValue({
        hba1c: new Prisma.Decimal("7.10"),
        date: new Date("2026-06-02T00:00:00Z"),
      } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const r = await glycemiaService.getLastHba1c(1, 1)
      expect(r).toEqual({ value: 7.1, date: "2026-06-02T00:00:00.000Z" })
      const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
      expect(meta.resource).toBe("GLYCEMIA_ENTRY")
      expect(meta.metadata.kind).toBe("lastHba1c")
    })

    it("returns null when no HbA1c recorded", async () => {
      prismaMock.glycemiaEntry.findFirst.mockResolvedValue(null as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)
      expect(await glycemiaService.getLastHba1c(1, 1)).toBeNull()
    })

    it("skips audit when skipAudit is set", async () => {
      prismaMock.glycemiaEntry.findFirst.mockResolvedValue(null as any)
      prismaMock.auditLog.create.mockClear()
      await glycemiaService.getLastHba1c(1, 1, undefined, { skipAudit: true })
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
    })
  })
})
