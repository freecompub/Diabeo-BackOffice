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
} as const

export type ClinicalBounds = typeof CLINICAL_BOUNDS

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
 * Péremption clinique d'un HbA1c de **laboratoire** (jours). L'HbA1c reflète la
 * glycémie moyenne des ~8–12 dernières semaines ; au-delà de ~180 j la valeur
 * est caduque comme indicateur de contrôle courant. `getLastHba1c` expose
 * `ageDays` + `stale` (> ce seuil) ; la valeur reste affichée mais datée/avertie
 * (mode BGM, où GMI/eA1c CGM sont invalides).
 */
export const HBA1C_STALE_DAYS = 180

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
