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
| **Direction de risque (US-2649b)** | La revue médecin **surface** le sens du risque (`deriveRiskDirection`, `src/lib/insulin/risk-direction.ts`) plutôt que de le masquer : « plus d'insuline » (hausse basale/dose OU baisse ISF/ICR) = **risque hypo** (signalé en ambre) ; sens inverse = hyper. |
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

### Invariant `baselineMoved` — compare-and-swap à l'acceptation (US-2649b)

Une proposition stocke `proposedValue` en valeur **absolue**, calculée sur `currentValue`
(snapshot de la base au moment de la création). À l'`accept()` avec `applyImmediately`, si la
valeur **courante réelle** du créneau diffère du snapshot (édition médecin, autre proposition
acceptée entre-temps), appliquer la valeur absolue **sur-corrige** (ex. base descendue à
0,7 U/h pour une hypo, proposition absolue 1,2 → +71 % en direction hypo).

- **Garde-fou** : `adjustmentService.accept` re-lit la base live (`liveCurrentValue`) et lève
  **`baselineMoved`** (fail-closed, rollback) si `live ≠ snapshot` → HTTP **409**. Le créneau
  disparu (`live === null`) est laissé aux gardes d'apply (`…SlotNotFound`).
- **UI de revue** (`ReviewClient`) : si `live ≠ snapshot` ou `live === null`, l'acceptation est
  **bloquée** (bouton désactivé) + alerte rouge (`role="alert"`) ; les badges %variation/risque
  (anchés au snapshot) sont **masqués** (mental model faux). Le médecin doit régénérer une
  proposition sur la vraie base. Source : `src/lib/services/adjustment.service.ts`.

### `PATIENT_PROPOSAL_COOLDOWN_HOURS` — cooldown anti-churn des propositions patient (US-2650)

| Constante | Valeur | Sens clinique | Source |
|---|---|---|---|
| `PATIENT_PROPOSAL_COOLDOWN_HOURS` | **24 h** | Délai minimal entre deux propositions **PATIENT** sur le **même (paramètre × créneau)**. Borne la **fréquence** là où `PATIENT_MAX_CHANGE_PERCENT` (10 %) borne l'**amplitude** → plafonne le %/créneau/jour (anti-ratchet). 24 h = unité de décision d'une titration (l'effet d'un changement ISF/ICR/basal n'est pas jugeable en < 24 h). | `src/lib/clinical-bounds.ts` |

- **Décompte** : depuis la **résolution** de la dernière proposition (`reviewedAt`, sinon `createdAt`), **tous statuts** confondus (y compris `accepted`).
- **Périmètre** : **PATIENT uniquement** (médecin/infirmier non gatés — ils gèrent la titration).
- **Garde** : niveau **service** (`adjustmentService.createProposal`), pas d'index DB (course à faible enjeu ; tout reste gaté médecin, ADR #13). Erreur `patientProposalCooldown` → HTTP **429** ; l'UI oriente vers la messagerie pour l'urgent (canal proposition = non urgent).
- **Sécurité clinique** : ne bloque **aucun soin urgent** (jamais auto-appliqué ; le médecin peut toujours proposer/appliquer pendant le cooldown du patient ; les autres créneaux restent proposables).

> **Suivi (dormant)** — Ancrage `expired` : une proposition `expired` n'a pas de `reviewedAt`, le
> cooldown retombe alors sur `createdAt`. Sans impact aujourd'hui (aucun code ne fait passer une
> `AdjustmentProposal` à `expired` — seul `emergency.service` écrit ce statut). À l'implémentation
> d'un **job d'expiration** des propositions : écrire un timestamp d'expiration et y ancrer le cooldown.

### `MAX_CHANGE_PERCENT` + frontière MDR non-insuliné (US-2651)

| Constante | Valeur | Sens clinique | Source |
|---|---|---|---|
| `MAX_CHANGE_PERCENT` | **± 20 %** | Cap de variation **MOTEUR** (algorithme) : toute proposition auto-générée est clampée à ± ce %. Source unique (était en dur dans `proposal-algorithm.ts`). Le cap PATIENT (10 %) reste strictement plus strict. | `src/lib/clinical-bounds.ts` |

- **Frontière dispositif médical (MDR / IEC 62304)** : `adjustmentService.createProposal` **refuse** toute
  proposition de **dose** si le mode de traitement dérivé serveur est **`nonInsulin`** → `nonInsulinNoDose`
  (HTTP 422). Un patient non insuliné relève d'un **flag d'orientation** (« à revoir en consultation »),
  jamais d'une `AdjustmentProposal`. Fail-closed : le mode est **dérivé serveur** (`resolveTreatmentMode`,
  US-2647) et un DT1 n'est **jamais** classé `nonInsulin`.

### Algorithme de génération des propositions

Le fonctionnement de l'algorithme de **calcul des propositions d'ajustement** (analyseurs ISF/ICR/basal,
constantes moteur, routage multi-mode a/b/c, frontière MDR, chaîne génération→validation) est décrit
dans son document dédié : **[`algorithme-propositions-ajustement.md`](./algorithme-propositions-ajustement.md)**.

### Dose fixe — analyseur mode (b) (US-2651)

| Constante | Valeur | Sens clinique | Source |
|---|---|---|---|
| `FIXED_DOSE_MAX_CHANGE_PERCENT` | **± 10 %** | Cap moteur d'une proposition de dose fixe (plus strict que ± 20 % basal/bolus : titration plus lente). | `src/lib/clinical-bounds.ts` |
| `FIXED_DOSE_DELIVERY_INCREMENT_U` | **0,5 U** | Incrément délivrable (demi-unité stylo) ; arrondi de la proposition ; pas nul → non actionnable. | idem |
| `FIXED_DOSE_COOLDOWN_HOURS` | **72 h** | Cooldown moteur entre 2 propositions de dose fixe sur le même moment (effet jugeable sur ≥ 3 j). Appliqué au **câblage** du générateur. | idem |

`analyzeFixedDose` retient le **plus petit** de ± 10 % et ± `FIXED_DOSE_MAX_DELTA_U` (2 U), plancher
`FIXED_DOSE_MIN` (0,5 U). Direction = dose **directe** (haut → hausse). Détail : `algorithme-propositions-ajustement.md` §4-5.

**Garde-fous `analyzeFixedDose` (validés medical US-2651)** :
- **Garde hypo** : aucune proposition de **HAUSSE** en présence d'hypo contre-indiquante ; la **baisse**
  reste permise (sens sûr). Depuis US-2651, cette garde est **commune aux 4 analyseurs** via
  `hypoBlocksProposal` et couvre **le sévère (1 relevé) ET le niveau-1 récurrent (≥ 2)** — voir la
  section « Garde HYPO des analyseurs » ci-dessous (la description sévère-only ici est historique).
- **Garde entrée** : dose courante `null`/non finie/< `FIXED_DOSE_MIN` → aucune proposition (fail-closed).
- **Blind spot connu** : une dose ≤ ~5 U est structurellement non ajustable (10 % < 0,5 U d'incrément) →
  le moteur reste silencieux (le médecin ajuste manuellement). Fail-safe, non bloquant.
- **Contrat d'entrée** : `postGlucoseGl` = glycémie d'évaluation du moment (PPG 2 h pour un moment
  prandial ; à jeun/pré-repas pour une dose de type basal) — à câbler correctement dans le générateur.

### Garde HYPO des analyseurs (US-2651, validé medical)

Les **4 analyseurs** (`analyzeIsfSlot`/`analyzeIcrSlot`/`analyzeBasalTrend`/`analyzeFixedDose`) refusent
toute proposition en **direction « plus d'insuline effective »** (risque hypo) si un relevé de la
fenêtre est en **hypo SÉVÈRE** (< `GLYCEMIA_THRESHOLDS_MGDL.SEVERE_HYPO` = 0,54 g/L) — la moyenne peut
masquer une hypo intermittente. Helper commun `hypoBlocksProposal`, direction dérivée de
`deriveRiskDirection` (hausse basale/dose fixe **ou** baisse ISF/ICR = « hypo »). Le sens sûr (moins
d'insuline) reste permis. Ferme le prérequis avant câblage du générateur mode a.

**Déclencheurs (validé medical)** :
- **Hypo sévère (niveau 2, < 0,54 g/L)** : **un seul** relevé suffit (urgence clinique).
- **Hypo légère (niveau 1, < 0,70 g/L)** : freine aussi mais seulement si **récurrente** —
  ≥ `HYPO_LEVEL1_RECURRENCE_MIN` (= 2) relevés dans la fenêtre (évite la sur-suppression sur un
  événement isolé, très courant). Choix délibéré : le niveau 2 seul sur-protégerait moins mais
  raterait des hypos légères répétées ; le comptage niveau-1 les capture sans bruit.
- **Contrat basal (Somogyi)** : `analyzeBasalTrend` ne capte l'hypo nocturne masquée que si
  `fastingValues` inclut le **nadir CGM nocturne** (pas seulement le pré-petit-déj) — précondition
  JSDoc à respecter par le générateur au câblage.

### Générateur ICR nocturne — deadband post-prandial & nadir (US-2651, validé medical)

Constantes d'assemblage du **générateur ICR** (spec : `docs/clinical-logic/algorithme-propositions-ajustement.md` §5ter) :

| Constante | Valeur | Sens clinique |
|---|---|---|
| plafond post-prandial (réutilisé) | `getCgmDefaults(pathologie/grossesse).ok` = **1,80** g/L adulte / **1,40** GD-grossesse | PPG 2 h moyenne au-dessus → **baisse** d'ICR (plus d'insuline). |
| `POSTPRANDIAL_TITRATION_LOW_GL` | **1,0** g/L | PPG 2 h moyenne en dessous → **hausse** d'ICR (moins d'insuline). Entre les deux → aucune proposition. |
| `POSTPRANDIAL_TITRATION_LOW_PREGNANCY_GL` | **0,9** g/L | Borne basse resserrée en grossesse (`pregnancyMode` ou GD). |
| `ICR_PREMEAL_MIN_GL` / `ICR_PREMEAL_MAX_GL` | **0,70 / 1,40** g/L | Bande pré-repas d'exploitabilité ICR : hors bande → bolus avec correction (au-dessus) ou sous-dosage (en dessous) → repas exclu (anti mis-attribution). |
| `ICR_PREMEAL_MAX_PREGNANCY_GL` | **1,10** g/L | Borne haute pré-repas **grossesse** (cible pré-repas plus basse ~0,95 → 1,30-1,40 y est déjà élevé). Borne basse 0,70 inchangée. |
| `POSTMEAL_NADIR_WINDOW_MIN` | **300** min | Fenêtre de recherche du **nadir** post-prandial fourni à la garde hypo (le nadir d'un analogue rapide tombe après le point PPG 2 h). |

**Pourquoi PAS la cible à jeun** : une PPG 2 h est physiologiquement au-dessus de la glycémie à jeun ;
prendre la cible à jeun (~1,0 g/L) comme référence proposerait des baisses d'ICR systématiques (plus
d'insuline) chez des patients bien contrôlés → **emballement hypo**. Le deadband asymétrique évite à la
fois l'emballement et l'érosion du bon contrôle.

> **Limite connue — basale STYLO/MDI non gérée par le générateur** (validé avec l'utilisateur, US-2651).
> La titration basale automatique ne couvre que `BasalConfigType = pump` (débit U/h → `pumpBasalSlotId`,
> `AdjustableParameter = basalRate`). Les patients en `single_injection` (dose journalière, type Lantus)
> ou `split_injection` (matin/soir, type Levemir) — basale en **U**, pas U/h — ne reçoivent **aucune**
> proposition basale (leurs ISF/ICR restent proposés). Combler ce trou (paramètre `basalDose` dédié +
> variante d'analyseur en U/jour + bornes stylo + ciblage de persistance) = **slice dédiée du build**.
> Détail : `algorithme-propositions-ajustement.md` §4.3.

> **Limite connue — régime hybride pompe + compléments bolus stylo** (validé avec l'utilisateur, US-2651).
> `InsulinDeliveryMethod` (pump/manual) est un flag patient unique (`InsulinTherapySettings`) : pas de
> modèle hybride. Le journal repas lit `DiabetesEvent.bolusDose` sans méthode de délivrance → un
> complément stylo n'est pas distinguable (et vu seulement s'il est loggué). Effet = **sous-détection
> fail-safe** : un complément stylo qui corrige la PPG masque une déficience du ratio pompe (ICR),
> et une correction stylo hors calculateur échappe à l'analyse ISF (`BolusCalculationLog`). Risque de
> sur-proposition faible (≥3 repas + moyenne + garde hypo). À gérer via une méthode de délivrance
> **par bolus** (pas par patient). Détail : `algorithme-propositions-ajustement.md` §5ter.

> **Suivis build générateur (US-2651, tracés depuis les revues #669)** :
> - **Nadir ISF** — `analyzeIsfSlot` a le même angle mort que l'ICR (une correction rapide fait son
>   creux à ~3-4 h, après la glycémie post-correction ponctuelle). Contrat JSDoc ajouté ; le **champ
>   `nadirGl`** par correction (symétrique de `analyzeIcrSlot`) reste à câbler dans la **slice ISF**.
> - **Assainissement des zéros CGM** — un `0`/artefact sous le plancher capteur (`CRITICAL_LOW` 0,40 g/L)
>   dans `nadirGl` supprimerait une proposition légitime (fail-safe mais érosion qualité). La **slice
>   assemblage** (qui peuplera `nadirGl`) doit **filtrer** les valeurs non physiologiques AVANT
>   `analyzeIcrSlot` — pas dans l'analyseur (qui traite `0` comme une hypo réelle, à raison).

> **Suivi build — détection resucrage (US-2651, tracé depuis la revue medical #670)** : la fenêtre nadir
> (`nadirWindowEnd`) se termine au prochain apport glucidique. Un **resucrage** d'hypo (glucide pris à
> cause d'une hypo) peut donc **tronquer la fenêtre AVANT le vrai creux** → la garde hypo sous-protège
> (autorise une baisse d'ICR = plus d'insuline). Atténué par la pente descendante captée en CGM 5 min.
> **À faire** : inférer un resucrage (petit glucide, sans bolus, glycémie précédente basse) et le traiter
> comme un **signal d'hypo** (pas une simple borne). Détail : `algorithme-propositions-ajustement.md` §5ter.

> **Suivi US-2653 — dé-escalade sur hypos récurrentes** : le générateur décide de proposer sur la
> MOYENNE PPG (deadband) mais la garde hypo agit sur le NADIR. Un patient bon en moyenne mais avec
> hypos post-repas récurrentes ne reçoit aucune proposition (sous-action, sens sûr). US-2653 ajoutera
> un déclencheur « nadirs récurrents → moins d'insuline » transverse aux 4 analyseurs. Cf.
> `algorithme-propositions-ajustement.md` §5ter.
