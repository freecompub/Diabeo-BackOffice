/**
 * Clinical safety bounds for insulin therapy calculations.
 *
 * SINGLE SOURCE OF TRUTH — used by both insulin.service.ts and
 * insulin-therapy.service.ts. Never duplicate these constants.
 *
 * References:
 * - ADA Standards of Medical Care in Diabetes (2025)
 * - 1800 Rule for ISF range
 * - Consensus on max single bolus (25U safety cap)
 *
 * @see docs/clinical-logic/bolus-calculation.md
 */

export const CLINICAL_BOUNDS = {
  /** ISF in g/L per unit — widened for insulin-resistant T2D */
  ISF_GL_MIN: 0.10,
  ISF_GL_MAX: 1.00,
  /** ISF in mg/dL per unit — 1800 Rule range */
  ISF_MGDL_MIN: 10,
  ISF_MGDL_MAX: 100,
  /** ICR (Insulin-to-Carb Ratio) in grams per unit — widened for pediatric + resistant */
  ICR_MIN: 3.0,
  ICR_MAX: 30.0,
  /** Basal rate in U/h — 5.0 max (10 U/h = 240 U/day, dangerous) */
  BASAL_MIN: 0.05,
  BASAL_MAX: 5.0,
  /** Glucose target range in mg/dL */
  TARGET_MIN_MGDL: 60,
  TARGET_MAX_MGDL: 250,
  /** Maximum single bolus dose — safety cap */
  MAX_SINGLE_BOLUS: 25.0,
  /** Insulin action duration range in hours (rapid-acting pharmacokinetics) */
  INSULIN_ACTION_MIN: 3.5,
  INSULIN_ACTION_MAX: 5.0,
  /** Pump basal increment in U/h */
  PUMP_BASAL_INCREMENT: 0.05,
  /**
   * US-2646 — Dose fixe par moment (mode « doses simples »), en unités.
   * `FIXED_DOSE_MIN` = plancher absolu de sanité (bloquant : pas de dose ≤ 0 ; pas
   * < 0,5 U = pas des stylos demi-unité). PAS de plafond BLOQUANT : une basale fixe
   * peut légitimement dépasser 25 U (DT2 insulino-résistant, dégludec/glargine U-300
   * jusqu'à ~80 U). À la place, seuils d'AVERTISSEMENT théoriques par type — ils
   * déclenchent un warning (au service), jamais un rejet :
   *   - `FIXED_BOLUS_WARN_U` : dose fixe prandiale au-delà de laquelle on alerte.
   *   - `FIXED_BASAL_WARN_U`  : dose fixe basale au-delà de laquelle on alerte.
   * `FIXED_DOSE_MAX_DELTA_U` = variation max par ajustement (titration lente) ;
   * `FIXED_DOSE_PATIENT_MAX_DELTA_U` = cap PATIENT resserré (une demande, pas une titration).
   */
  FIXED_DOSE_MIN: 0.5,
  FIXED_BOLUS_WARN_U: 25.0,
  FIXED_BASAL_WARN_U: 80.0,
  FIXED_DOSE_MAX_DELTA_U: 2.0,
  FIXED_DOSE_PATIENT_MAX_DELTA_U: 1.0,
  /**
   * US-2651 (mode b) — cap de variation MOTEUR d'une proposition de dose fixe, en %.
   * Plus strict que le moteur basal/bolus (± 20 %) : la titration de dose fixe est plus lente.
   * La proposition retient le PLUS PETIT de ± ce % et ± `FIXED_DOSE_MAX_DELTA_U` (2 U).
   */
  FIXED_DOSE_MAX_CHANGE_PERCENT: 10,
  /**
   * US-2651 (mode b) — incrément DÉLIVRABLE d'une dose fixe (arrondi, demi-unité stylo).
   * Une proposition dont le pas arrondi est nul (< 0,5 U) n'est pas générée (non actionnable).
   */
  FIXED_DOSE_DELIVERY_INCREMENT_U: 0.5,
  /**
   * US-2651 (mode b) — cooldown (heures) entre deux propositions MOTEUR de dose fixe sur le
   * MÊME moment (matin/midi/soir/nuit). Anti-churn ; s'applique au câblage du générateur
   * (pas à l'analyseur pur). L'effet d'un ajustement de dose fixe se juge sur ≥ 3 jours.
   */
  FIXED_DOSE_COOLDOWN_HOURS: 72,
  /**
   * US-2651 — cap de variation MOTEUR (algorithme) d'une proposition automatique, en %.
   * Toute proposition générée par `proposal-algorithm` est clampée à ± ce %. Source unique
   * (était en dur dans `proposal-algorithm.ts`, §12 nit US-2651). Le cap PATIENT
   * (`PATIENT_MAX_CHANGE_PERCENT`) est strictement plus strict (10 % < 20 %).
   */
  MAX_CHANGE_PERCENT: 20,
  /**
   * US-2649 — cap de variation d'une proposition **PATIENT** pour les ratios
   * (ISF/ICR/basal), en %. Strictement plus strict que le moteur (± 20 %) : une
   * demande patient est un pas, pas une titration.
   *
   * ⚠️ US-2652 — **superseded pour le chemin de création patient** par les caps PAR TYPE
   * `PATIENT_MAX_CHANGE_PERCENT_*` + `PATIENT_MAX_ABS_DELTA_*` ci-dessous (combinaison `min(%, abs)`).
   * Conservé comme référence % (encore utilisé par le miroir C3 `AUTO_APPLY_MAX_AMPLITUDE_PERCENT`).
   */
  PATIENT_MAX_CHANGE_PERCENT: 10,
  /**
   * US-2652 — **% du cap patient PAR TYPE** (uniforme 10 %, aligné C3, < moteur 20 %). Combiné à un **delta
   * absolu PAR TIER de patient** (`PATIENT_MAX_ABS_DELTA`, hors `CLINICAL_BOUNDS` — map imbriquée) via
   * `min(% × |valeur|, abs_tier)`. Le % est ce qui reste constant ; l'absolu varie par type ET par profil
   * (pédiatrie/grossesse/standard/résistant). Constantes % par type pour permettre une divergence future.
   */
  PATIENT_MAX_CHANGE_PERCENT_ISF: 10,
  PATIENT_MAX_CHANGE_PERCENT_ICR: 10,
  PATIENT_MAX_CHANGE_PERCENT_BASAL_RATE: 10,
  PATIENT_MAX_CHANGE_PERCENT_FIXED_BASAL: 10,
  PATIENT_MAX_CHANGE_PERCENT_FIXED_BOLUS: 10,
  /**
   * US-2650 — Fenêtre de COOLDOWN (heures) entre deux propositions PATIENT sur le MÊME
   * (patient × paramètre × créneau). Anti-churn : empêche le spam « résolu → re-proposé » et
   * le bruit de notification relecteur. N'est PAS le gouverneur de titration (le médecin l'est) ;
   * borne la FRÉQUENCE là où `PATIENT_MAX_CHANGE_PERCENT` borne l'AMPLITUDE — ensemble ils
   * plafonnent le %/créneau/jour (anti-ratchet). 24 h = unité de décision d'une titration
   * (l'effet d'un changement ISF/ICR/basal n'est pas jugeable en < 24 h). Décompté depuis la
   * RÉSOLUTION de la dernière proposition (`reviewedAt`, sinon `createdAt`), TOUS statuts
   * confondus (y compris `accepted`). PATIENT uniquement (médecin/infirmier non gatés). Canal
   * NON urgent (jamais auto-appliqué, ADR #13) → ne bloque aucun soin urgent. Garde SERVICE
   * (pas d'index DB : course à faible enjeu, tout reste gaté médecin).
   */
  PATIENT_PROPOSAL_COOLDOWN_HOURS: 24,
  /**
   * US-2651 — garde HYPO des analyseurs. Une hypo **sévère** (niveau 2, < 0,54 g/L / 54 mg/dL)
   * suffit (un seul relevé) à supprimer une proposition « plus d'insuline ». Une hypo **légère**
   * (niveau 1, 0,54–0,70 g/L) freine aussi, mais seulement si **récurrente** : ≥ ce nombre de
   * relevés niveau-1 dans la fenêtre (évite la sur-suppression sur un événement isolé courant).
   * Seuils : `GLYCEMIA_THRESHOLDS_MGDL.SEVERE_HYPO` (54) / `.TARGET_LOW` (70).
   */
  HYPO_LEVEL1_RECURRENCE_MIN: 2,
  /**
   * US-2651 — générateur ICR (mode a), **deadband post-prandial asymétrique** (validé medical).
   * L'analyse ICR compare la PPG 2 h moyenne à des bornes post-prandiales, PAS à la cible à jeun
   * (sinon emballement hypo : une PPG est physiologiquement > à jeun). Borne HAUTE (plafond, déclenche
   * une BAISSE d'ICR = plus d'insuline) = `getCgmDefaults(pathologie/grossesse).ok` (1,80 adulte /
   * 1,40 GD-grossesse) — réutilisée, pas de constante ici. Bornes BASSES (déclenchent une HAUSSE d'ICR
   * = moins d'insuline) ci-dessous ; entre les deux → aucune proposition (bon contrôle préservé).
   */
  POSTPRANDIAL_TITRATION_LOW_GL: 1.0,
  POSTPRANDIAL_TITRATION_LOW_PREGNANCY_GL: 0.9,
  /**
   * US-2651 — fenêtre (minutes depuis le repas) sur laquelle chercher le **nadir** glycémique
   * post-prandial à fournir à la garde hypo (le pic d'action d'un analogue rapide tombe à ~3-4 h,
   * après le point PPG 2 h). Bornée en amont par le prochain apport glucidique. Sans ce nadir, une
   * hypo tardive resterait invisible et le générateur pourrait baisser l'ICR à tort (hypo profonde).
   */
  POSTMEAL_NADIR_WINDOW_MIN: 300,
  /**
   * US-2651 — générateur ICR, **porte qualité pré-repas** (g/L). Un repas n'est retenu pour l'analyse
   * ICR que si la glycémie **pré-repas** est dans cette bande : au-dessus → le bolus incluait
   * probablement une **correction** (la PPG ne reflète alors pas le seul ratio glucides) ; en dessous →
   * le patient a pu sous-doser volontairement. Hors bande → repas exclu (anti mis-attribution).
   */
  ICR_PREMEAL_MIN_GL: 0.7,
  ICR_PREMEAL_MAX_GL: 1.4,
  /**
   * US-2651 — borne HAUTE pré-repas **grossesse** (g/L). La cible pré-repas d'une patiente enceinte
   * est plus basse (~0,95 g/L) : un pré-repas à 1,30–1,40 y est **déjà élevé** → contaminerait le
   * signal ICR (même mode d'échec que le resserrement grossesse évite ailleurs). Resserrée à 1,10.
   * La borne basse (`ICR_PREMEAL_MIN_GL` 0,70) reste valable (seuil hypo grossesse 0,63).
   */
  ICR_PREMEAL_MAX_PREGNANCY_GL: 1.1,
  /**
   * US-2653 — pas de **dé-escalade** (en %) déclenché par des hypos post-prandiales **récurrentes**,
   * indépendamment du deadband sur la moyenne. Monter l'ICR de +10 % ≈ −9 % d'insuline repas — un pas
   * de titration standard (DAFNE/AACE), volontairement **fixe** (pas de scaling sur la profondeur : un
   * nadir isolé profond sur-corrigerait). La persistance titre **cumulativement** run après run. Capé
   * par `MAX_CHANGE_PERCENT`. Déclencheur : `≥ HYPO_LEVEL1_RECURRENCE_MIN` nadirs < niveau-1 (validé medical).
   */
  HYPO_DEESCALATION_PERCENT: 10,
  /**
   * US-2651 (basal) — générateur basal pompe (validé medical). Le créneau titré est celui actif à
   * `NOCTURNAL_TITRATION_REF_HOUR` (**05:00** — un micro-débit basal à 05:00 agit ~06:00-08:00 = fasting).
   * Cible à jeun (g/L) : `glucoseTargets` individualisée si dans `[FASTING_TARGET_MIN_GL ; FASTING_TARGET_MAX_GL]`
   * (grossesse : plafond `FASTING_TARGET_MAX_PREGNANCY_GL`), sinon **défaut** `FASTING_TARGET_DEFAULT_GL`
   * (grossesse `FASTING_TARGET_PREGNANCY_GL`). ⚠️ **JAMAIS `titrLow`** (plancher hypo → titrerait vers l'hypo).
   */
  NOCTURNAL_TITRATION_REF_HOUR: 5,
  FASTING_TARGET_DEFAULT_GL: 1.0,
  FASTING_TARGET_PREGNANCY_GL: 0.9,
  FASTING_TARGET_MIN_GL: 0.8,
  FASTING_TARGET_MAX_GL: 1.3,
  FASTING_TARGET_MAX_PREGNANCY_GL: 1.0,
  /**
   * US-2651 (ISF) — appariement des CORRECTIONS pour la titration ISF (validé medical). Une correction
   * n'est exploitable que si elle avait un « travail » mesurable au-dessus du bruit CGM et propre de
   * tout confondeur : élévation ≥ `CORRECTION_MIN_ELEVATION_GL` (0,30 g/L au-dessus de la cible),
   * glucides absents dans `[t0−CORRECTION_COB_LOOKBACK_MIN, t0]` (COB) et dans la fenêtre d'action. Le
   * « résultat » = relevé settled à `INSULIN_ACTION_MAX` (5 h) ± `CORRECTION_SETTLE_TOL_MIN` (fail-closed
   * si absent). Lire à 5 h (pas 3,5 h) = err vers moins d'insuline. Nadir sur `POSTMEAL_NADIR_WINDOW_MIN`.
   */
  CORRECTION_MIN_ELEVATION_GL: 0.3,
  CORRECTION_SETTLE_TOL_MIN: 30,
  CORRECTION_COB_LOOKBACK_MIN: 180,

  // ── US-2657 (slice B) — Enveloppe de sécurité de l'AUTO-APPLICATION experte (validé medical) ──
  // Un changement patient EXPERT ne s'auto-applique que si TOUTES les conditions C1–C8 (+ C6b) sont
  // vraies ; sinon il RETOMBE en proposition (fail-safe), sauf hors bornes cliniques = rejet dur.
  /** C3 — % max auto-applicable (tous types). Combiné au **même delta absolu PAR TIER** que le cap patient
   *  (`PATIENT_MAX_ABS_DELTA`, via `min(%, abs_tier)`) → invariant `auto-apply ≤ patient` par construction,
   *  pour TOUS les paramètres (US-2652 : ferme le trou où basal/ISF/ICR étaient en % seul). */
  AUTO_APPLY_MAX_CHANGE_PERCENT: 10,
  /** C2 — une modification STRUCTURELLE (ajout/suppression/déplacement d'heures) n'est JAMAIS auto-applicable. */
  AUTO_APPLY_STRUCTURAL_ALLOWED: false,
  /** C7 — délai min entre deux auto-applications sur (patient × paramètre × créneau). Aligné `FIXED_DOSE_COOLDOWN_HOURS`. */
  AUTO_APPLY_COOLDOWN_HOURS: 72,
  /** C7 — anti-cliquet : cumul max des |Δ%| auto-appliqués sur un (paramètre × créneau) sur 7 j glissants. < cap moteur (20 %). */
  AUTO_APPLY_MAX_CUMULATIVE_PERCENT_PER_WEEK: 15,
  /** C6b — plancher : une BAISSE d'insuline ne peut s'auto-appliquer que sur une fenêtre ≥ 14 j (aligné `AGP_SUFFICIENCY.MIN_DAYS`). */
  AUTO_APPLY_MIN_WINDOW_DAYS: 14,
  /** C6b — plancher : capture CGM ≥ 70 % (fenêtre représentative, ATTD/Battelino) pour autoriser une baisse. */
  AUTO_APPLY_MIN_CAPTURE_RATE_PERCENT: 70,
  /** C6b — bloque une baisse si TAR>180 (`elevated+hyper`) dépasse ce % (plafond consensus above-range). */
  AUTO_APPLY_TAR_BLOCK_PERCENT: 30,
  /** C6b — bloque une baisse si TAR>250 (`hyper`) dépasse ce % (2× le plancher consensus niveau-2 de 5 %). */
  AUTO_APPLY_SEVERE_TAR_BLOCK_PERCENT: 10,
  /** C6b — fenêtre de récence d'un blocage cétone (les cétones se normalisent vite). Seuil = `KetoneThreshold.moderateThreshold` (défaut 1,5 mmol/L). */
  AUTO_APPLY_KETONE_BLOCK_LOOKBACK_HOURS: 48,
  /**
   * C6b — **backstop défense-en-profondeur** : nombre minimal de relevés glycémiques pour qu'une BAISSE
   * puisse s'auto-appliquer. Empêche qu'un tableau vide/dégénéré (avec plancher jours/capture par ailleurs
   * satisfait, ex. bug de harnais) soit lu comme « parfaitement dans la cible » par `computeTir([]) = 0 %`.
   * **Monotone sûr** : ne peut que router DAVANTAGE de baisses en proposition (jamais en auto-application).
   * Très en-dessous d'une vraie fenêtre 14 j / 70 % capture CGM (~2 800 relevés).
   */
  AUTO_APPLY_MIN_WINDOW_READINGS: 100,
  /**
   * C3b (US-2657) — **Cap d'auto-application GROUPÉE** : nombre maximal de créneaux (VALUE) qu'une session
   * d'édition experte peut auto-modifier en un seul groupe SANS revue médecin. Au-delà (≥3) → tout le groupe
   * part en `SlotSetProposal` médecin. Justification (medical-domain-validator) : un profil ISF/ICR compte
   * 3–6 créneaux ; en modifier ≥3 d'un coup = re-titration de profil = acte médical, et rend l'ajustement
   * NON ATTRIBUABLE (titration diabéto = un levier à la fois). Groupe mono-paramètre présumé (ISF OU ICR).
   * ⚠️ Borne le PÉRIMÈTRE/attribuabilité ; l'ampleur cumulée co-directionnelle est bornée séparément par
   * `AUTO_APPLY_MAX_GROUP_CUMULATIVE_*_PERCENT` (voir ci-dessous). L'ampleur reste aussi bornée PAR créneau
   * (C3 ±10 %, C7 15 %/7 j).
   */
  AUTO_APPLY_MAX_GROUP_SLOTS: 2,
  /**
   * C3b (US-2657) — **Cap d'AMPLITUDE cumulée CO-DIRECTIONNELLE** d'un groupe auto-appliqué, en %. Ferme
   * l'angle mort du cap par nombre : 2 créneaux chacun sous C3 (10 %) mais DANS LE MÊME SENS empilent leur
   * effet (2×10 % ≈ +20 % d'insuline sur la portion de journée couverte) sans qu'aucune garde par-créneau ne
   * voie la paire comme un tout. On somme les `|Δ%|` des créneaux modifiés PAR DIRECTION de risque
   * (`deriveRiskDirection`) : « plus d'insuline » (hypo) et « moins d'insuline » (hyper) sommés SÉPARÉMENT —
   * jamais additionnés (une redistribution nuit≠midi n'est pas un risque cumulé). Dépassement d'une direction
   * → groupe entier en proposition (`failedCheck: "groupCumulative"`, fail-closed, jamais partiel).
   *
   * **Seuils ASYMÉTRIQUES** (décision produit US-2657, medical-domain-validator) — le risque n'est pas
   * symétrique :
   *  - **HAUSSE d'insuline (hypo)** = aigu (hypoglycémie sévère en minutes/heures) → cap serré **15 %**
   *    (ancré sur C7 15 %/7 j : > C3 10 %, < 2×C3 20 %). Bloque 2 créneaux co-directionnels à −10 %.
   *  - **BAISSE d'insuline (hyper)** = lent (sous-dosage/acidocétose en heures/jours), DÉJÀ lourdement gardé
   *    par C6b (14 j/70 %/cétose/TAR) → cap **20 %** (défère à C6b comme garde-fou principal des baisses).
   */
  AUTO_APPLY_MAX_GROUP_CUMULATIVE_INCREASE_PERCENT: 15,
  AUTO_APPLY_MAX_GROUP_CUMULATIVE_DECREASE_PERCENT: 20,
} as const

export type ClinicalBounds = typeof CLINICAL_BOUNDS

/** Type d'opération pour le cap patient (la dose fixe est éclatée basal/bolus). */
export type PatientCapType = "isf" | "icr" | "basalRate" | "fixedBasal" | "fixedBolus"

/**
 * US-2652 — **Tier de patient** pour le delta absolu du cap. Résolu SERVEUR (`resolvePatientCapTier`) par
 * cascade **le plus strict gagne** à partir de signaux non-spoofables : mode pédiatrique, grossesse
 * (`pregnancyMode || pathology === "GD"`), `pathology === "DT2"`. Défaut `STANDARD` (DT1).
 */
export type PatientCapTier = "PEDIATRIC" | "PREGNANCY" | "STANDARD" | "RESISTANT"

/**
 * US-2652 — **Delta absolu max d'un changement PATIENT, PAR TIER × type** (reco `medical-domain-validator`).
 * Combiné au % (`PATIENT_MAX_CHANGE_PERCENT_*`, uniforme 10 %) via `min(% × |valeur|, abs)` — le plus SERRÉ,
 * sans plancher. Le **même** delta borne l'auto-application (C3) → invariant `auto-apply ≤ patient ≤ moteur`.
 *
 * Le tiering ne joue QUE sur les paramètres en **unités délivrées** (basale, dose fixe), où la résistance à
 * l'insuline augmente les doses. Les **ratios ISF/ICR restent UNIFORMES** : la résistance *abaisse* ISF/ICR
 * → un résistant est à faible valeur où le 10 % borne déjà (élargir l'absolu ne relâcherait que les patients
 * *sensibles* à forte valeur — mauvais sens). Deltas = multiples de l'incrément délivrable (basale 0,05 ;
 * dose fixe 0,5). Direction (baisse interdite famille basale) portée séparément par `patient-change-cap.ts`.
 */
export const PATIENT_MAX_ABS_DELTA: Record<PatientCapTier, Record<PatientCapType, number>> = {
  // Pédiatrie — masse corporelle minimale / plus sensible → le plus strict (gagne même sur un DT2 pédiatrique).
  PEDIATRIC: { isf: 0.05, icr: 1.0, basalRate: 0.05, fixedBasal: 0.5, fixedBolus: 0.5 },
  // Grossesse/DG — contrôle serré + enjeu hypo élevé ; gagne sur RESISTANT (une DT2 enceinte est en PREGNANCY).
  PREGNANCY: { isf: 0.05, icr: 1.0, basalRate: 0.1, fixedBasal: 0.5, fixedBolus: 0.5 },
  // Standard (DT1) — tier de référence.
  STANDARD: { isf: 0.05, icr: 1.0, basalRate: 0.15, fixedBasal: 1.0, fixedBolus: 1.0 },
  // Insulino-résistant (DT2) — fortes doses délivrées : pas de titration significatif (basale 0,25 U/h).
  RESISTANT: { isf: 0.05, icr: 1.0, basalRate: 0.25, fixedBasal: 1.5, fixedBolus: 1.5 },
} as const

/**
 * US-2648b — Un débit basal est **délivrable** par la pompe s'il est un multiple de
 * `PUMP_BASAL_INCREMENT` (0,05 U/h). Sinon la valeur passe les bornes mais n'est pas
 * programmable (arrondi silencieux / profil rejeté). Tolérance flottante `1e-9` (l'erreur
 * IEEE754 de `value/0.05` sur [0.05, 5.0] est ~2e-14 ≪ 1e-9). Source UNIQUE, utilisée par
 * la proposition (`adjustment.service`), l'édition directe (routes ISF/ICR/basal) et les
 * garde-fous service — cf. catalogue `docs/clinical-logic/regles-et-constantes-diabete.md` §6.
 */
export function isDeliverableBasalRate(value: number): boolean {
  const step = CLINICAL_BOUNDS.PUMP_BASAL_INCREMENT
  return Math.abs(value / step - Math.round(value / step)) < 1e-9
}

/**
 * US-2657 (slice B) — Une dose fixe est **délivrable** si elle est un multiple de
 * `FIXED_DOSE_DELIVERY_INCREMENT_U` (0,5 U). Miroir de `isDeliverableBasalRate` (même tolérance
 * flottante `1e-9`). Utilisé par l'enveloppe d'auto-application (C5) — pas d'arrondi silencieux.
 */
export function isDeliverableFixedDose(value: number): boolean {
  const step = CLINICAL_BOUNDS.FIXED_DOSE_DELIVERY_INCREMENT_U
  return Math.abs(value / step - Math.round(value / step)) < 1e-9
}

/**
 * Plage de valeurs CGM **physiologiquement valides** (g/L) pour les AGRÉGATS
 * (moyenne, CV, GMI, TIR, AGP, épisodes hypo — par patient ET cohorte).
 *
 * SOURCE UNIQUE — utilisée par `analytics.service.ts` ET
 * `population-analytics.service.ts`. Alignée sur le CHECK base
 * (`value_gl BETWEEN 0.20 AND 6.00`, `prisma/sql/cgm_partitioning.sql`) — vérifié
 * par `tests/unit/clinical-bounds.test.ts`.
 *
 * ⚠️ DIFFÉRENT du plancher d'AFFICHAGE de la série (0.40–5.00 g/L,
 * `glycemia.service.getCgmEntries`). Les agrégats incluent les hypo sévères
 * réelles mesurées sous le plancher d'affichage (0.20–0.40 g/L) : sinon le bucket
 * `severeHypo` du TIR et le compteur cohorte `criticalHypoCount` sous-estiment la
 * charge hypoglycémique (consensus ADA/Battelino : tout relevé CGM valide compte).
 */
export const CGM_AGGREGATE_RANGE_GL = {
  MIN: 0.20,
  MAX: 6.00,
} as const

/**
 * Paliers du **temps dans la cible (TIR)** affiché sur le dashboard médecin
 * (carte Alertes, US-2401). Source unique partagée entre le service (calcul,
 * plancher de suffisance) et l'UI client (`EmergencyCard`, paliers de pill).
 *
 * - `TARGET_PERCENT` (≥ 70 %) : cible internationale ATTD/Battelino 2019. Sous
 *   ce seuil → « sous-cible » (ambre).
 * - `LOW_PERCENT` (< 50 %) : contrôle franchement insuffisant → « TIR bas »
 *   (rouge). Les **bornes glycémiques** de la cible sont, elles, adaptées à la
 *   pathologie (GD 0,63–1,40 g/L vs 0,70–1,80) via `getCgmDefaults` — ce module
 *   ne porte QUE les paliers en pourcentage (indépendants de la pathologie).
 * - `MIN_CAPTURE_RATE` (%) : plancher de suffisance de données (aligné sur
 *   `population-analytics`) en deçà duquel le TIR n'est pas publié (trompeur sur
 *   un échantillon trop maigre) → la carte n'affiche alors ni TIR ni pill.
 *
 * Module sans dépendance serveur → importable côté client sans fuite Prisma.
 */
export const DASHBOARD_TIR = {
  TARGET_PERCENT: 70,
  LOW_PERCENT: 50,
  MIN_CAPTURE_RATE: 30,
} as const

/**
 * Seuils de **suffisance de données pour l'AGP** (profil ambulatoire) — socle
 * fiche patient US-2631. Consensus ATTD/Battelino 2019 : un AGP fiable exige
 * ≥ 14 jours de données et ≥ 70 % de capture ; une fenêtre plus courte reste
 * « indicative ». Au niveau d'un slot de 15 min, sous `MIN_SLOT_READINGS`
 * relevés les percentiles externes (P10/P90) sont du bruit d'échantillonnage →
 * la vue ne doit PAS tracer de bande (médiane seule ou trou). Le service expose
 * le `count` par slot (`computeAgp`) ; la décision de masquage est portée par la
 * vue (US-2635) à partir de ce seuil.
 *
 * Module sans dépendance serveur → importable côté client (vue AGP) sans fuite.
 */
export const AGP_SUFFICIENCY = {
  /** Fenêtre minimale recommandée (jours) ; en deçà = « indicatif ». */
  MIN_DAYS: 14,
  /** Capture minimale (%) pour un AGP représentatif (cf. analytics MIN_CAPTURE_RATE). */
  MIN_CAPTURE_RATE: 70,
  /**
   * Relevés minimum par slot de 15 min avant de tracer la bande P10–P90. À 3
   * relevés, P10/P90 (interpolés) sont ~les extrêmes de l'échantillon, donc
   * encore bruités (revue medical-domain-validator) ; 5 est un plancher
   * défendable pour une bande crédible sans masquer excessivement (un slot bien
   * couvert sur 14 j à 70 % a ~25–30 relevés). Reste un seuil minimal — la vue
   * (US-2635) peut graduer davantage le masquage.
   */
  MIN_SLOT_READINGS: 5,
} as const

/**
 * Péremption clinique d'un HbA1c (jours). L'HbA1c reflète la glycémie moyenne des
 * ~8–12 dernières semaines. `getLastHba1c` expose `ageDays` + `stale` (> ce seuil).
 *
 * ⚠️ **Seuil « stable / à l'objectif ».** 180 j (~6 mois) = intervalle ADA de re-dosage
 * pour un patient **contrôlé et à la cible**. Pour un diabétique **NON contrôlé** (ou
 * changement thérapeutique récent), l'ADA recommande **90 j**. Ce seuil unique est donc
 * volontairement **lâche** : tant que le générateur mode c (US-2651) n'a pas de contexte de
 * contrôle (le TIR — `tirBelowTarget` — arrive en slice 2), il ne peut distinguer contrôlé de
 * non-contrôlé sans sur-flaguer tout patient stable. **À rendre conditionnel** (90 j hors-cible /
 * 180 j à l'objectif) une fois le TIR câblé (validé medical #675).
 *
 * **Provenance** : `hba1cStale` lit la **dernière HbA1c enregistrée** (`GlycemiaEntry.hba1c` /
 * `DiabetesEvent.hba1c`) — valeur **saisie in-app, potentiellement auto-déclarée**, pas
 * nécessairement vérifiée labo. Suffisant pour un signal de **récence** (flag d'orientation gaté
 * médecin, non dosant), le soignant voyant la valeur + la date.
 */
export const HBA1C_STALE_DAYS = 180

/**
 * US-2651 (mode c) — seuils du flag d'orientation **`hba1cAboveTarget`** (HbA1c récente au-dessus de
 * la cible → à revoir ; comble le trou BGM-only, validé medical #676). En **%** (unité canonique).
 *
 * - `HBA1C_HIGH_DEFAULT_PERCENT` (**8,0 %**) : plancher « clairement au-dessus de la cible » (ADA/AACE)
 *   quand **aucune cible individualisée** n'est saisie — volontairement conservateur (un DT2 bien géré
 *   à 7,0–7,7 % ne doit pas saturer la file de revue ; la fatigue d'alerte est un risque en soi).
 * - `HBA1C_HIGH_DEFAULT_PREGNANCY_PERCENT` (**6,0 %**) : plancher **grossesse** (cible ADA < 6 %) —
 *   sous-flaguer la population la plus à risque serait inacceptable. Utilisé si `isPregnancy` sans cible.
 * - `HBA1C_TARGET_MARGIN_PERCENT` (**0,5 %**) : marge d'excès **significatif** au-dessus de la cible
 *   **individualisée** du patient (dépasse le bruit analytique ~± 0,3–0,5 %). Appliquée **uniquement**
 *   à la cible individualisée, **pas** aux défauts (qui sont déjà la ligne d'excès significatif).
 */
export const HBA1C_HIGH_DEFAULT_PERCENT = 8.0
export const HBA1C_HIGH_DEFAULT_PREGNANCY_PERCENT = 6.0
export const HBA1C_TARGET_MARGIN_PERCENT = 0.5

/**
 * US-2639 — Carnet BGM (moyenne par moment de la journée, patient sans capteur).
 * Plancher de suffisance : sous `MIN_READINGS_PER_MOMENT` relevés capillaires
 * sur la fenêtre, la moyenne d'un moment n'est PAS publiée (« données
 * insuffisantes ») — une moyenne sur 1–2 relevés est du bruit, trompeuse au lit
 * du patient. Cohérent avec le principe de suffisance de l'AGP/TIR (revue
 * medical-domain-validator).
 */
export const BGM_CARNET = {
  MIN_READINGS_PER_MOMENT: 3,
} as const

/**
 * US-2651 (mode c) — flag d'orientation `observance` = **suivi glycémique insuffisant** d'un patient
 * NON insuliné (on n'a pas de donnée d'adhésion médicamenteuse ni de présence RDV ; seule la fréquence
 * d'auto-surveillance est mesurable). Validé medical. Logique **either/or** (ne flague QUE si les DEUX
 * canaux échouent) pour ne JAMAIS faussement flaguer un porteur CGM ni un testeur BGM diligent :
 * `observancePoor = !cgmAdequate && !bgmAdequate`, avec `cgmAdequate = capture ≥ MIN_CGM_CAPTURE_RATE`
 * (un capteur abandonné → capture basse → détecté) et `bgmAdequate = comptage BGM ≥ seuil pathology-aware`.
 * **Garde enrollment** : pas de flag si le patient est inscrit depuis < `MIN_ENROLLMENT_DAYS` (fenêtre
 * pas encore observable). Seuils lenients (orientation-only → err vers NE PAS flaguer, anti fatigue d'alerte).
 */
export const OBSERVANCE = {
  WINDOW_DAYS: 30,
  MIN_CGM_CAPTURE_RATE: 30, // % — aligné sur DASHBOARD_TIR.MIN_CAPTURE_RATE (capture suffisante = observant)
  BGM_MIN_READINGS_DEFAULT: 4, // DT1/DT2/défaut : < ~1×/semaine sur 30 j = sous-surveillance
  BGM_MIN_READINGS_PREGNANCY: 30, // GD/grossesse : < ~1×/jour sur 30 j (cible GD = 4×/jour)
  MIN_ENROLLMENT_DAYS: 30, // ne pas flaguer un patient inscrit depuis moins d'une fenêtre
} as const

/**
 * US-2637 — Tendances de repas (définitions cliniques validées par
 * `medical-domain-validator`). Durées en minutes, relatives à l'heure du repas
 * `t0`.
 *
 * ⚠️ Les **plafonds absolus** post-prandiaux ne sont PAS ici : ils dérivent de
 * `getCgmDefaults(pathology)` (pathology-aware, GD 63–140 vs 70–180) — source
 * unique. La **plage de relevés valides** = `CGM_AGGREGATE_RANGE_GL` (0.20–6.00),
 * PAS le plancher d'affichage (sinon une hypo post-prandiale sévère serait
 * invisible dans l'excursion).
 */
export const MEAL_TREND = {
  /** Pré-repas = dernier relevé dans `[t0 − 30 min, t0]`. */
  PRE_WINDOW_MIN: 30,
  /** Fenêtre d'excursion plafonnée à 3 h (bornée au prochain apport glucidique). */
  EXCURSION_MAX_MIN: 180,
  /** Sous cette durée de fenêtre → pic « non évaluable » (jamais un pic tronqué). */
  EXCURSION_MIN_WINDOW_MIN: 90,
  /** « Après » = glycémie post-prandiale (PPG) 2 h : relevé le plus proche de
   *  `t0 + 120` dans `[t0 + 90, t0 + 150]`. */
  POST_2H_CENTER_MIN: 120,
  POST_2H_TOL_MIN: 30,
  // NB : la PPG 1 h additionnelle grossesse (cible ACOG 1 h < 140) n'est pas
  // encore calculée — reportée à US-2639 (durcissement grossesse/BGM). Le
  // plafond post-prandial GD (140) est déjà appliqué à la PPG 2 h.
  /** Plancher d'affichage : < 3 repas appariés → « données insuffisantes ». */
  MIN_PAIRED_MEALS: 3,
  /** Courbe alignée : tranches de 15 min sur `[−60, +180]`, marqueur d'un bucket
   *  seulement si ≥ 3 relevés y contribuent (sinon trou, pas d'interpolation). */
  BUCKET_SIZE_MIN: 15,
  BUCKET_MIN_READINGS: 3,
  ALIGN_START_MIN: -60,
  ALIGN_END_MIN: 180,
} as const
