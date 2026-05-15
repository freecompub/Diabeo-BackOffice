/**
 * @module food-monitoring.service
 * @description Groupe 10 Batch E — Mirror V1 monitoring repas (4 US, ~16 SP).
 *
 *  - US-2248 Vue journal alimentaire patient — list `DiabetesEvent`
 *    avec eventType=insulinMeal + count `MealPhoto` 30j
 *  - US-2251 Suivi adhésion thérapeutique — score on-demand 0-100 :
 *    days-with-event / 30 (régularité) + bolus-coverage ratio
 *  - US-2253 Contextualisation glycémie-repas — pour chaque meal,
 *    moyenne glucose CGM ±2h
 *  - US-2260 Templates messagerie pathologie — **couvert par
 *    `MessageTemplate` existant** (US-2078, `/api/team/templates`).
 *    Filter par pathology = V2 follow-up (exige migration `pathology`
 *    column ; pour V1 le clinicien filtre par titre).
 *
 * NURSE+ avec `canAccessPatient` + `requireGdprConsent` au niveau route.
 *
 * ⚠️ V2 deferrals :
 *  - US-2250 workflow validation glucides FSM (nouvelle table)
 *  - US-2252 cron alerte non-saisie + idempotence (nouvelle table)
 *  - US-2260 pathology field sur MessageTemplate
 *  - Caching Redis (queries on-demand pour MVP, OK à <50 patients
 *    actifs ; à revoir au-delà)
 */

import { DiabetesEventType } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────

const FOOD_JOURNAL_WINDOW_DAYS = 30
const ADHERENCE_WINDOW_DAYS = 30
const GLYCEMIA_CONTEXT_HOURS = 2
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

const FOOD_JOURNAL_LIMIT = 50
const GLYCEMIA_CONTEXT_LIMIT = 30
/** L1 (re-review) — defensive truncation on free-text `comment` exposed
 *  in API responses ; patient-authored content may carry incidental PHI. */
const COMMENT_MAX_LEN = 500
const CABINET_TIMEZONE = "Europe/Paris"

/** L2 (re-review) — defense-in-depth : every service query enforces
 *  `patient.deletedAt: null`. RBAC gate via `canAccessPatient` already
 *  filters at the route layer, but the service is publicly exported and
 *  reusable from crons / background workers / future GraphQL resolvers. */
const NON_DELETED_PATIENT = { patient: { deletedAt: null } } as const

// ─────────────────────────────────────────────────────────────
// US-2248 — Journal alimentaire patient
// ─────────────────────────────────────────────────────────────

export type FoodJournalEntry = {
  id: string
  eventDate: Date
  carbohydrates: number | null
  bolusDose: number | null
  /** Number of attached photos. UI uses for "X photos" badge. */
  photoCount: number
  /** Free-form comment from patient (NOT encrypted ; raw `comment` column). */
  comment: string | null
  validatedAt: Date | null
}

export const foodJournalQuery = {
  async forPatient(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<FoodJournalEntry[]> {
    const since = new Date(Date.now() - FOOD_JOURNAL_WINDOW_DAYS * DAY_MS)
    const rows = await prisma.diabetesEvent.findMany({
      where: {
        patientId,
        ...NON_DELETED_PATIENT,
        // `eventTypes` is `DiabetesEventType[]` ; the `has` operator on
        // Prisma array fields lets us filter "contains insulinMeal".
        eventTypes: { has: DiabetesEventType.insulinMeal },
        eventDate: { gte: since },
      },
      select: {
        id: true,
        eventDate: true,
        carbohydrates: true,
        bolusDose: true,
        // L1 (re-review) — SECURITY : never log this field outside the
        //   audited READ. Patient-authored free text, may contain PHI.
        comment: true,
        validatedAt: true,
        _count: { select: { mealPhotos: true } },
      },
      orderBy: { eventDate: "desc" },
      take: FOOD_JOURNAL_LIMIT,
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "DIABETES_EVENT",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "food.journal", count: rows.length },
    })

    return rows.map((r) => ({
      id: r.id,
      eventDate: r.eventDate,
      carbohydrates: r.carbohydrates?.toNumber() ?? null,
      bolusDose: r.bolusDose?.toNumber() ?? null,
      photoCount: r._count.mealPhotos,
      // L1 (re-review) — defensive truncation against accidental
      //   exfiltration via oversized response payload.
      comment: r.comment ? r.comment.slice(0, COMMENT_MAX_LEN) : null,
      validatedAt: r.validatedAt,
    }))
  },
}

// ─────────────────────────────────────────────────────────────
// US-2251 — Suivi adhésion thérapeutique
// ─────────────────────────────────────────────────────────────

export type AdherenceSnapshot = {
  /** Days in window with at least one DiabetesEvent. */
  daysWithEntry: number
  /** Window size in days. */
  windowDays: number
  /** % days with entry (rounded 1 decimal). */
  regularityPercent: number
  /** Number of meal events with a bolus dose recorded. */
  mealsWithBolus: number
  /** Total meal events in window. */
  totalMeals: number
  /** % meals covered by a bolus (rounded 1 decimal) ; null if no meals. */
  bolusCoveragePercent: number | null
  /**
   * Composite adherence score 0-100. Default weighting:
   *  - 0.6 × regularity + 0.4 × bolusCoverage
   *
   * Fallback (no meals in window) : score = regularity only.
   *
   * ⚠️ L3 (re-review) — clinical ambiguity : a DT1 patient logging 30j de
   * glucose-only events sans repas du tout score 100% (régularité parfaite)
   * mais n'est PAS adhérent au protocole alimentaire. The UI MUST surface
   * `totalMeals === 0` so a clinician can disambiguate ("Score 100 basé
   * sur la régularité de saisie seule, aucun repas évalué"). The 0.6/0.4
   * weighting is a heuristic ; medical-domain-validator review pending
   * pre-MVP go-live.
   */
  score: number
}

export const adherenceQuery = {
  async forPatient(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<AdherenceSnapshot> {
    const since = new Date(Date.now() - ADHERENCE_WINDOW_DAYS * DAY_MS)
    // Fetch all event dates (light projection) for distinct-day counting +
    // count meal/bolus pairs in parallel.
    const [eventDates, totalMeals, mealsWithBolus] = await Promise.all([
      prisma.diabetesEvent.findMany({
        where: { patientId, ...NON_DELETED_PATIENT, eventDate: { gte: since } },
        select: { eventDate: true },
      }),
      prisma.diabetesEvent.count({
        where: {
          patientId,
          ...NON_DELETED_PATIENT,
          eventDate: { gte: since },
          eventTypes: { has: DiabetesEventType.insulinMeal },
        },
      }),
      prisma.diabetesEvent.count({
        where: {
          patientId,
          ...NON_DELETED_PATIENT,
          eventDate: { gte: since },
          eventTypes: { has: DiabetesEventType.insulinMeal },
          bolusDose: { not: null },
        },
      }),
    ])
    // code-review M1 (re-review) — bucket distinct days on `Europe/Paris`
    //   wall-clock instead of UTC. A meal at 00:30 Paris (= 22:30 UTC
    //   previous day) was wrongly attributed to the previous UTC day,
    //   skewing the regularity metric.
    const parisDayFmt = new Intl.DateTimeFormat("fr-CA", {
      timeZone: CABINET_TIMEZONE,
      year: "numeric", month: "2-digit", day: "2-digit",
    })
    const distinctDays = new Set(
      eventDates.map((e) => parisDayFmt.format(e.eventDate)),
    )
    const daysWithEntry = distinctDays.size
    const regularityPercent = Math.round((daysWithEntry / ADHERENCE_WINDOW_DAYS) * 1000) / 10
    const bolusCoveragePercent = totalMeals > 0
      ? Math.round((mealsWithBolus / totalMeals) * 1000) / 10
      : null
    // Score weighted : 60% regularity, 40% bolus coverage (or 100% reg if
    // no meals to assess coverage).
    const score = bolusCoveragePercent === null
      ? Math.round(regularityPercent)
      : Math.round(0.6 * regularityPercent + 0.4 * bolusCoveragePercent)

    // L8 (re-review) — unify `resource` on DIABETES_EVENT across all 3
    //   queries so forensic "reads of patient X's events" returns all 3
    //   endpoints (was `PATIENT` here, inconsistent with the other two).
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "DIABETES_EVENT",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "food.adherence" },
    })

    return {
      daysWithEntry,
      windowDays: ADHERENCE_WINDOW_DAYS,
      regularityPercent,
      mealsWithBolus,
      totalMeals,
      bolusCoveragePercent,
      score,
    }
  },
}

// ─────────────────────────────────────────────────────────────
// US-2253 — Contextualisation glycémie-repas
// ─────────────────────────────────────────────────────────────

export type GlycemiaMealContextEntry = {
  mealId: string
  eventDate: Date
  carbohydrates: number | null
  bolusDose: number | null
  /** Avg CGM 2h before meal (g/L), null if no readings. */
  preMealAvgGl: number | null
  /** Avg CGM 2h after meal (g/L), null if no readings. */
  postMealAvgGl: number | null
  /** Pre-meal sample count (transparency for thin CGM coverage). */
  preMealSamples: number
  /** Post-meal sample count. */
  postMealSamples: number
}

export const glycemiaMealContextQuery = {
  /**
   * For each of the most recent ≤ GLYCEMIA_CONTEXT_LIMIT meals (last 30d),
   * compute avg glucose in the ±2h window. Done in a single batched query
   * by fetching all CGM entries in the meals' overall span and bucketing
   * in-memory.
   */
  async forPatient(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<GlycemiaMealContextEntry[]> {
    const since = new Date(Date.now() - FOOD_JOURNAL_WINDOW_DAYS * DAY_MS)
    const meals = await prisma.diabetesEvent.findMany({
      where: {
        patientId,
        ...NON_DELETED_PATIENT,
        eventTypes: { has: DiabetesEventType.insulinMeal },
        eventDate: { gte: since },
      },
      select: {
        id: true, eventDate: true,
        carbohydrates: true, bolusDose: true,
      },
      orderBy: { eventDate: "desc" },
      take: GLYCEMIA_CONTEXT_LIMIT,
    })
    if (meals.length === 0) {
      await auditService.log({
        userId: auditUserId, action: "READ", resource: "DIABETES_EVENT",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, kind: "food.glycemiaContext", count: 0 },
      })
      return []
    }

    // Compute the overall CGM scan window : earliest meal − 2h, latest + 2h.
    const earliest = meals.reduce(
      (acc, m) => m.eventDate.getTime() < acc ? m.eventDate.getTime() : acc,
      meals[0]!.eventDate.getTime(),
    )
    const latest = meals.reduce(
      (acc, m) => m.eventDate.getTime() > acc ? m.eventDate.getTime() : acc,
      meals[0]!.eventDate.getTime(),
    )
    const cgmFrom = new Date(earliest - GLYCEMIA_CONTEXT_HOURS * HOUR_MS)
    const cgmTo = new Date(latest + GLYCEMIA_CONTEXT_HOURS * HOUR_MS)
    const cgm = await prisma.cgmEntry.findMany({
      where: {
        patientId,
        ...NON_DELETED_PATIENT,
        timestamp: { gte: cgmFrom, lte: cgmTo },
      },
      select: { timestamp: true, valueGl: true },
    })

    // L4 (re-review) — V1+ perf : currently O(meals × cgm). For >50
    //   active patients consider binary search on sorted CGM or OR-of-N
    //   ranges in the query (Postgres handles 30-OR clauses well).
    // L5 (re-review) — a CGM reading exactly at meal time (`t === mealMs`)
    //   is excluded from both buckets (strict `< mealMs` and `> mealMs`).
    //   Edge case unlikely (CGM 1-5min granularity vs meal precision)
    //   ; document the deterministic choice so it's not surprising.
    const ctxHoursMs = GLYCEMIA_CONTEXT_HOURS * HOUR_MS
    const out: GlycemiaMealContextEntry[] = meals.map((m) => {
      const mealMs = m.eventDate.getTime()
      let preSum = 0, preCount = 0
      let postSum = 0, postCount = 0
      for (const c of cgm) {
        const t = c.timestamp.getTime()
        if (t >= mealMs - ctxHoursMs && t < mealMs) {
          preSum += c.valueGl.toNumber()
          preCount++
        } else if (t > mealMs && t <= mealMs + ctxHoursMs) {
          postSum += c.valueGl.toNumber()
          postCount++
        }
      }
      return {
        mealId: m.id,
        eventDate: m.eventDate,
        carbohydrates: m.carbohydrates?.toNumber() ?? null,
        bolusDose: m.bolusDose?.toNumber() ?? null,
        preMealAvgGl: preCount > 0
          ? Math.round((preSum / preCount) * 100) / 100
          : null,
        postMealAvgGl: postCount > 0
          ? Math.round((postSum / postCount) * 100) / 100
          : null,
        preMealSamples: preCount,
        postMealSamples: postCount,
      }
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "DIABETES_EVENT",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "food.glycemiaContext", count: out.length },
    })

    return out
  },
}

