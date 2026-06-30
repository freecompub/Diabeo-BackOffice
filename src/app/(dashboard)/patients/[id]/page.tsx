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
import { auditService } from "@/lib/services/audit.service"
import { recentPatientsService } from "@/lib/services/recent-patients.service"
import { canAccessPatient } from "@/lib/access-control"
import { buildPatientRecordData } from "./build-patient-record"
import { PatientDetailClient } from "./PatientDetailClient"

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
    // Traçabilité HDS : l'accès refusé pour « partage désactivé » (opt-out Art. 21
    // / gdprConsent absent) est désormais audité (auparavant silencieux) — permet
    // de distinguer un refus de partage d'un simple 404.
    await auditService.accessDenied({
      userId, resource: "PATIENT", resourceId: String(patientId),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { patientId, surface: "patient-detail-page", kind: "sharingDisabled" },
    })
    return <PatientDetailClient data={null} sharingDisabled />
  }

  // Projection du DTO — source unique partagée avec la route cTok du drawer
  // (`/api/patients/record`, US-2633). Les gardes RBAC + consentement ci-dessus
  // restent côté page ; l'assemblage audite chaque agrégat.
  const data = await buildPatientRecordData(patientId, role, userId, ctx)
  if (!data) notFound()

  // US-2603 — enregistre la consultation du dossier (switcher « récemment vus »).
  // Fail-soft : un échec ne casse jamais le rendu ; réservé aux PS (VIEWER n'atteint
  // pas cette route — défense en profondeur).
  if (role !== "VIEWER") {
    void recentPatientsService.recordView(userId, patientId).catch((e) => {
      console.error("[patient-detail] recordView failed", e instanceof Error ? e.message : e)
    })
  }

  return <PatientDetailClient data={data} />
}
