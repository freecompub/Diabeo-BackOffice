# Règles & constantes métier — Diabète (référence technico-fonctionnelle)

> **Document de référence UNIQUE** recensant **toutes** les règles métier diabète et
> **toutes** les constantes / intervalles / seuils cliniques du backoffice.
>
> ⚠️ **Source de vérité = le code** (fichiers cités en regard). Ce document est le
> **catalogue fonctionnel** : il décrit le *sens clinique*, la *valeur* et son *emplacement*.
> Il est **tenu à jour à chaque tâche** touchant une règle/constante diabète
> (règle `CLAUDE.md` § « Documentation & règles métier »). Les valeurs sont verrouillées
> par `tests/unit/clinical-bounds.test.ts` (anti-drift).

**Comment contribuer** : toute nouvelle constante clinique, tout intervalle, tout seuil,
toute règle métier diabète ajouté au code **doit** apparaître ici (ligne dans le tableau
du domaine concerné) dans la **même PR**, avec sa valeur et son fichier source.

---

## 1. Bornes de sécurité de l'insulinothérapie — `CLINICAL_BOUNDS`

Source : `src/lib/clinical-bounds.ts` · Réfs : ADA Standards of Care 2025, règle 1800/ISF,
consensus cap bolus 25 U.

| Constante | Valeur | Unité | Sens clinique |
|---|---|---|---|
| `ISF_GL_MIN` / `ISF_GL_MAX` | 0.10 / 1.00 | g/L·U | Facteur de sensibilité (élargi DT2 insulino-résistant) |
| `ISF_MGDL_MIN` / `ISF_MGDL_MAX` | 10 / 100 | mg/dL·U | ISF (règle 1800) |
| `ICR_MIN` / `ICR_MAX` | 3.0 / 30.0 | g/U | Ratio insuline/glucides (élargi pédiatrie + résistant) |
| `BASAL_MIN` / `BASAL_MAX` | 0.05 / 5.0 | U/h | Débit basal (>5 U/h = 240 U/j, dangereux) |
| `TARGET_MIN_MGDL` / `TARGET_MAX_MGDL` | 60 / 250 | mg/dL | Bornes de la cible glycémique |
| `MAX_SINGLE_BOLUS` | 25.0 | U | Plafond bolus unique (jamais dépasser) |
| `INSULIN_ACTION_MIN` / `MAX` | 3.5 / 5.0 | h | Durée d'action analogues rapides |
| `PUMP_BASAL_INCREMENT` | 0.05 | U/h | Pas d'incrément basal pompe |
| `FIXED_DOSE_MIN` | 0.5 | U | Plancher **bloquant** dose fixe (mode doses simples, US-2646) |
| `FIXED_BOLUS_WARN_U` | 25.0 | U | Seuil d'**avertissement** (non bloquant) bolus fixe |
| `FIXED_BASAL_WARN_U` | 80.0 | U | Seuil d'**avertissement** (non bloquant) basale fixe |
| `FIXED_DOSE_MAX_DELTA_U` | 2.0 | U | Variation max par ajustement (titration lente) |
| `FIXED_DOSE_PATIENT_MAX_DELTA_U` | 1.0 | U | Cap variation **patient** dose fixe (< moteur) |
| `PATIENT_MAX_CHANGE_PERCENT` | 10 | % | Cap variation **patient** sur ratios (proposition, US-2649) |

**Règle dose fixe (US-2646)** : pas de plafond bloquant (une basale fixe peut dépasser 25 U) ;
les `*_WARN_U` déclenchent un **avertissement** au service, jamais un rejet. Seul `FIXED_DOSE_MIN`
bloque (dose ≤ 0 / < pas demi-unité).

## 2. Zones glycémiques (seuils de coloration / alerte clinique)

Source : `getGlycemiaZone` (`src/components/diabeo/GlycemiaValue.tsx`) · Design system : palette « glycémie ».

| Zone | Intervalle (mg/dL) | Sémantique |
|---|---|---|
| very-low | < 54 | Hypoglycémie sévère (`role="alert"`) |
| low | 54 – 69 | Hypoglycémie |
| normal | 70 – 180 | Cible |
| high | 181 – 250 | Hyperglycémie |
| very-high | > 250 | Hyperglycémie marquée |
| critical | seuils patient (opt.) | Zone critique (`role="alert"`) |

> Les **bornes de la cible** sont **pathology-aware** : GD/grossesse 0.63–1.40 g/L vs 0.70–1.80
> (voir `getCgmDefaults(pathology)`), ce document ne fige que les zones par défaut.

## 3. Plages de données valides & suffisance

| Constante | Valeur | Source | Sens |
|---|---|---|---|
| `CGM_AGGREGATE_RANGE_GL` | 0.20 – 6.00 g/L | `clinical-bounds.ts` | Plage CGM physiologiquement valide pour les **agrégats** (TIR/GMI/AGP). Aligné CHECK base `cgm_partitioning.sql`. |
| Plancher d'affichage série CGM | 0.40 – 5.00 g/L | `glycemia.service.getCgmEntries` | Plage d'**affichage** de la courbe (≠ agrégats). |
| `AGP_SUFFICIENCY.MIN_DAYS` | 14 j | `clinical-bounds.ts` | AGP fiable (ATTD/Battelino 2019) |
| `AGP_SUFFICIENCY.MIN_CAPTURE_RATE` | 70 % | idem | Capture minimale AGP |
| `AGP_SUFFICIENCY.MIN_SLOT_READINGS` | 5 | idem | Relevés min/slot 15 min avant de tracer P10–P90 |
| `DASHBOARD_TIR.TARGET_PERCENT` | 70 % | idem | Cible TIR (≥ 70 %) |
| `DASHBOARD_TIR.LOW_PERCENT` | 50 % | idem | Sous 50 % = « TIR bas » |
| `DASHBOARD_TIR.MIN_CAPTURE_RATE` | 30 % | idem | Plancher de suffisance pour publier le TIR |
| `HBA1C_STALE_DAYS` | 180 j | idem | Péremption HbA1c labo (~6 mois) |
| `BGM_CARNET.MIN_READINGS_PER_MOMENT` | 3 | idem | Relevés capillaires min/moment avant de publier une moyenne |

## 4. Tendances de repas — `MEAL_TREND` (US-2637)

Source : `src/lib/clinical-bounds.ts` (durées en minutes, relatives à `t0` = heure du repas).

| Constante | Valeur | Sens |
|---|---|---|
| `PRE_WINDOW_MIN` | 30 | Pré-repas = dernier relevé dans `[t0−30, t0]` |
| `EXCURSION_MAX_MIN` | 180 | Fenêtre d'excursion plafonnée à 3 h |
| `EXCURSION_MIN_WINDOW_MIN` | 90 | Sous cette durée → pic « non évaluable » |
| `POST_2H_CENTER_MIN` / `POST_2H_TOL_MIN` | 120 / 30 | PPG 2 h : relevé proche de `t0+120` dans `[t0+90, t0+150]` |
| `MIN_PAIRED_MEALS` | 3 | Repas appariés min pour une tendance |
| `BUCKET_SIZE_MIN` / `BUCKET_MIN_READINGS` | 15 / 3 | Buckets d'alignement des mini-courbes |
| `ALIGN_START_MIN` / `ALIGN_END_MIN` | −60 / 180 | Fenêtre d'alignement des courbes repas |

> Plafonds post-prandiaux absolus = `getCgmDefaults(pathology)` (pathology-aware), **pas ici**.

## 5. Règles de calcul & de sélection (logique métier)

| Règle | Description | Source |
|---|---|---|
| **Calcul de bolus** | `mealBolus = carbs/ICR` ; `correction = max(0,(bg−target)/ISF)` ; `total = meal + correction − IOB` ; cappé à `MAX_SINGLE_BOLUS`. Suggestion **jamais** auto-injectée (ADR #13). | `insulin.service.ts` · `docs/clinical-logic/bolus-calculation.md` |
| **Sélection du créneau horaire** | `findSlotForHour` : intervalle **demi-ouvert** `[startHour, endHour)`, gestion passage minuit. **Fail-closed** : heure non couverte → `undefined` → l'appelant **lève** (pas de dose sur heure non couverte). | `insulin.service.ts` |
| **GMI ≠ HbA1c** | Le GMI (dérivé CGM) n'est jamais présenté comme une HbA1c labo. | `docs/clinical-logic/gmi-vs-ehba1c-terminology.md` |
| **Détection du mode de traitement** | `basalBolus` (ISF **et** ICR) / `fixedDose` (insuline simple) / `nonInsulin`. **Fail-closed** : un DT1 — ou tout patient ayant déjà eu de l'insuline (config vidée) — n'est **jamais** `nonInsulin`. Source de vérité = dérivée à la lecture. | `treatment-mode.service.ts` (US-2647) |
| **Couverture 24 h** | `analyzeSlotCoverage` : détection trou/chevauchement des créneaux ISF/ICR/basal (config incohérente → édition bloquée). | `src/lib/insulin/slot-coverage.ts` |

## 6. Propositions d'ajustement — garde-fous (US-2649a)

Source : `adjustmentService.createProposal` (`src/lib/services/adjustment.service.ts`) · ADR #13.

| Règle | Détail |
|---|---|
| **Jamais auto-appliqué** | Toute proposition naît `pending` → validée par un **DOCTOR** (`accept`), bornes re-vérifiées à l'application. |
| **Provenance** | `source` (`algorithm`/`patient`/`nurse`/`doctor`) + auteur **dérivés serveur** (jamais du body). |
| **`currentValue` de confiance** | Lu **serveur** depuis la config réelle (jamais du body) → garde-fous ininviolables. |
| **Sens interdit patient** | Un patient ne peut **baisser** une basale (risque hyper/cétose). ISF/ICR : monter la valeur *réduit* la dose → borné en amplitude seulement. |
| **Cap patient** | Ratios ≤ `PATIENT_MAX_CHANGE_PERCENT` (10 %) ; dose fixe ≤ `FIXED_DOSE_PATIENT_MAX_DELTA_U` (1 U). |
| **Incrément basal (US-2648b)** | Un débit basal doit être **délivrable** = multiple de `PUMP_BASAL_INCREMENT` (0,05 U/h), sinon non programmable sur la pompe. Source unique : **`isDeliverableBasalRate()`** (`clinical-bounds.ts`), appliquée à la **proposition** (`validateProposedValue`), à l'**édition directe** (routes POST/PATCH basal) et en **garde service** (`createPumpSlot`/`updatePumpSlot`). Miroir UI : `step="0.05"`. |
| **Anti-spam** | 1 proposition `pending` max par (patient, paramètre, créneau) — index unique partiel `adjustment_proposals_one_pending_per_slot`. |
| **Éditabilité par mode (US-2648b)** | Capability `deriveEditCapability(role, {mode,coherent})` : `canEditDirect` (DOCTOR/ADMIN), `canPropose` (DOCTOR/NURSE/patient, ADMIN exclu) ; `editableParameters` = ISF/ICR/basal **si** `basalBolus` **ET** `coherent`, sinon **vide** (`fixedDose`/`nonInsulin`/incohérent → non éditable, fail-closed). Pilote l'UI ; n'autorise rien (RBAC = routes). Source : `src/lib/insulin/edit-capability.ts`. |
| **Frontière dispositif médical** | Mode non-insuliné : **aucune posologie** médicamenteuse orale/GLP-1 proposée (`ClinicalReviewFlag` = orientation, jamais une dose). |
| **RBAC édition / proposition (US-2648a)** | Écriture **directe** de la config insuline = **DOCTOR** (autorité clinique). NURSE / patient → **proposition** `POST /api/adjustment-proposals` (validée par un médecin). ADMIN rejeté. Rôle proposeur dérivé de la **session** ; accès via `resolvePatientId` (VIEWER→son dossier / pro→`canAccessPatient`) ; réponse sans `proposerComment`. Routes : `src/app/api/insulin-therapy/*` (DOCTOR) + `src/app/api/adjustment-proposals` (POST). **ADMIN** : rejeté à la *proposition* (pas d'identité clinique) mais conserve l'*écriture directe* — bypass PHI V1 assumé (`access-control.ts`, levé V4/F1). |

## 7. Invariants transverses fail-closed

- Aucune dose calculée sur une heure non couverte par la config (voir §5).
- Un mode de traitement inconnu ne débloque **jamais** l'édition insuline.
- Toute donnée insuffisante (AGP/TIR/BGM sous les planchers §3) → **non publiée** plutôt qu'affichée trompeuse.
- Toute proposition hors `CLINICAL_BOUNDS` → **rejetée à la création** (pas seulement à l'application).

---

*Réviser ce document à chaque ajout/modification de constante, intervalle, seuil ou règle
métier diabète (obligation `CLAUDE.md`). Source de vérité = code ; valeurs verrouillées par
`tests/unit/clinical-bounds.test.ts`.*
