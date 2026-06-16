/**
 * Dossier patient (`/patients/[id]`) — Server Component.
 *
 * Câblage données réelles (cf. docs/UserStory/Navigation/cablage-donnees-patient.md) :
 * les 4 onglets (Vue d'ensemble, Glycémie, Traitements, Documents) sont sur
 * données RÉELLES, scopées serveur, PII déchiffrée serveur, accès audité
 * (ADR #18). Plus aucune donnée démo.
 *
 * Sécurité :
 *  - `canAccessPatient` (RBAC) ; refus → audit `accessDenied` + `notFound()`
 *    (404 uniforme, anti-énumération + détection d'abus US-2265).
 *  - Garde consentement `patientShareConsent` (gdprConsent + shareWithProviders,
 *    fail-closed ; cohérent avec les routes per-patient) : consentement/partage
 *    absent → aucune donnée rendue (PHI non déchiffrée).
 *  - Aucune statistique clinique calculée côté frontend (projections serveur).
 */

import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import type { Role } from "@prisma/client"
import { patientShareConsent } from "@/lib/consent"
import { patientService } from "@/lib/services/patient.service"
import { analyticsService } from "@/lib/services/analytics.service"
import { glycemiaService } from "@/lib/services/glycemia.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { documentService } from "@/lib/services/document.service"
import { auditService } from "@/lib/services/audit.service"
import { canAccessPatient } from "@/lib/access-control"
import { resolveTargetRangeMgdl } from "./overview-targets"
import { buildGlycemiaView } from "./glycemia-view"
import { buildTreatmentView } from "./treatment-view"
import { buildDocumentView } from "./document-view"
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

  // Garde consentement patient AVANT tout déchiffrement PII — source unique
  // `patientShareConsent` (gdprConsent + shareWithProviders, fail-closed),
  // cohérent avec toutes les routes per-patient. Patient inexistant → 404
  // uniforme ; consentement/partage absent → état « partage désactivé »
  // (aucune PII déchiffrée).
  const consent = await patientShareConsent(patientId)
  if (!consent.ok) {
    if (consent.status === 404) notFound()
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
  // Signal de fraîcheur « brut » : détecte un relevé plus récent hors plage
  // (hypo sévère < 40 / capteur LOW-HIGH) exclu de la série affichée. Fail-soft :
  // ce signal secondaire ne doit JAMAIS faire planter le dossier (on dégrade en
  // « pas de caveat » et on trace l'erreur pour le SOC).
  const [cgmEntries, latestRaw] = await Promise.all([
    glycemiaService.getCgmEntries(patientId, from24h, now, userId, ctx),
    glycemiaService.getLatestCgmFreshness(patientId, from24h, now, userId, ctx).catch((e) => {
      console.error("[patient-detail] getLatestCgmFreshness failed", e instanceof Error ? e.message : e)
      return null
    }),
  ])
  const glycemiaView = buildGlycemiaView(cgmEntries, now, latestRaw)

  // Phase 3 — Onglet Traitements : réglages insuline réels (audité
  // READ INSULIN_THERAPY) + traitements associés (déjà chargés via getById).
  const insulinSettings = await insulinTherapyService.getSettings(patientId, userId, ctx)
  // `patient.devices` (chargé par getById) → pompe active dans l'onglet Traitements.
  const treatmentView = buildTreatmentView(insulinSettings, patient.treatments ?? [], patient.devices ?? [], now)

  // Phase 4 — Onglet Documents : documents médicaux (audité READ MEDICAL_DOCUMENT,
  // scopé serveur, `fileUrl` omis). Téléchargement via /api/documents/[id]/download.
  const documents = buildDocumentView(await documentService.list(patientId, role, userId, ctx))
  // Plage cible affichée = bornes TIR (cgm.low/ok), défauts pathology-aware,
  // clampée dans les zones sévères. Helper serveur testé (overview-targets) →
  // badge cohérent avec le donut/TIR (cf. revue PR #550).
  const { targetLowMgdl, targetHighMgdl } = resolveTargetRangeMgdl(
    patient.cgmObjectives,
    patient.pathology,
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
    treatment: treatmentView,
    documents,
  }

  return <PatientDetailClient data={data} />
}
