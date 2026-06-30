/**
 * Assemblage **serveur** du DTO `PatientRecordData` de la fiche patient (US-2633).
 *
 * Source unique réutilisée par :
 *  - la page RSC (`page.tsx`, mode page) ;
 *  - la route `cTok` `GET /api/patients/record` (mode drawer de consultation).
 *
 * ⚠️ Ne fait PAS le contrôle d'accès : les GARDES (`canAccessPatient` /
 * `patientShareConsent` ou résolution `cTok`) sont du ressort de l'APPELANT
 * (page ou route), avant cet appel. Cette fonction ne fait que **projeter** les
 * données déjà autorisées — chaque agrégat est audité par son service
 * (READ PATIENT / ANALYTICS / CGM_ENTRY / INSULIN_THERAPY / MEDICAL_DOCUMENT).
 * Aucun calcul clinique ici (délégué aux services + builders purs).
 */

import type { Role } from "@prisma/client"
import { patientService } from "@/lib/services/patient.service"
import type { AuditContext } from "@/lib/services/patient.service"
import { analyticsService } from "@/lib/services/analytics.service"
import { glycemiaService } from "@/lib/services/glycemia.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { documentService } from "@/lib/services/document.service"
import { getPatientFlags } from "@/lib/services/doctor-dashboard.service"
import { resolveTargetRangeMgdl } from "./overview-targets"
import { buildGlycemiaView } from "./glycemia-view"
import { buildTreatmentView } from "./treatment-view"
import { buildDocumentView } from "./document-view"
import type { PatientRecordData } from "@/components/diabeo/patient/PatientRecord"

/** Période d'agrégation de la vue d'ensemble. Bornée < 90j (analytics). */
const OVERVIEW_PERIOD = "14d"
// Cibles consensus ADA/EASD (identiques pour tous les patients) — TIR ≥ 70 %,
// temps < 70 mg/dL ≤ 4 %, CV ≤ 36 %.
const CONSENSUS_TIR_TARGET_PCT = 70
const CONSENSUS_HYPO_MAX_PCT = 4
const CONSENSUS_CV_MAX_PCT = 36

export function computeAge(birthday: Date | null | undefined, now: Date): number | null {
  if (!birthday) return null
  let age = now.getFullYear() - birthday.getFullYear()
  const m = now.getMonth() - birthday.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birthday.getDate())) age--
  return age >= 0 && age < 150 ? age : null
}

/**
 * Projette le DTO complet de la fiche patient. `null` si le patient n'existe
 * pas (→ l'appelant rend un 404). Suppose l'accès déjà autorisé (cf. en-tête).
 */
export async function buildPatientRecordData(
  patientId: number,
  role: Role,
  userId: number,
  ctx: AuditContext,
): Promise<PatientRecordData | null> {
  // Profil (PII déchiffrée serveur) + objectifs + référent — audité READ PATIENT.
  const patient = await patientService.getById(patientId, userId, ctx)
  if (!patient) return null

  // Stats glycémiques — projection serveur (audité READ ANALYTICS).
  const profile = await analyticsService.glycemicProfile(patientId, OVERVIEW_PERIOD, userId, ctx)

  // Drapeaux d'alerte de la barre de contexte (source « Ma journée »). Fail-soft.
  const flags = await getPatientFlags(patientId).catch((e) => {
    console.error("[build-patient-record] getPatientFlags failed", e instanceof Error ? e.message : e)
    return null
  })

  const now = new Date()

  // Onglet Glycémie : série CGM 24h (audité READ CGM_ENTRY) + signal de fraîcheur
  // « brut » (fail-soft — ne casse jamais l'assemblage).
  const from24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const [cgmEntries, latestRaw] = await Promise.all([
    glycemiaService.getCgmEntries(patientId, from24h, now, userId, ctx),
    glycemiaService.getLatestCgmFreshness(patientId, from24h, now, userId, ctx).catch((e) => {
      console.error("[build-patient-record] getLatestCgmFreshness failed", e instanceof Error ? e.message : e)
      return null
    }),
  ])
  const glycemiaView = buildGlycemiaView(cgmEntries, now, latestRaw)

  // Onglet Traitements : réglages insuline réels (audité READ INSULIN_THERAPY).
  const insulinSettings = await insulinTherapyService.getSettings(patientId, userId, ctx)
  const treatmentView = buildTreatmentView(insulinSettings, patient.treatments ?? [], patient.devices ?? [], now)

  // Onglet Documents : métadonnées scopées + auditées (READ MEDICAL_DOCUMENT).
  const documents = buildDocumentView(await documentService.list(patientId, role, userId, ctx))

  // Plage cible affichée = bornes TIR pathology-aware (cf. overview-targets).
  const { targetLowMgdl, targetHighMgdl } = resolveTargetRangeMgdl(
    patient.cgmObjectives,
    patient.pathology,
  )

  const fullName = `${patient.user.firstname ?? ""} ${patient.user.lastname ?? ""}`.trim()

  return {
    id: patient.id,
    publicRef: patient.publicRef,
    name: fullName,
    flags: flags ?? { recentHypos: false, hypoCount: 0, silentMonitoring: false, silentDays: null, openUrgency: false },
    age: computeAge(patient.user.birthday ?? null, now),
    sex: patient.user.sex ?? null,
    pathology: patient.pathology ?? null,
    diagYear: patient.medicalData?.yearDiag ?? null,
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
            insufficientCapture: profile.warning === "insufficientCgmCapture",
          }
        : null,
    glycemia: glycemiaView,
    treatment: treatmentView,
    documents,
  }
}
