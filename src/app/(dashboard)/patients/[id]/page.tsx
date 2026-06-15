/**
 * Dossier patient (`/patients/[id]`) — Server Component.
 *
 * Câblage données réelles, Phase 1 (cf. docs/UserStory/Navigation/cablage-donnees-patient.md) :
 * profil + objectifs + stats glycémiques (TIR/GMI/CV/moyenne) RÉELS, scopés
 * serveur, PII déchiffrée serveur, accès audité (ADR #18). Les onglets Glycémie /
 * Traitements / Documents arrivent dans les phases suivantes (état « bientôt
 * disponible » — jamais de données démo).
 *
 * Sécurité :
 *  - `canAccessPatient` (RBAC) ; refus → audit `accessDenied` + `notFound()`
 *    (404 uniforme, anti-énumération + détection d'abus US-2265).
 *  - Garde consentement `shareWithProviders` (cohérence avec routes cgm/analytics) :
 *    opt-out explicite du patient → aucune donnée rendue (PHI non déchiffrée).
 *  - Aucune statistique clinique calculée côté frontend (projections serveur).
 */

import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import type { Role } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { patientService } from "@/lib/services/patient.service"
import { analyticsService } from "@/lib/services/analytics.service"
import { glycemiaService } from "@/lib/services/glycemia.service"
import { auditService } from "@/lib/services/audit.service"
import { canAccessPatient } from "@/lib/access-control"
import { GLYCEMIA_THRESHOLDS_MGDL } from "@/lib/glycemia-thresholds"
import { buildGlycemiaView } from "./glycemia-view"
import { PatientDetailClient, type PatientDetailData } from "./PatientDetailClient"

// Période d'agrégation de la vue d'ensemble. Bornée < 90j (analytics).
const OVERVIEW_PERIOD = "14d"
// Cibles consensus ADA/EASD (identiques pour tous les patients, pas des champs
// patient) — TIR ≥ 70 %, temps < 70 mg/dL ≤ 4 %, CV ≤ 36 % (stabilité glycémique).
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

  const ctx = {
    ipAddress: (h.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || "unknown",
    userAgent: h.get("user-agent") || "unknown",
    requestId: h.get("x-request-id") || "rsc-patient-detail",
  }

  // Garde d'accès (RBAC). NB : un VIEWER n'atteint jamais cette route — le
  // layout (dashboard) le redirige vers /patient/dashboard ; la branche VIEWER
  // de canAccessPatient est donc inerte ici (défense en profondeur).
  const allowed = await canAccessPatient(userId, role, patientId)
  if (!allowed) {
    // Tentative hors périmètre → trace SOC (détection d'énumération US-2265)
    // AVANT le 404 uniforme.
    await auditService.accessDenied({
      userId, resource: "PATIENT", resourceId: String(patientId),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { patientId, surface: "patient-detail-page" },
    })
    notFound()
  }

  // Garde consentement `shareWithProviders` AVANT tout déchiffrement PII
  // (cohérence avec /api/patients/[id]/cgm et /analytics). Fail-open si pas de
  // row (patient récent). Opt-out → aucune donnée rendue.
  const base = await prisma.patient.findFirst({
    where: { id: patientId, deletedAt: null },
    select: { userId: true },
  })
  if (!base) notFound()
  const privacy = await prisma.userPrivacySettings.findUnique({
    where: { userId: base.userId },
    select: { shareWithProviders: true },
  })
  if (privacy && !privacy.shareWithProviders) {
    return <PatientDetailClient data={null} sharingDisabled />
  }

  // Profil (PII déchiffrée serveur) + objectifs + référent — audité (READ PATIENT).
  const patient = await patientService.getById(patientId, userId, ctx)
  if (!patient) notFound()

  // Stats glycémiques — projection serveur (audité READ ANALYTICS).
  const profile = await analyticsService.glycemicProfile(patientId, OVERVIEW_PERIOD, userId, ctx)

  const now = new Date()

  // Phase 2 — Onglet Glycémie : série CGM des dernières 24h (audité READ CGM_ENTRY).
  // Mapping déterministe (g/L→mg/dL, heure Europe/Paris, fraîcheur) extrait dans
  // `buildGlycemiaView` (pur, unit-testé).
  const from24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const cgmEntries = await glycemiaService.getCgmEntries(patientId, from24h, now, userId, ctx)
  const glycemiaView = buildGlycemiaView(cgmEntries, now)
  const cgmObj = patient.cgmObjectives
  // Cible affichée = MÊMES bornes que le calcul TIR serveur (cgm.low / cgm.ok),
  // pas titrLow/titrHigh (qui peuvent diverger). Défaut 70/180 si pas d'objectif.
  const rawLowMgdl = cgmObj ? Math.round(Number(cgmObj.low) * 100) : GLYCEMIA_THRESHOLDS_MGDL.TARGET_LOW
  const rawHighMgdl = cgmObj ? Math.round(Number(cgmObj.ok) * 100) : GLYCEMIA_THRESHOLDS_MGDL.TARGET_HIGH
  // Défense en profondeur (affichage) : garder la cible strictement DANS les
  // zones sévères (54 < low < high < 250) pour que la pastille couleur de
  // `GlycemiaValue` ne dégénère jamais. La config est déjà bornée par
  // `clinical-bounds.ts` — ce clamp ne se déclenche pas en pratique.
  const targetLowMgdl = Math.min(
    Math.max(rawLowMgdl, GLYCEMIA_THRESHOLDS_MGDL.SEVERE_HYPO + 1),
    GLYCEMIA_THRESHOLDS_MGDL.SEVERE_HYPER - 2,
  )
  const targetHighMgdl = Math.min(
    Math.max(rawHighMgdl, targetLowMgdl + 1),
    GLYCEMIA_THRESHOLDS_MGDL.SEVERE_HYPER - 1,
  )

  const fullName = `${patient.user.firstname ?? ""} ${patient.user.lastname ?? ""}`.trim()

  const data: PatientDetailData = {
    id: patient.id,
    name: fullName,
    age: computeAge(patient.user.birthday ?? null, now),
    sex: patient.user.sex ?? null,
    pathology: patient.pathology ?? null,
    diagYear: patient.medicalData?.yearDiag ?? null,
    // Référent = médecin référent uniquement (le libellé est « Médecin référent »).
    referent: patient.referent?.pro?.name ?? null,
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
            // Sécurité clinique : sous 70 % de capture CGM, GMI/TIR/moyenne ne
            // sont pas représentatifs (consensus ADA/EASD) → caveat UI.
            insufficientCapture: profile.warning === "insufficientCgmCapture",
          }
        : null,
    glycemia: glycemiaView,
  }

  return <PatientDetailClient data={data} />
}
