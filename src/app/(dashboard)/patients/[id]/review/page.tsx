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
import { z } from "zod"
import type { Role } from "@prisma/client"
import { patientShareConsent } from "@/lib/consent"
import { patientService } from "@/lib/services/patient.service"
import { analyticsService } from "@/lib/services/analytics.service"
import { glycemiaService } from "@/lib/services/glycemia.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { slotSetProposalService } from "@/lib/services/slot-set-proposal.service"
import { auditService } from "@/lib/services/audit.service"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
import { encounterService } from "@/lib/services/encounter.service"
import { getPatientFlags } from "@/lib/services/doctor-dashboard.service"
import { clinicalReviewFlagService } from "@/lib/services/clinical-review-flag.service"
import { recentPatientsService } from "@/lib/services/recent-patients.service"
import { canAccessPatient } from "@/lib/access-control"
import { REVIEW_PERIOD, REVIEW_PERIOD_DAYS } from "@/lib/review-constants"
import { resolveTargetRangeMgdl } from "../overview-targets"
import { buildGlycemiaView } from "../glycemia-view"
import { buildTreatmentView } from "@/lib/insulin/treatment-view"
import { isfIcrSlotSchema, pumpBasalSlotSchema, styloBasalSlotSchema, slotRationaleSchema, fixedDoseSlotSchema, type IsfIcrSlot, type PumpBasalSlot, type StyloBasalSlot, type SlotRationale, type FixedDoseSlot } from "@/lib/insulin/grouped-proposal"
import { isBaselineUnchanged, isBaselineUnchangedBy } from "@/lib/insulin/slot-baseline-cas"
import { diffSlots, diffPumpSlots, diffFixedDoseSlots, diffStyloBasalSlots, hasStructuralChange, hasStructuralChangePump, hasStructuralChangeFixedDose, hasStructuralChangeStylo } from "@/lib/insulin/slot-diff"
import { pumpRowToGroupedSlot } from "@/lib/insulin/pump-time"
import { deriveCoexistsWith } from "@/lib/insulin/proposal-coexistence"
import { ReviewClient, type ReviewData, type ReviewProposalItem, type ReviewGroupedItem } from "./ReviewClient"

/** Forme d'un jeu de créneaux ISF/ICR (JSON `proposedSlots`/`baselineSlots`) — parse défensive à la lecture. */
const isfIcrSlotsSchema = z.array(isfIcrSlotSchema)

/** Forme du JSON `rationale` (rationale MOTEUR par créneau changé) — parse défensive à la lecture (S3b-0b). */
const slotRationaleListSchema = z.array(slotRationaleSchema)

/**
 * Parse défensive d'un JSON `proposedSlots`/`baselineSlots` en `IsfIcrSlot[]`. Les deux colonnes sont écrites
 * par `slotSetProposalService.createSetProposal` (déjà validées `assertValidSlotSet`/forme Zod à l'écriture) —
 * un échec de parse ici ne devrait jamais survenir en usage normal, mais `null` (plutôt qu'un throw qui
 * ferait planter toute la page de revue) traite défensivement une donnée corrompue comme « non certifiable »
 * (fail-closed sur l'affichage, cohérent avec `isBaselineUnchanged(null, …) → false`).
 */
function parseIsfIcrSlots(raw: unknown): IsfIcrSlot[] | null {
  const parsed = isfIcrSlotsSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** US-2663 (S3c) — Forme d'un jeu de créneaux POMPE (`PumpBasalSlot`, temps `"HH:MM"`) — parse défensive à la lecture. */
const pumpSlotsSchema = z.array(pumpBasalSlotSchema)

/** Parse défensive d'un JSON `proposedSlots`/`baselineSlots` POMPE en `PumpBasalSlot[]` (fail-closed → `null`). */
function parsePumpSlots(raw: unknown): PumpBasalSlot[] | null {
  const parsed = pumpSlotsSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** US-2663 (S3d) — Forme d'un jeu de créneaux DOSE FIXE (`FixedDoseSlot`, clé `(usage, moment)`) — parse défensive à la lecture. */
const fixedDoseSlotsSchema = z.array(fixedDoseSlotSchema)

/** Parse défensive d'un JSON `proposedSlots`/`baselineSlots` DOSE FIXE en `FixedDoseSlot[]` (fail-closed → `null`). */
function parseFixedDoseSlots(raw: unknown): FixedDoseSlot[] | null {
  const parsed = fixedDoseSlotsSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** US-2663 (S3e) — Forme d'un jeu de doses BASALE STYLO (`StyloBasalSlot`, clé `kind`, U totales) — parse défensive. */
const styloBasalSlotsSchema = z.array(styloBasalSlotSchema)

/**
 * Parse défensive d'un JSON `proposedSlots`/`baselineSlots` STYLO en `StyloBasalSlot[]` (fail-closed → `null`).
 * `basalRate` porte DEUX formes disjointes (pompe `startTime` vs stylo `kind`) : un jeu pompe NON vide ne parse
 * jamais en stylo (champ `kind` absent) — la détection de forme à la lecture route le bon diff (revue page).
 * ⚠️ **Tie-break du jeu VIDE** : `[]` parse dans les DEUX formes (aucun champ requis à valider). La branche stylo
 * exige `length > 0` (`page.tsx`), donc un `[]` retombe déterministiquement sur la pompe. Non exploitable :
 * `assertValidStyloBasalSet`/`assertValidPumpSlotSet` rejettent `emptySlotSet` à la création → jamais persisté.
 */
function parseStyloSlots(raw: unknown): StyloBasalSlot[] | null {
  const parsed = styloBasalSlotsSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/**
 * Parse défensive du JSON `rationale` (US-2663 S3b-0b) en `SlotRationale[]`. `null` en entrée (proposition
 * humaine, ou legacy pré-S3b-0a) comme en sortie (JSON illisible) — fail-closed sur l'affichage : la revue
 * n'affiche jamais un motif construit sur une donnée corrompue, elle omet simplement l'annotation.
 */
function parseRationale(raw: unknown): SlotRationale[] | null {
  if (raw == null) return null
  const parsed = slotRationaleListSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

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

  // US-2659 (S3) — flags d'orientation OUVERTS (dont Somogyi `nocturnalHypoHighFasting`). Le médecin DOIT
  // voir ce contexte hypo AVANT d'accepter une BAISSE basale patient (baisse sur un Somogyi = mauvais geste,
  // garde-fou du relâchement S3). Type + date uniquement, aucune posologie. Fail-open : un échec n'empêche pas la revue.
  const openReviewFlags = await clinicalReviewFlagService.listOpen(patientId).catch((e) => {
    console.error("[patient-review] listOpen flags failed", e instanceof Error ? e.message : e)
    return []
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
  // US-2649b — valeur LIVE du créneau (re-lecture serveur) pour signaler au médecin une
  // config modifiée depuis la proposition. Lecture par proposition (file `pending` courte).
  const proposals: ReviewProposalItem[] = await Promise.all(
    pending.map(async (p) => ({
      id: p.id,
      parameterType: p.parameterType,
      source: p.source,
      currentValue: Number(p.currentValue),
      liveCurrentValue: await adjustmentService.liveCurrentValue(patientId, p),
      proposedValue: Number(p.proposedValue),
      changePercent: Number(p.changePercent),
      reason: p.reason,
      confidence: p.confidence,
      timeSlotStartHour: p.timeSlotStartHour ?? null,
      timeSlotEndHour: p.timeSlotEndHour ?? null,
      basalDoseKind: p.basalDoseKind ?? null, // US-2659 S3 — stylo ⇒ unité U totales (pas U/h) à l'affichage
      // US-2662 — avertissement NON bloquant : dose basale STYLO proposée au-delà du seuil `MDI_BASAL_WARN_U`
      // (80 U). Dérivé SERVEUR (bornes cliniques jamais côté client). Ne concerne que la basale stylo (U totales).
      highDoseWarning: p.basalDoseKind != null && Number(p.proposedValue) > CLINICAL_BOUNDS.MDI_BASAL_WARN_U,
      createdAt: p.createdAt.toISOString(),
    })),
  )

  // US-2663 (S2) — propositions GROUPÉES (`SlotSetProposal`) PENDING, avec `baselineSlots` inclus (LECTURE
  // clinicien = DOCTOR/NURSE ; DÉCISION = DOCTOR/ADMIN via `canDecide`). Diff (base LIVE vs proposé) + dérive
  // de base (vs `baselineSlots`) calculés SERVEUR : le client ne fait aucun calcul clinique, seulement le rendu.
  const groupedPendingRaw = await slotSetProposalService.listPendingForReview(patientId, userId, ctx)
  // US-2663 (S3b-0b) — indice de COEXISTENCE (D2) : au plus 1 proposition ALGORITHME + 1 proposition HUMAINE
  // `pending` par paramètre peuvent coexister (supersession par CLASSE D'ORIGINE, cf. `createSetProposal`).
  // Calculé sur la liste RAW (avant filtrage ISF/ICR) — pur, aucun calcul clinique.
  const coexistsWithById = deriveCoexistsWith(
    groupedPendingRaw.map((p) => ({ id: p.id, parameterType: p.parameterType, source: p.source })),
  )
  const liveIsf: IsfIcrSlot[] = (insulinSettings?.sensitivityFactors ?? []).map((s) => ({
    startHour: s.startHour,
    endHour: s.endHour,
    value: Number(s.sensitivityFactorGl),
  }))
  const liveIcr: IsfIcrSlot[] = (insulinSettings?.carbRatios ?? []).map((s) => ({
    startHour: s.startHour,
    endHour: s.endHour,
    value: Number(s.gramsPerUnit),
    ...(s.mealLabel != null ? { mealLabel: s.mealLabel } : {}),
  }))
  // US-2663 (S3c) — base LIVE POMPE (temps EXACTS "HH:MM", débit U/h), UNIQUEMENT si le patient est en mode
  // pompe (un patient stylo a aussi une `basalConfiguration` mais pas de créneaux pompe). Vide sinon.
  const basalConfig = insulinSettings?.basalConfiguration
  const livePump: PumpBasalSlot[] =
    basalConfig?.configType === "pump" ? (basalConfig.pumpSlots ?? []).map(pumpRowToGroupedSlot) : []
  // US-2663 (S3d) — base LIVE DOSE FIXE (`{usage, moment, value}`, insuline ACTIVE uniquement) pour le diff
  // de l'écran de revue. Lue UNIQUEMENT si une proposition `fixedDose` pending existe (revue code — évite un
  // aller-retour DB sur chaque revue pour un patient sans dose fixe groupée à réviser). Vide sinon.
  const liveFixedDose = groupedPendingRaw.some((p) => p.parameterType === "fixedDose")
    ? await insulinTherapyService.getFixedDoseSlots(patientId)
    : []
  // US-2663 (S3e) — base LIVE BASALE STYLO (`{kind, value}`, U totales), lue UNIQUEMENT si une proposition
  // `basalRate` pending est de forme STYLO (`kind`, pas `startTime` pompe). Vide sinon (patient pompe/autre).
  const liveStylo = groupedPendingRaw.some((p) => p.parameterType === "basalRate" && (parseStyloSlots(p.proposedSlots)?.length ?? 0) > 0)
    ? await insulinTherapyService.getStyloBasalSlots(patientId)
    : []
  const groupedProposals: ReviewGroupedItem[] = groupedPendingRaw.flatMap((p) => {
    const commonMeta = {
      id: p.id,
      parameterType: p.parameterType,
      source: p.source,
      // US-2663 (S3b-0b) — rationale MOTEUR par créneau changé (non-null uniquement si `source: "algorithm"`).
      rationale: parseRationale(p.rationale),
      coexistsWith: coexistsWithById.get(p.id) ?? null,
      createdAt: p.createdAt.toISOString(),
    }
    // US-2663 (S3d) — DOSE FIXE (mode « doses simples ») : diff/CAS par clé `(usage, moment)`, unité U
    // (PARAM_UNIT_KEY.fixedDose). Avertissement dose élevée dérivé SERVEUR (bornes cliniques jamais côté client).
    if (p.parameterType === "fixedDose") {
      const proposed = parseFixedDoseSlots(p.proposedSlots)
      if (!proposed) {
        console.warn(`[review] SlotSetProposal ${p.id} skipped — unparseable fixedDose proposedSlots`)
        return []
      }
      const baseline = p.baselineSlots == null ? null : parseFixedDoseSlots(p.baselineSlots)
      const fixedCasOpts = {
        keyOf: (s: FixedDoseSlot) => `${s.usage}:${s.moment}`,
        valueOf: (s: FixedDoseSlot) => s.value,
      }
      const rows = diffFixedDoseSlots(liveFixedDose, proposed).map((row) => ({
        ...row,
        // Avertissement dose élevée NON bloquant, seuil par usage : bolus > 25 U, basal ET **both** (prémix) > 80 U.
        // `both` (prémélangée = bolus + basale) est volontairement rattachée au seuil BASAL 80 U (une dose combinée
        // dépasse le seuil prandial) — décision documentée §6 `regles-et-constantes-diabete.md`, à confirmer medical.
        highDoseWarning:
          row.proposedValue != null &&
          (row.usage === "bolus"
            ? row.proposedValue > CLINICAL_BOUNDS.FIXED_BOLUS_WARN_U
            : row.proposedValue > CLINICAL_BOUNDS.FIXED_BASAL_WARN_U),
      }))
      return [
        {
          ...commonMeta,
          rows,
          baselineDrifted: !isBaselineUnchangedBy(baseline, liveFixedDose, fixedCasOpts),
          structuralChange: hasStructuralChangeFixedDose(liveFixedDose, proposed),
        },
      ]
    }
    // US-2663 (S3e) — basale STYLO : `basalRate` de forme STYLO (`kind`, U TOTALES) — détectée AVANT la pompe
    // (formes disjointes). Diff/CAS par `kind`, unité U totales (`isPenBasal` → l'UI choisit `u` vs `basal`).
    if (p.parameterType === "basalRate") {
      const styloProposed = parseStyloSlots(p.proposedSlots)
      if (styloProposed && styloProposed.length > 0) {
        const baseline = p.baselineSlots == null ? null : parseStyloSlots(p.baselineSlots)
        const styloCasOpts = { keyOf: (s: StyloBasalSlot) => s.kind, valueOf: (s: StyloBasalSlot) => s.value }
        // US-2662 (parité voie par-valeur + dose fixe groupée) — avertissement dose élevée NON bloquant, dérivé
        // SERVEUR (bornes cliniques jamais côté client) : dose stylo proposée > `MDI_BASAL_WARN_U` (80 U totales,
        // DT2 insulino-résistant / U300 / dégludec). Sans ce mapping, le badge livré en US-2662 disparaîtrait de
        // la revue dès le passage du flag `ENGINE_GROUPED_STYLO` ON.
        const rows = diffStyloBasalSlots(liveStylo, styloProposed).map((row) => ({
          ...row,
          highDoseWarning: row.proposedValue != null && row.proposedValue > CLINICAL_BOUNDS.MDI_BASAL_WARN_U,
        }))
        return [
          {
            ...commonMeta,
            isPenBasal: true,
            rows,
            baselineDrifted: !isBaselineUnchangedBy(baseline, liveStylo, styloCasOpts),
            structuralChange: hasStructuralChangeStylo(liveStylo, styloProposed),
          },
        ]
      }
      // Un `basalRate` non-pompe dont la forme STYLO est ILLISIBLE ne doit pas retomber sur le parse pompe (log
      // « unparseable pump » trompeur) : on le signale explicitement ici, fail-closed (retiré de l'écran).
      if (styloProposed === null && parsePumpSlots(p.proposedSlots) === null) {
        console.warn(`[review] SlotSetProposal ${p.id} skipped — unparseable basalRate proposedSlots (ni pompe ni stylo)`)
        return []
      }
    }
    // US-2663 (S3c) — basale POMPE : diff/CAS par `startTime` (temps EXACTS), unité U/h (PARAM_UNIT_KEY.basalRate).
    if (p.parameterType === "basalRate") {
      const proposed = parsePumpSlots(p.proposedSlots)
      if (!proposed) {
        console.warn(`[review] SlotSetProposal ${p.id} skipped — unparseable pump proposedSlots`)
        return []
      }
      const baseline = p.baselineSlots == null ? null : parsePumpSlots(p.baselineSlots)
      const pumpCasOpts = { keyOf: (s: PumpBasalSlot) => s.startTime, valueOf: (s: PumpBasalSlot) => s.rate, boundEq: (l: PumpBasalSlot, b: PumpBasalSlot) => l.endTime === b.endTime }
      return [
        {
          ...commonMeta,
          rows: diffPumpSlots(livePump, proposed),
          baselineDrifted: !isBaselineUnchangedBy(baseline, livePump, pumpCasOpts),
          structuralChange: hasStructuralChangePump(livePump, proposed),
        },
      ]
    }
    // ISF/ICR — diff/CAS par `startHour`. Un `parameterType` non géré (aucun à ce jour — les 4 leviers du
    // socle groupé sont couverts) est ignoré défensivement (protège la revue d'un futur levier non encore
    // rendu ici plutôt que de planter).
    const live = p.parameterType === "insulinSensitivityFactor" ? liveIsf : p.parameterType === "insulinToCarbRatio" ? liveIcr : null
    if (!live) return []
    const proposed = parseIsfIcrSlots(p.proposedSlots)
    if (!proposed) {
      // Observabilité (revue code) : un `proposedSlots` illisible retire la proposition de l'écran (fail-closed
      // sur l'action — le serveur lèverait `invalidSlotSet`), mais ne doit pas disparaître SILENCIEUSEMENT.
      console.warn(`[review] SlotSetProposal ${p.id} skipped — unparseable proposedSlots`)
      return []
    }
    const baseline = p.baselineSlots == null ? null : parseIsfIcrSlots(p.baselineSlots)
    return [
      {
        ...commonMeta,
        rows: diffSlots(live, proposed),
        baselineDrifted: !isBaselineUnchanged(baseline, live),
        structuralChange: hasStructuralChange(live, proposed),
      },
    ]
  })

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
    groupedProposals,
    reviewFlags: openReviewFlags.map((f) => f.type),
  }

  return <ReviewClient data={data} />
}
