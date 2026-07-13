/**
 * PatientInsulinClient — hôte client de la vue insulinothérapie patient (US-2650, slice 3).
 *
 * Fournit le contexte `PatientRecordProvider` avec les transports « mode page » :
 *  - `mutate` = `usePagePatientMutator(patientId)` → voie GROUPÉE `PUT /api/patient/insulin-slot-set`
 *    (own-id, US-2663 S4). Le patient soumet sa disposition ENTIÈRE (jeu de créneaux).
 *  - `fetchAnalytics` = `usePagePatientFetcher(patientId)` (requis par le provider).
 *
 * Les éditeurs de GROUPE en mode `propose` (dans `PatientInsulinView`, `canPropose`) consomment
 * `mutate` pour soumettre la proposition d'ensemble. Sécurité : la route PUT re-résout le patient
 * depuis la SESSION (own-id strict, `body.patientId` ignoré) et applique la garde clinique patient
 * (cap %, baisse basale gatée) ; l'`id` transite dans le corps mais n'est jamais faisant autorité
 * (anti-énumération, own-id strict).
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
import type { ProposalViewItem } from "@/components/diabeo/patient/ProposalList"

export function PatientInsulinClient({
  patientId,
  data,
  proposals = [],
}: {
  patientId: number
  data: TreatmentView
  /** US-2664 — demandes en attente DU PATIENT (`source=patient`, filtré serveur). */
  proposals?: ProposalViewItem[]
}) {
  const fetchAnalytics = usePagePatientFetcher(patientId)
  const mutate = usePagePatientMutator(patientId)
  return (
    <PatientRecordProvider fetchAnalytics={fetchAnalytics} mutate={mutate}>
      <PatientInsulinView data={data} canPropose proposals={proposals} />
    </PatientRecordProvider>
  )
}
