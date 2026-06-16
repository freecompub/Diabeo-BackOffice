/**
 * Mode revue de consultation (`/patients/[id]/review`) — Server Component (US-2605).
 *
 * Revue structurée en étapes, **entièrement déterministe (sans IA)**, pour
 * analyser la situation d'un patient et décider en sécurité. Ouvre (ou reprend)
 * un `Encounter` du jour, charge le Résumé + les vues réutilisées du dossier,
 * et délègue le rendu (stepper) à `ReviewClient`.
 *
 * Sécurité (identique au dossier `/patients/[id]`) :
 *  - `canAccessPatient` (RBAC) ; refus → audit `accessDenied` + `notFound()`.
 *  - Garde consentement `patientShareConsent` (fail-closed) AVANT déchiffrement.
 *  - Aucune statistique clinique calculée frontend (projections serveur).
 *  - Décision thérapeutique (étape 5) = DOCTOR-only (gardée aussi côté route).
 */

import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import type { Role } from "@prisma/client"
import { patientShareConsent } from "@/lib/consent"
import { patientService } from "@/lib/services/patient.service"
import { analyticsService } from "@/lib/services/analytics.service"
import { glycemiaService } from "@/lib/services/glycemia.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { auditService } from "@/lib/services/audit.service"
import { encounterService } from "@/lib/services/encounter.service"
import { getPatientFlags } from "@/lib/services/doctor-dashboard.service"
import { recentPatientsService } from "@/lib/services/recent-patients.service"
import { canAccessPatient } from "@/lib/access-control"
import { REVIEW_PERIOD, REVIEW_PERIOD_DAYS } from "@/lib/review-constants"
import { resolveTargetRangeMgdl } from "../overview-targets"
import { buildGlycemiaView } from "../glycemia-view"
import { buildTreatmentView } from "../treatment-view"
import { ReviewClient, type ReviewData, type ReviewProposalItem } from "./ReviewClient"

// Cibles consensus ADA/EASD (identiques à la vue d'ensemble du dossier).
const CONSENSUS_TIR_TARGET_PCT = 70
const CONSENSUS_HYPO_MAX_PCT = 4
const CONSENSUS_CV_MAX_PCT = 36

function computeAge(birthday: Date | null | undefined, now: Date): number | null {
  if (!birthday) return null
  let age = now.getFullYear() - birthday.getFullYear()
  const m = now.getMonth() - birthday.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birthday.getDate())) age--
  return age >= 0 && age < 150 ? age : null
}

export default async function PatientReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const patientId = Number(id)
  if (!Number.isInteger(patientId) || patientId <= 0) notFound()

  const h = await headers()
  const userId = Number(h.get("x-user-id"))
  const role = h.get("x-user-role") as Role | null
  if (!userId || !Number.isInteger(userId) || !role) redirect("/login")

  const ctx = {
    ipAddress: (h.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || "unknown",
    userAgent: h.get("user-agent") || "unknown",
    requestId: h.get("x-request-id") || "rsc-patient-review",
  }

  // Garde d'accès (RBAC) — un VIEWER n'atteint jamais cette route (layout).
  const allowed = await canAccessPatient(userId, role, patientId)
  if (!allowed) {
    await auditService.accessDenied({
      userId, resource: "PATIENT", resourceId: String(patientId),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { patientId, surface: "patient-review-page" },
    })
    notFound()
  }

  // Garde consentement AVANT tout déchiffrement PII (fail-closed).
  const consent = await patientShareConsent(patientId)
  if (!consent.ok) {
    if (consent.status === 404) notFound()
    await auditService.accessDenied({
      userId, resource: "PATIENT", resourceId: String(patientId),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { patientId, surface: "patient-review-page", kind: "sharingDisabled" },
    })
    return <ReviewClient data={null} sharingDisabled />
  }

  // Ouvre / reprend la séance de revue du jour (audité ENCOUNTER) — porte le
  // brouillon de compte rendu s'il existe.
  const encounter = await encounterService.openOrResume(patientId, userId, role, ctx)

  // Profil patient (PII déchiffrée serveur) — audité READ PATIENT.
  const patient = await patientService.getById(patientId, userId, ctx)
  if (!patient) notFound()

  // US-2603 — enregistre la consultation (switcher « récemment vus »). Fail-soft.
  void recentPatientsService.recordView(userId, patientId).catch((e) => {
    console.error("[patient-review] recordView failed", e instanceof Error ? e.message : e)
  })

  const now = new Date()

  // Résumé glycémique (projection serveur) — ancrage version des données.
  const profile = await analyticsService.glycemicProfile(patientId, REVIEW_PERIOD, userId, ctx)

  const flags = await getPatientFlags(patientId).catch((e) => {
    console.error("[patient-review] getPatientFlags failed", e instanceof Error ? e.message : e)
    return null
  })

  // Glycémie 24h (mapping pur réutilisé du dossier).
  const from24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const [cgmEntries, latestRaw] = await Promise.all([
    glycemiaService.getCgmEntries(patientId, from24h, now, userId, ctx),
    glycemiaService.getLatestCgmFreshness(patientId, from24h, now, userId, ctx).catch((e) => {
      console.error("[patient-review] getLatestCgmFreshness failed", e instanceof Error ? e.message : e)
      return null
    }),
  ])
  const glycemiaView = buildGlycemiaView(cgmEntries, now, latestRaw)

  // Traitements (réglages insuline + traitements associés) — mapping pur réutilisé.
  const insulinSettings = await insulinTherapyService.getSettings(patientId, userId, ctx)
  const treatmentView = buildTreatmentView(insulinSettings, patient.treatments ?? [], patient.devices ?? [], now)

  // Étape 5 — propositions d'ajustement EN ATTENTE (scopées patient, audité).
  const pending = await adjustmentService.list(patientId, { status: "pending" }, userId, ctx)
  const proposals: ReviewProposalItem[] = pending.map((p) => ({
    id: p.id,
    parameterType: p.parameterType,
    currentValue: Number(p.currentValue),
    proposedValue: Number(p.proposedValue),
    changePercent: Number(p.changePercent),
    reason: p.reason,
    confidence: p.confidence,
    timeSlotStartHour: p.timeSlotStartHour ?? null,
    timeSlotEndHour: p.timeSlotEndHour ?? null,
    createdAt: p.createdAt.toISOString(),
  }))

  const { targetLowMgdl, targetHighMgdl } = resolveTargetRangeMgdl(
    patient.cgmObjectives,
    patient.pathology,
  )

  const fullName = `${patient.user.firstname ?? ""} ${patient.user.lastname ?? ""}`.trim()

  const data: ReviewData = {
    encounterId: encounter.id,
    draftReport: encounter.draftReport,
    canDecide: role === "DOCTOR" || role === "ADMIN",
    anchor: { periodDays: REVIEW_PERIOD_DAYS, dataAsOf: now.toISOString() },
    patient: {
      id: patient.id,
      name: fullName,
      age: computeAge(patient.user.birthday ?? null, now),
      sex: patient.user.sex ?? null,
      pathology: patient.pathology ?? null,
      diagYear: patient.medicalData?.yearDiag ?? null,
      referent: patient.referent?.pro?.name ?? null,
      flags: flags ?? { recentHypos: false, hypoCount: 0, silentMonitoring: false, silentDays: null, openUrgency: false },
    },
    objectives: {
      targetLowMgdl,
      targetHighMgdl,
      tirTargetPct: CONSENSUS_TIR_TARGET_PCT,
      hypoMaxPct: CONSENSUS_HYPO_MAX_PCT,
      cvMaxPct: CONSENSUS_CV_MAX_PCT,
    },
    stats:
      profile.readingCount > 0
        ? {
            avgGlucoseMgdl: profile.metrics.averageGlucoseMgdl,
            gmi: profile.metrics.gmi,
            cv: profile.metrics.coefficientOfVariation,
            tir: {
              veryLow: profile.tir.severeHypo,
              low: profile.tir.hypo,
              inRange: profile.tir.inRange,
              high: profile.tir.elevated,
              veryHigh: profile.tir.hyper,
            },
            readingCount: profile.readingCount,
            captureRate: profile.captureRate,
            insufficientCapture: profile.warning === "insufficientCgmCapture",
          }
        : null,
    glycemia: glycemiaView,
    treatment: treatmentView,
    proposals,
  }

  return <ReviewClient data={data} />
}
