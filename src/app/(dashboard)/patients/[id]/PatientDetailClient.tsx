/**
 * Adaptateur **page** de la fiche patient (US-2632).
 *
 * Câble le composant présentational `<PatientRecord>` sur les données projetées
 * par le Server Component (`page.tsx`) et fournit le contrat de liens propre au
 * mode page : téléchargement de document via `?patientId=`. Le mode drawer aura
 * son propre adaptateur (jeton `cTok`, US-2633).
 *
 * Le type DTO reste exporté ici (`PatientDetailData`) pour le Server Component.
 */

"use client"

import { PatientRecord, type PatientRecordData } from "@/components/diabeo/patient/PatientRecord"
import {
  PatientRecordProvider,
  usePagePatientFetcher,
} from "@/components/diabeo/patient/PatientRecordContext"

/** DTO de la fiche patient (alias du contrat présentational, rétro-compat page). */
export type PatientDetailData = PatientRecordData

export function PatientDetailClient({
  data,
  sharingDisabled = false,
}: {
  data: PatientDetailData | null
  sharingDisabled?: boolean
}) {
  // Transport mode page : id en query (`?patientId=`), scope résolu serveur via
  // `canAccessPatient`. L'id vient de l'adaptateur (URL de la page), jamais du
  // composant unifié — anti-énumération préservée. `0` est inatteignable (si
  // `data` null, le sélecteur de période n'est pas rendu).
  const fetchAnalytics = usePagePatientFetcher(data?.id ?? 0)
  return (
    <PatientRecordProvider fetchAnalytics={fetchAnalytics} seedPeriod="14d">
      <PatientRecord
        data={data}
        sharingDisabled={sharingDisabled}
        // `data?.id ?? ""` est défensif et inatteignable en pratique — quand
        // `data` est null, l'onglet Documents n'est pas rendu et `documentHref`
        // n'est jamais invoqué.
        documentHref={(docId) => `/api/documents/${docId}/download?patientId=${data?.id ?? ""}`}
      />
    </PatientRecordProvider>
  )
}
