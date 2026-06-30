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

/** DTO de la fiche patient (alias du contrat présentational, rétro-compat page). */
export type PatientDetailData = PatientRecordData

export function PatientDetailClient({
  data,
  sharingDisabled = false,
}: {
  data: PatientDetailData | null
  sharingDisabled?: boolean
}) {
  return (
    <PatientRecord
      data={data}
      sharingDisabled={sharingDisabled}
      documentHref={(docId) => `/api/documents/${docId}/download?patientId=${data?.id ?? ""}`}
    />
  )
}
