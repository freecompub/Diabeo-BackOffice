/**
 * PatientInsulinClient — hôte client de la vue insulinothérapie patient (US-2650, slice 3).
 *
 * Fournit le contexte `PatientRecordProvider` avec les transports « mode page » :
 *  - `mutate` = `usePagePatientMutator(patientId)` → `POST /api/adjustment-proposals`.
 *  - `fetchAnalytics` = `usePagePatientFetcher(patientId)` (requis par le provider).
 *
 * `InsulinProposalDialog` (dans `PatientInsulinView`, `canPropose`) consomme `mutate` pour
 * soumettre une proposition. Sécurité : la route POST re-résout le patient depuis la SESSION
 * (VIEWER → son dossier, `body.patientId` ignoré) et applique les bornes patient ; l'`id`
 * transite dans le corps mais n'est jamais faisant autorité (anti-énumération, own-id strict).
 *
 * @param patientId Dossier du patient connecté (résolu own-id côté serveur).
 * @param data Vue traitement résolue serveur.
 */
"use client"

import {
  PatientRecordProvider,
  usePagePatientMutator,
  usePagePatientFetcher,
} from "@/components/diabeo/patient/PatientRecordContext"
import { PatientInsulinView } from "@/components/diabeo/patient/PatientInsulinView"
import type { TreatmentView } from "@/components/diabeo/patient/patient-record-views"

export function PatientInsulinClient({ patientId, data }: { patientId: number; data: TreatmentView }) {
  const fetchAnalytics = usePagePatientFetcher(patientId)
  const mutate = usePagePatientMutator(patientId)
  return (
    <PatientRecordProvider fetchAnalytics={fetchAnalytics} mutate={mutate}>
      <PatientInsulinView data={data} canPropose />
    </PatientRecordProvider>
  )
}
