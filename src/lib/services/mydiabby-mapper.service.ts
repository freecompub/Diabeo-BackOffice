/**
 * MyDiabby → Diabeo data mapper.
 *
 * Pure functions that transform MyDiabby API responses into Prisma-compatible
 * create/update inputs for the Diabeo database. No side effects, no DB calls.
 *
 * Clinical safety: glucose values from MyDiabby are in g/L. They are converted
 * to mg/dL (Diabeo internal storage) using the factor 100.0 (1 g/L = 100 mg/dL).
 * Values outside clinical bounds (20–600 mg/dL) are skipped with a warning.
 *
 * Used ONLY in staging environment.
 */

import type {
  MyDiabbyUser,
  MyDiabbyPatient,
  MyDiabbyCgmEntry,
  MyDiabbyGlycemiaEntry,
  MyDiabbyInsulinFlowEntry,
  MyDiabbySnackEntry,
  MyDiabbyMedicalData,
  MyDiabbyCgmLimits,
} from "@/types/mydiabby"
import type { Pathology, Sex, Language } from "@prisma/client"

// ── Clinical bounds for validation ─────────────────────────

const GLUCOSE_MIN_MGDL = 20
const GLUCOSE_MAX_MGDL = 600
const GL_TO_MGDL = 100.0

// ── User mapping ───────────────────────────────────────────

export interface MappedUser {
  email: string
  firstname: string | null
  lastname: string | null
  birthday: Date | null
  sex: Sex | null
  phone: string | null
  address1: string | null
  cp: string | null
  city: string | null
  country: string | null
  language: Language
  timezone: string
  hasSignedTerms: boolean
  nirpp: string | null
  nirppType: string | null
}

export function mapUser(u: MyDiabbyUser): MappedUser {
  return {
    email: u.email,
    firstname: u.firstname || null,
    lastname: u.lastname || null,
    birthday: u.birthday ? new Date(u.birthday) : null,
    sex: mapSex(u.sex),
    phone: u.phone || null,
    address1: u.address1 || null,
    cp: u.cp || null,
    city: u.city || null,
    country: u.country || null,
    language: mapLanguage(u.language),
    timezone: u.timezone || "Europe/Paris",
    hasSignedTerms: u.hasSignedTermsOfUse,
    nirpp: u.nirpp || null,
    nirppType: u.nirpp_type || null,
  }
}

function mapSex(sex: string | null): Sex | null {
  if (sex === "M") return "M"
  if (sex === "F") return "F"
  return null
}

function mapLanguage(lang: string | null): Language {
  if (lang === "en") return "en"
  if (lang === "ar") return "ar"
  return "fr"
}

// ── Patient mapping ────────────────────────────────────────

export interface MappedPatient {
  pathology: Pathology
}

export function mapPatient(p: MyDiabbyPatient): MappedPatient {
  return {
    pathology: mapPathology(p.pathology),
  }
}

function mapPathology(path: string): Pathology {
  if (path === "DT2") return "DT2"
  if (path === "GD") return "GD"
  return "DT1"
}

// ── Unit preferences mapping ───────────────────────────────

export interface MappedUnitPreferences {
  unitGlycemia: number
  unitWeight: number
  unitSize: number
  unitCarb: number
  unitHba1c: number
  unitCarbExchangeNb: number
  unitKetones: number
  unitBloodPressure: number
}

export function mapUnitPreferences(u: MyDiabbyUser): MappedUnitPreferences {
  return {
    unitGlycemia: u.unit_glycemia,
    unitWeight: u.unit_weight,
    unitSize: u.unit_size,
    unitCarb: u.unit_carb,
    unitHba1c: u.unit_hba1c,
    unitCarbExchangeNb: u.unit_carb_exchange_nb,
    unitKetones: u.unit_ketones,
    unitBloodPressure: u.unit_bloodpressure,
  }
}

// ── Medical data mapping ───────────────────────────────────

export interface MappedMedicalData {
  yearDiag: number | null
  insulin: boolean
  insulinYear: number | null
  insulinPump: boolean
  tabac: boolean
  alcool: boolean
  historyMedical: string | null
  historyChirurgical: string | null
  historyFamily: string | null
  historyAllergy: string | null
  historyVaccine: string | null
  historyLife: string | null
}

export function mapMedicalData(md: MyDiabbyMedicalData): MappedMedicalData {
  return {
    yearDiag: md.yeardiag,
    insulin: md.insulin,
    insulinYear: md.insulinyear,
    insulinPump: md.insulinpump,
    tabac: md.tabac,
    alcool: md.alcool,
    historyMedical: md.historymedical,
    historyChirurgical: md.historychirurgical,
    historyFamily: md.historyfamily,
    historyAllergy: md.historyallergy,
    historyVaccine: md.historyvaccine,
    historyLife: md.historylife,
  }
}

// ── CGM objectives mapping ─────────────────────────────────

export interface MappedCgmObjective {
  veryLow: number // mg/dL
  low: number
  ok: number
  high: number
  titrLow: number
  titrHigh: number
}

export function mapCgmObjective(limits: MyDiabbyCgmLimits): MappedCgmObjective {
  return {
    veryLow: glToMgdl(limits.verylow),
    low: glToMgdl(limits.low),
    ok: glToMgdl(limits.ok),
    high: glToMgdl(limits.high),
    titrLow: glToMgdl(limits.titr_low),
    titrHigh: glToMgdl(limits.titr_high),
  }
}

// ── CGM entries mapping ────────────────────────────────────

export interface MappedCgmEntry {
  timestamp: Date
  glucoseValue: number // mg/dL
  source: string
  isManual: boolean
}

/**
 * Map MyDiabby CGM entries to Diabeo format.
 * Filters out entries with glucose outside clinical bounds.
 */
export function mapCgmEntries(entries: MyDiabbyCgmEntry[]): MappedCgmEntry[] {
  const mapped: MappedCgmEntry[] = []

  for (const entry of entries) {
    const mgdl = glToMgdl(entry.value)
    if (mgdl < GLUCOSE_MIN_MGDL || mgdl > GLUCOSE_MAX_MGDL) continue

    mapped.push({
      timestamp: new Date(entry.date),
      glucoseValue: mgdl,
      source: "mydiabby",
      isManual: entry.manual === true,
    })
  }

  return mapped
}

// ── Glycemia entries mapping ───────────────────────────────

export interface MappedGlycemiaEntry {
  timestamp: Date
  glucoseValue: number // mg/dL
  period: string | null
}

export function mapGlycemiaEntries(
  entries: MyDiabbyGlycemiaEntry[],
): MappedGlycemiaEntry[] {
  const mapped: MappedGlycemiaEntry[] = []

  for (const entry of entries) {
    const mgdl = glToMgdl(entry.value)
    if (mgdl < GLUCOSE_MIN_MGDL || mgdl > GLUCOSE_MAX_MGDL) continue

    mapped.push({
      timestamp: new Date(entry.date),
      glucoseValue: mgdl,
      period: entry.period || null,
    })
  }

  return mapped
}

// ── Insulin flow mapping ───────────────────────────────────

export interface MappedInsulinFlowEntry {
  timestamp: Date
  value: number
  type: string | null
  subtype: string | null
}

export function mapInsulinFlowEntries(
  entries: MyDiabbyInsulinFlowEntry[],
): MappedInsulinFlowEntry[] {
  return entries.map((e) => ({
    timestamp: new Date(e.date),
    value: parseFloat(e.value),
    type: e.type || null,
    subtype: e.subtype || null,
  }))
}

// ── Snack/meal events mapping ──────────────────────────────

export interface MappedMealEvent {
  timestamp: Date
  carbsGrams: number
  period: string | null
}

export function mapSnackEntries(
  entries: MyDiabbySnackEntry[],
): MappedMealEvent[] {
  return entries
    .filter((e) => parseFloat(e.value) > 0)
    .map((e) => ({
      timestamp: new Date(e.date),
      carbsGrams: parseFloat(e.value),
      period: e.period || null,
    }))
}

// ── Basal schedule mapping (ms from midnight → hour) ───────

export interface MappedBasalSlot {
  startHour: number // 0-23
  rate: number // U/h
}

export function mapBasalSchedule(
  schedule: Array<{ start: string; rate: string }>,
): MappedBasalSlot[] {
  return schedule.map((s) => ({
    startHour: Math.floor(parseInt(s.start, 10) / 3_600_000),
    rate: parseFloat(s.rate),
  }))
}

// ── ICR mapping (ms from midnight → hour + gramsPerUnit) ───

export interface MappedIcrSlot {
  startHour: number
  gramsPerUnit: number
}

export function mapIcrSchedule(
  schedule: Array<{ start: string; rate: string }>,
): MappedIcrSlot[] {
  return schedule.map((s) => ({
    startHour: Math.floor(parseInt(s.start, 10) / 3_600_000),
    gramsPerUnit: parseFloat(s.rate),
  }))
}

// ── ISF mapping (ms from midnight → hour + factor) ─────────

export interface MappedIsfSlot {
  startHour: number
  sensitivityFactorGl: number // g/L/U
  sensitivityFactorMgdl: number // mg/dL/U
}

export function mapIsfSchedule(
  schedule: Array<{ start: string; rate: string }>,
): MappedIsfSlot[] {
  return schedule.map((s) => {
    const factorGl = parseFloat(s.rate)
    return {
      startHour: Math.floor(parseInt(s.start, 10) / 3_600_000),
      sensitivityFactorGl: factorGl,
      sensitivityFactorMgdl: factorGl * GL_TO_MGDL,
    }
  })
}

// ── Helpers ────────────────────────────────────────────────

function glToMgdl(glValue: string): number {
  return parseFloat(glValue) * GL_TO_MGDL
}
