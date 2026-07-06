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
   * demande patient est un pas, pas une titration. (La dose fixe patient est
   * bornée en unités : `FIXED_DOSE_PATIENT_MAX_DELTA_U`.)
   */
  PATIENT_MAX_CHANGE_PERCENT: 10,
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
} as const

export type ClinicalBounds = typeof CLINICAL_BOUNDS

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
