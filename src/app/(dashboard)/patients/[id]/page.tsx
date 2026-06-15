/**
 * Dossier patient (`/patients/[id]`) — Server Component.
 *
 * Câblage données réelles, Phase 1 (cf. docs/UserStory/Navigation/cablage-donnees-patient.md) :
 * profil + objectifs + stats glycémiques (TIR/GMI/CV/moyenne) RÉELS, scopés
 * serveur, PII déchiffrée serveur, accès audité (ADR #18). Les onglets Glycémie /
 * Traitements / Documents arrivent dans les phases suivantes (état « bientôt
 * disponible » en attendant — jamais de données démo).
 *
 * Sécurité :
 *  - `canAccessPatient` (RBAC : ADMIN / DOCTOR-NURSE via service / VIEWER self) ;
 *    accès refusé → `notFound()` (404 uniforme, anti-énumération).
 *  - Aucune statistique clinique calculée côté frontend : tout vient des
 *    projections serveur (`analyticsService.glycemicProfile`).
 */

import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import type { Role } from "@prisma/client"
import { patientService } from "@/lib/services/patient.service"
import { analyticsService } from "@/lib/services/analytics.service"
import { canAccessPatient } from "@/lib/access-control"
import { GLYCEMIA_THRESHOLDS_MGDL } from "@/lib/glycemia-thresholds"
import { PatientDetailClient, type PatientDetailData } from "./PatientDetailClient"

// Période d'agrégation de la vue d'ensemble (jours). Bornée < 90j (analytics).
const OVERVIEW_PERIOD = "14d"
// Cibles consensus ADA/EASD (identiques pour tous les patients, pas des champs
// patient) — TIR ≥ 70 %, temps < 70 mg/dL ≤ 4 %.
const CONSENSUS_TIR_TARGET_PCT = 70
const CONSENSUS_HYPO_MAX_PCT = 4

function computeAge(birthday: Date | null | undefined, now: Date): number | null {
  if (!birthday) return null
  let age = now.getFullYear() - birthday.getFullYear()
  const m = now.getMonth() - birthday.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birthday.getDate())) age--
  return age >= 0 && age < 150 ? age : null
}

export default async function PatientDetailPage({
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

  // Garde d'accès — refus = 404 uniforme (ne révèle pas l'existence du patient).
  const allowed = await canAccessPatient(userId, role, patientId)
  if (!allowed) notFound()

  const ctx = {
    ipAddress: (h.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || "unknown",
    userAgent: h.get("user-agent") || "unknown",
    requestId: h.get("x-request-id") || "rsc-patient-detail",
  }

  // Profil (PII déchiffrée serveur) + objectifs + référent — audité (READ PATIENT).
  const patient = await patientService.getById(patientId, userId, ctx)
  if (!patient) notFound()

  // Stats glycémiques — projection serveur (audité READ ANALYTICS).
  const profile = await analyticsService.glycemicProfile(patientId, OVERVIEW_PERIOD, userId, ctx)

  const now = new Date()
  const cgmObj = patient.cgmObjectives
  const targetLowMgdl = cgmObj ? Math.round(Number(cgmObj.titrLow) * 100) : GLYCEMIA_THRESHOLDS_MGDL.TARGET_LOW
  const targetHighMgdl = cgmObj ? Math.round(Number(cgmObj.titrHigh) * 100) : GLYCEMIA_THRESHOLDS_MGDL.TARGET_HIGH

  const referentName =
    patient.referent?.pro?.name ?? patient.patientServices?.[0]?.service?.name ?? null

  const fullName = `${patient.user.firstname ?? ""} ${patient.user.lastname ?? ""}`.trim()

  const data: PatientDetailData = {
    id: patient.id,
    name: fullName,
    age: computeAge(patient.user.birthday ?? null, now),
    sex: patient.user.sex ?? null,
    pathology: patient.pathology ?? null,
    diagYear: patient.medicalData?.yearDiag ?? null,
    referent: referentName,
    objectives: {
      targetLowMgdl,
      targetHighMgdl,
      tirTargetPct: CONSENSUS_TIR_TARGET_PCT,
      hypoMaxPct: CONSENSUS_HYPO_MAX_PCT,
    },
    stats:
      profile.readingCount > 0
        ? {
            avgGlucoseMgdl: profile.metrics.averageGlucoseMgdl,
            gmi: profile.metrics.gmi,
            cv: profile.metrics.coefficientOfVariation,
            // analytics.tir (severeHypo/hypo/inRange/elevated/hyper) → TirData.
            tir: {
              veryLow: profile.tir.severeHypo,
              low: profile.tir.hypo,
              inRange: profile.tir.inRange,
              high: profile.tir.elevated,
              veryHigh: profile.tir.hyper,
            },
            readingCount: profile.readingCount,
          }
        : null,
  }

  return <PatientDetailClient data={data} />
}
