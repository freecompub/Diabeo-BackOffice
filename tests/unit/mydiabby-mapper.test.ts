/**
 * Tests for MyDiabby → Diabeo data mapper.
 *
 * Clinical safety context: glucose values from MyDiabby are in g/L and must
 * be converted to mg/dL. Values outside clinical bounds (20-600 mg/dL) must
 * be filtered out to prevent corrupted data from entering the system.
 *
 * Basal schedules from MyDiabby use milliseconds from midnight and must be
 * converted to hours (0-23) for Diabeo's slot-based system.
 */

import { describe, it, expect } from "vitest"
import {
  mapUser,
  mapPatient,
  mapCgmEntries,
  mapGlycemiaEntries,
  mapInsulinFlowEntries,
  mapSnackEntries,
  mapBasalSchedule,
  mapIcrSchedule,
  mapIsfSchedule,
  mapMedicalData,
  mapUnitPreferences,
  mapCgmObjective,
} from "@/lib/services/mydiabby-mapper.service"
import type {
  MyDiabbyUser,
  MyDiabbyPatient,
  MyDiabbyCgmEntry,
  MyDiabbyMedicalData,
} from "@/types/mydiabby"

describe("MyDiabby mapper", () => {
  describe("mapUser", () => {
    it("maps basic user fields", () => {
      const user = {
        email: "test@example.com",
        firstname: "Jean",
        lastname: "Dupont",
        birthday: "1990-05-15",
        sex: "M",
        phone: "0612345678",
        country: "FR",
        language: "fr",
        timezone: "Europe/Paris",
        hasSignedTermsOfUse: true,
        nirpp: null,
        nirpp_type: null,
      } as unknown as MyDiabbyUser

      const result = mapUser(user)

      expect(result.email).toBe("test@example.com")
      expect(result.firstname).toBe("Jean")
      expect(result.lastname).toBe("Dupont")
      expect(result.birthday).toEqual(new Date("1990-05-15"))
      expect(result.sex).toBe("M")
      expect(result.language).toBe("fr")
    })

    it("handles null/missing fields gracefully", () => {
      const user = {
        email: "test@example.com",
        firstname: "",
        lastname: null,
        birthday: null,
        sex: null,
        phone: null,
        language: null,
        timezone: null,
      } as unknown as MyDiabbyUser

      const result = mapUser(user)

      expect(result.firstname).toBeNull()
      expect(result.birthday).toBeNull()
      expect(result.sex).toBeNull()
      expect(result.language).toBe("fr") // default
      expect(result.timezone).toBe("Europe/Paris") // default
    })
  })

  describe("mapPatient", () => {
    it("maps pathology DT1", () => {
      const patient = { pathology: "DT1" } as MyDiabbyPatient
      expect(mapPatient(patient).pathology).toBe("DT1")
    })

    it("maps pathology DT2", () => {
      const patient = { pathology: "DT2" } as MyDiabbyPatient
      expect(mapPatient(patient).pathology).toBe("DT2")
    })

    it("maps pathology GD", () => {
      const patient = { pathology: "GD" } as MyDiabbyPatient
      expect(mapPatient(patient).pathology).toBe("GD")
    })

    it("defaults to DT1 for unknown pathology", () => {
      const patient = { pathology: "UNKNOWN" } as unknown as MyDiabbyPatient
      expect(mapPatient(patient).pathology).toBe("DT1")
    })
  })

  describe("mapCgmEntries", () => {
    it("converts g/L to mg/dL", () => {
      const entries: MyDiabbyCgmEntry[] = [
        { date: "2024-12-05T10:00:00+01:00", value: "1.20" },
      ]

      const result = mapCgmEntries(entries)

      expect(result).toHaveLength(1)
      expect(result[0].glucoseValue).toBe(120)
      expect(result[0].source).toBe("mydiabby")
    })

    it("filters out values below clinical minimum (20 mg/dL)", () => {
      const entries: MyDiabbyCgmEntry[] = [
        { date: "2024-12-05T10:00:00+01:00", value: "0.10" }, // 10 mg/dL
      ]

      const result = mapCgmEntries(entries)

      expect(result).toHaveLength(0)
    })

    it("filters out values above clinical maximum (600 mg/dL)", () => {
      const entries: MyDiabbyCgmEntry[] = [
        { date: "2024-12-05T10:00:00+01:00", value: "6.50" }, // 650 mg/dL
      ]

      const result = mapCgmEntries(entries)

      expect(result).toHaveLength(0)
    })

    it("preserves manual flag", () => {
      const entries: MyDiabbyCgmEntry[] = [
        { date: "2024-12-05T10:00:00+01:00", value: "1.50", manual: true },
      ]

      const result = mapCgmEntries(entries)

      expect(result[0].isManual).toBe(true)
    })

    it("filters out NaN values from corrupted data (M1 clinical safety)", () => {
      const entries: MyDiabbyCgmEntry[] = [
        { date: "2024-12-05T10:00:00+01:00", value: "N/A" },
        { date: "2024-12-05T10:05:00+01:00", value: "" },
        { date: "2024-12-05T10:10:00+01:00", value: "abc" },
        { date: "2024-12-05T10:15:00+01:00", value: "1.20" }, // valid
      ]

      const result = mapCgmEntries(entries)

      expect(result).toHaveLength(1)
      expect(result[0].glucoseValue).toBe(120)
    })

    it("handles large batches", () => {
      const entries: MyDiabbyCgmEntry[] = Array.from({ length: 5000 }, (_, i) => ({
        date: `2024-12-05T${String(Math.floor(i / 60) % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00+01:00`,
        value: "1.20",
      }))

      const result = mapCgmEntries(entries)

      expect(result).toHaveLength(5000)
    })
  })

  describe("mapGlycemiaEntries", () => {
    it("converts g/L to mg/dL", () => {
      const entries = [
        { date: "2024-12-05T08:00:00+01:00", value: "0.95" },
      ]

      const result = mapGlycemiaEntries(entries)

      expect(result).toHaveLength(1)
      expect(result[0].glucoseValue).toBeCloseTo(95)
    })

    it("filters out NaN values", () => {
      const entries = [
        { date: "2024-12-05T08:00:00+01:00", value: "invalid" },
        { date: "2024-12-05T09:00:00+01:00", value: "1.10" },
      ]

      const result = mapGlycemiaEntries(entries)

      expect(result).toHaveLength(1)
    })

    it("filters values outside clinical bounds", () => {
      const entries = [
        { date: "2024-12-05T08:00:00+01:00", value: "0.05" }, // 5 mg/dL — too low
        { date: "2024-12-05T09:00:00+01:00", value: "7.00" }, // 700 mg/dL — too high
      ]

      const result = mapGlycemiaEntries(entries)

      expect(result).toHaveLength(0)
    })
  })

  describe("mapInsulinFlowEntries", () => {
    it("maps insulin flow entries", () => {
      const entries = [
        { date: "2024-12-05T12:00:00+01:00", value: "3.5", type: "bolus" },
      ]

      const result = mapInsulinFlowEntries(entries)

      expect(result).toHaveLength(1)
      expect(result[0].value).toBe(3.5)
      expect(result[0].type).toBe("bolus")
    })

    it("filters out NaN values", () => {
      const entries = [
        { date: "2024-12-05T12:00:00+01:00", value: "invalid" },
        { date: "2024-12-05T13:00:00+01:00", value: "2.0" },
      ]

      const result = mapInsulinFlowEntries(entries)

      expect(result).toHaveLength(1)
      expect(result[0].value).toBe(2.0)
    })
  })

  describe("mapBasalSchedule", () => {
    it("converts milliseconds from midnight to hours", () => {
      const schedule = [
        { start: "0", rate: "0.8" }, // 0h
        { start: "10800000", rate: "1.2" }, // 3h (3*3600*1000)
        { start: "43200000", rate: "0.9" }, // 12h
      ]

      const result = mapBasalSchedule(schedule)

      expect(result).toEqual([
        { startHour: 0, rate: 0.8 },
        { startHour: 3, rate: 1.2 },
        { startHour: 12, rate: 0.9 },
      ])
    })
  })

  describe("mapIcrSchedule", () => {
    it("converts ICR schedule from ms to hours", () => {
      const schedule = [
        { start: "0", rate: "1.666" },
        { start: "43200000", rate: "1.666" }, // 12h
        { start: "64800000", rate: "2.5" }, // 18h
      ]

      const result = mapIcrSchedule(schedule)

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ startHour: 0, gramsPerUnit: 1.666 })
      expect(result[2]).toEqual({ startHour: 18, gramsPerUnit: 2.5 })
    })
  })

  describe("mapIsfSchedule", () => {
    it("converts ISF and calculates mg/dL equivalent", () => {
      const schedule = [
        { start: "0", rate: "0.2" }, // 0.2 g/L/U = 20 mg/dL/U
      ]

      const result = mapIsfSchedule(schedule)

      expect(result).toHaveLength(1)
      expect(result[0].sensitivityFactorGl).toBe(0.2)
      expect(result[0].sensitivityFactorMgdl).toBeCloseTo(20.0)
    })
  })

  describe("mapCgmObjective", () => {
    it("converts CGM limits from g/L to mg/dL", () => {
      const limits = {
        verylow: "0.53",
        low: "0.69",
        ok: "1.80",
        high: "2.50",
        titr_low: "0.70",
        titr_high: "1.40",
      }

      const result = mapCgmObjective(limits)

      expect(result.veryLow).toBeCloseTo(53)
      expect(result.low).toBeCloseTo(69)
      expect(result.ok).toBeCloseTo(180)
      expect(result.high).toBeCloseTo(250)
    })
  })

  describe("mapMedicalData", () => {
    it("maps medical data fields", () => {
      const md: MyDiabbyMedicalData = {
        dt1: true,
        size: null,
        yeardiag: 2010,
        insulin: true,
        insulinyear: 2010,
        insulinpump: true,
        pathology: "DT1",
        diabetdiscovery: null,
        tabac: false,
        alcool: false,
        historymedical: "Asthme",
        historychirurgical: null,
        historyfamily: null,
        historyallergy: "Pénicilline",
        historyvaccine: null,
        historylife: null,
        risk_weight: false,
        risk_tension: false,
        risk_sedent: false,
        risk_cholesterol: false,
        risk_age: false,
        risk_heredit: false,
        risk_cardio: false,
        risk_hypothyroidism: false,
        risk_celiac: false,
        risk_other_autoimmune: null,
        vitale_attest: false,
      }

      const result = mapMedicalData(md)

      expect(result.yearDiag).toBe(2010)
      expect(result.insulin).toBe(true)
      expect(result.insulinPump).toBe(true)
      expect(result.historyMedical).toBe("Asthme")
      expect(result.historyAllergy).toBe("Pénicilline")
      expect(result.tabac).toBe(false)
    })
  })

  describe("mapUnitPreferences", () => {
    it("maps unit IDs from MyDiabby to Diabeo", () => {
      const user = {
        unit_glycemia: 3,
        unit_weight: 6,
        unit_size: 8,
        unit_carb: 2,
        unit_hba1c: 10,
        unit_carb_exchange_nb: 15,
        unit_ketones: 12,
        unit_bloodpressure: 14,
      } as unknown as MyDiabbyUser

      const result = mapUnitPreferences(user)

      expect(result.unitGlycemia).toBe(3)
      expect(result.unitWeight).toBe(6)
      expect(result.unitCarb).toBe(2)
    })
  })

  describe("mapSnackEntries", () => {
    it("maps snack entries to meal events", () => {
      const entries = [
        { date: "2024-12-05T12:30:00+01:00", value: "60" },
        { date: "2024-12-05T19:00:00+01:00", value: "45.5" },
      ]

      const result = mapSnackEntries(entries)

      expect(result).toHaveLength(2)
      expect(result[0].carbsGrams).toBe(60)
      expect(result[1].carbsGrams).toBe(45.5)
    })

    it("filters out zero carb entries", () => {
      const entries = [
        { date: "2024-12-05T12:30:00+01:00", value: "0" },
      ]

      const result = mapSnackEntries(entries)

      expect(result).toHaveLength(0)
    })
  })
})
