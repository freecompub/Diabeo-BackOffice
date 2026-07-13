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

> 📄 **Guide illustré destiné aux médecins / infirmières / patients** — le processus complet des
> **propositions d'ajustement d'insuline** (parcours patient/soignant/médecin, algorithme état par état,
> cas passants/bloquants avec graphiques, constantes justifiées référence *vs* décision interne, glossaire) :
> [`proposition-insuline.html`](proposition-insuline.html) (US-2659, validé `medical-domain-validator`).
> Fidèle au code, sans extrapolation ; à ouvrir dans un navigateur.

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
| `MDI_BASAL_MIN_U` | 0.5 | U | Plancher de sanité basale **stylo (MDI)** (US-2659 ; = `FIXED_DOSE_MIN`) |
| `MDI_BASAL_WARN_U` | 80 | U | Seuil d'**avertissement** (non bloquant) basale stylo (US-2659 ; = `FIXED_BASAL_WARN_U`) |
| `MDI_BASAL_STEP_U` | 2 | U | Composante U du pas de **hausse** treat-to-target (`max(+2 U, +10 %)`) (US-2659) |
| `MDI_BASAL_STEP_PERCENT` | 10 | % | Composante % du pas de hausse `max(+2 U, +10 %)` (≠ dé-escalade, même valeur) (US-2659) |
| `MDI_BASAL_MAX_DELTA_U` | 4 | U | Cap absolu de variation par ajustement (= réduction sur hypo) (US-2659) |
| `MDI_BASAL_MAX_CHANGE_PERCENT` | 20 | % | Cap % (ADA 10–20 %) — la borne la plus protectrice l'emporte (US-2659) |
| `MDI_BASAL_DELIVERY_INCREMENT_U` | 1 | U | Résolution stylo (défaut fail-closed ; 0,5 si demi-unité) — **jamais** l'incrément pompe (US-2659) |
| `MDI_BASAL_COOLDOWN_HOURS` | 72 | h | Anti-cliquet basale stylo **classique** (glargine U100 24 h / detemir 20 h ; steady state 3–4 j) (US-2659) |
| `MDI_BASAL_COOLDOWN_HOURS_ULTRALONG` | 96 | h | Anti-cliquet basale stylo **ultra-longue** (dégludec ~42 h, glargine U300 ~36 h ; steady state 4–5 j, ~91 % à 3,8 t½). Empêche l'empilement multi-titrations, Risk #1 (US-2662, validé medical) |
| `ULTRALONG_BASAL_DURATION_MIN_H` | 30 | h | Seuil **inclusif** (`InsulinCatalog.typicalDurationHours ≥ 30`) séparant ultra-longues {dégludec, U300} des classiques {U100, detemir} (US-2662) |
| `MDI_BASAL_FASTING_DEADBAND_UP_GL` | 0.30 | g/L | Demi-bande **haute** de la hold zone (hausse si `avg > T+0,30`) — anti-overshoot du pas fixe (US-2659 S1) |
| `MDI_BASAL_FASTING_DEADBAND_DOWN_GL` | 0.20 | g/L | Demi-bande **basse** (baisse treat-to-target si `avg < T−0,20`) — plus serrée, sens sûr (US-2659 S1) |
| `MDI_BASAL_PATIENT_MAX_DELTA_U` | 2 | U | Cap absolu d'une **demande PATIENT** de baisse basale stylo (= moitié du cap moteur ; ≤ min(10 %, 2 U)) (US-2659 S3) |

> ⚠️ **Mise à jour 2026-07-10** : les constantes d'auto-application experte gouvernée ont été **supprimées** du code (US-2657 retirée). Les éditions patient ne génèrent désormais qu'une **proposition** (jamais auto-application). Voir « Niveau de maturité du patient » ci-dessous pour la maturité (JUNIOR/INTERMEDIATE/CONFIRME) — elle gouverne les **capacités d'édition** (valeurs vs créneaux), pas une voie d'auto-application.

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
| **Incrément basal (US-2648b)** | Un débit basal doit être **délivrable** = multiple de `PUMP_BASAL_INCREMENT` (0,05 U/h), sinon non programmable sur la pompe. Source unique : **`isDeliverableBasalRate()`** (`clinical-bounds.ts`), appliquée à la **proposition** (`validateProposedValue`) et au **remplacement groupé basal** (`replacePumpSlotSet`/`assertValidPumpSlotSet`, US-2657 — unique voie d'écriture basale). Miroir UI : `step="0.05"`. |
| **Remplacement GROUPÉ basal (US-2657, grouped-only)** | L'édition des créneaux basaux se fait **exclusivement en bloc** via `PUT /api/insulin-therapy/basal-config/pump-slots` → `replacePumpSlotSet`. Validation `assertValidPumpSlotSet` (`insulin-therapy.service.ts`) : jeu non vide, aucun créneau de durée nulle, débit ∈ `[BASAL_MIN, BASAL_MAX]` **ET** délivrable, **no-overlap** (double délivrance = sur-dosage) et **no-gap STRICT 24 h** (une pompe délivre en permanence ; un trou = fenêtre sans basale = risque hyper/DKA). ⚠️ Le no-gap basal est un invariant **plus strict** que l'ancienne voie par-créneau (qui tolérait les trous) — *à confirmer `medical-domain-validator`*. Remplacement atomique (`deleteMany`+`createMany`), verrou non bloquant `(patient × basal)`, supersède les propositions basales `pending`. **Garde d'intégrité du mode** (revue #710) : refus `basalConfigNotPump` si le patient n'est pas en mode pompe (un patient MDI a aussi une `basalConfiguration` — ne pas y attacher de créneaux pompe). Les écritures par-créneau (`POST`/`PATCH`/`DELETE`) sont **retirées** (voir ADR #26). |
| **Anti-spam** | 1 proposition `pending` max par (patient, paramètre, créneau) — index unique partiel `adjustment_proposals_one_pending_per_slot`. |
| **Exclusion mutuelle PAR CLASSE D'ORIGINE grouped ⇄ par-valeur (US-2663 S2b, raffiné S3b-0a / D2)** | À travers **les DEUX modèles** (`SlotSetProposal` groupé + `AdjustmentProposal` par-valeur), la supersession à la création est **PAR CLASSE D'ORIGINE** : une proposition **HUMAINE** (patient/infirmier/médecin) supersède les pending **d'origine humaine** (`source ≠ algorithm`) du paramètre ; une proposition **MOTEUR** (`source = algorithm`) supersède les pending **d'origine algorithme** (`source = algorithm`). Helper unique `supersedeGroupedPending(source)` + `createSetProposal` (filtre `originFilter`). **Décision produit D2** : le moteur **ne supersède JAMAIS** une demande humaine → une proposition MOTEUR et une demande HUMAINE **COEXISTENT** sur le même paramètre (le médecin voit les DEUX ; l'algorithme est la « 2ᵉ proposition »). Invariant garanti EN BASE par l'index partiel discriminé `slot_set_proposals_one_pending_per_param_origin` (`(patient_id, parameter_type, (source='algorithm')) WHERE status='pending'`) = **au plus 1 pending humain + 1 pending algorithme** par paramètre. Supersession **programmatique** (`reviewedByUserId: null`), compteur `supersededGroupedCount` audité ; hors ISF/ICR = no-op. Fail-safe : CAS d'ensemble S1 (`baselineMoved`) bloque l'acceptation d'un jeu périmé. **Exception — écriture DIRECTE de config** (`replaceSlotSet`, apply DOCTOR/ADMIN hors proposition) : supersède **TOUTES** les origines pending du paramètre (humaines ET algorithme), **volontairement** — une écriture de config est **autoritaire** et rend toute proposition pending périmée (contrairement à la *création d'une proposition*, qui elle coexiste par classe). **Indice UI (US-2663 S3b-0b)** : quand une coexistence D2 existe, l'écran de revue (`GroupedProposalReview`) affiche un bandeau `role="status"` nommant la provenance de la proposition sœur — calculé **serveur** (`deriveCoexistsWith`, `src/lib/insulin/proposal-coexistence.ts`, pur), jamais côté client. |
| **Rationale MOTEUR sur proposition groupée (US-2663 S3b-0a, affichée S3b-0b)** | Une `SlotSetProposal` d'origine `algorithm` porte une **rationale PAR CRÉNEAU CHANGÉ** (`SlotSetProposal.rationale` JSON : `{ startHour, reason, confidence, supportingEvents, changePercent?, averageObservedValue?, analysisPeriod? }`) — **requise** à la création (`rationaleRequired` sinon), NULL pour les propositions humaines. **Raison (medical HIGH)** : le médecin supervisant une recommandation de dose algorithmique doit voir le POURQUOI (`reason`), la CONFIANCE et le VOLUME d'observations, sinon il décide sur un diff nu — et un jeu peut mêler une **dé-escalade de SÉCURITÉ** et une escalade de confort de même delta visuel. Decision-support + traçabilité HDS de la recommandation (les métriques que `AdjustmentProposal` portait par créneau). Type : `SlotRationale` (`src/lib/insulin/grouped-proposal.ts`). **Affichage (S3b-0b, `GroupedProposalReview`)** : sur chaque créneau **CHANGÉ non supprimé**, colonne « Motif » = libellé `reason` (i18n `review.reason<X>`, exhaustif sur `AdjustmentReason`, neutre/factuel) + badge de confiance + volume d'observations (« N obs. »), **côte à côte** avec la **direction de risque** (`deriveRiskDirection`, toute provenance) — jamais affichée pour une proposition humaine (`rationale === null`). Parse défensive serveur fail-closed (`page.tsx` `parseRationale`) : JSON illisible ⇒ rationale omise, jamais une valeur inventée. |
| **Éditabilité par mode (US-2648b, +US-2657)** | Capability `deriveEditCapability(role, modeResult, maturityLevel)` : `canEditDirect` (DOCTOR/ADMIN), `canPropose` (DOCTOR/NURSE/patient, ADMIN exclu), **`canEditSlots`** (restructuration — DOCTOR/ADMIN/NURSE oui ; patient VIEWER gaté maturité, JUNIOR = non), `maturityLevel` ; `editableParameters` = ISF/ICR/basal **si** `basalBolus` **ET** `coherent`, sinon **vide** (fail-closed). Pilote l'UI ; n'autorise rien (RBAC = routes). Source : `src/lib/insulin/edit-capability.ts`. |
| **Direction de risque (US-2649b)** | La revue médecin **surface** le sens du risque (`deriveRiskDirection`, `src/lib/insulin/risk-direction.ts`) plutôt que de le masquer : « plus d'insuline » (hausse basale/dose OU baisse ISF/ICR) = **risque hypo** (signalé en ambre) ; sens inverse = hyper. |
| **Frontière dispositif médical** | Mode non-insuliné : **aucune posologie** médicamenteuse orale/GLP-1 proposée (`ClinicalReviewFlag` = orientation, jamais une dose). |
| **Divulgation patient des propositions (frontière MDR, validé medical — vue unifiée étape 1)** | Un **PATIENT** ne voit **QUE ses propres demandes** (`source = patient`). Il ne voit **jamais** une proposition non validée d'origine **soignante/algorithmique** (`nurse`/`algorithm`/`doctor`) : lui montrer une **dose non encore validée** l'exposerait à une **auto-injection** avant l'arbitrage médecin (ADR #13). **Restriction imposée SERVEUR** (`adjustmentService.list({ sources })` **ET** `summary({ sources })`, forcées à `["patient"]` pour un VIEWER dans `GET /api/adjustment-proposals` **et** `.../summary` — jamais depuis la query) : un filtre uniquement côté UI ne serait **pas** une frontière (la donnée transiterait dans le navigateur du patient). Le `summary` est aligné pour ne pas divulguer l'**existence** (métadonnée) d'une proposition non validée d'un tiers. **La même frontière couvre l'ACCUSÉ/RÉPONSE (US-2665)** : `POST/PUT /api/team/proposal-ack/[proposalId]` filtre aussi `source = patient` pour un VIEWER (`viewerProposalSources`, imposé serveur) — un patient connaissant l'UUID d'une proposition tierce de son dossier ne peut ni l'acquitter ni y répondre. Réponse **404 uniforme** (tierce / autre dossier / inexistante → indiscernables : non énumérant) ; un pro (pas de dossier patient propre) reste **403** (inchangé). **Rendu patient** : aucun badge de decision-support clinicien (`highDoseWarning`/risque hypo/`baselineMoved`/`changePercent`), **bandeau non-dismissible « en attente de validation médecin — ne modifiez pas vos doses »**, ton **non-prescriptif**, config active affichée séparément (statu quo). Le **clinicien** (NURSE/DOCTOR) voit **toutes** les provenances, y compris les demandes patient. *Montrer au patient une proposition `nurse` = décision produit distincte (revue MDR/DPIA + masquage de la valeur) — hors périmètre.* |
| **RBAC édition / proposition (US-2648a)** | Écriture **directe** de la config insuline = **DOCTOR** (autorité clinique). NURSE / patient → **proposition** `POST /api/adjustment-proposals` (validée par un médecin). ADMIN rejeté. Rôle proposeur dérivé de la **session** ; accès via `resolvePatientId` (VIEWER→son dossier / pro→`canAccessPatient`) ; réponse sans `proposerComment`. Routes : `src/app/api/insulin-therapy/*` (DOCTOR) + `src/app/api/adjustment-proposals` (POST). **ADMIN** : rejeté à la *proposition* (pas d'identité clinique) mais conserve l'*écriture directe* — bypass PHI V1 assumé (`access-control.ts`, levé V4/F1). |
| **Front grouped-only (US-2657, migration front)** | Suite au retrait serveur des écritures par-créneau, l'édition DOCTOR directe côté fiche patient passe **exclusivement** par les éditeurs de GROUPE : `InsulinSlotSetDialog` (ISF/ICR, heure entière `[0,23]`, US-2656) et `InsulinBasalSlotSetDialog` (basal, temps `"HH:MM"` minute-précis + `<input type="time">`, US-2657) — les deux `PUT` le jeu **complet**. `InsulinDirectEditDialog` (édition par-créneau `PATCH`, US-2648b) est **retiré** ; le bouton « Proposer » par-créneau (NURSE/patient, `InsulinProposalDialog` → `POST /api/adjustment-proposals`) est **inchangé** (route non retirée, hors périmètre de ce retrait). Logique pure partagée : `insulin-slot-set-edit.ts` (ISF/ICR **et** basal — deux jeux de fonctions parallèles, modèle de créneau non superposable). La page réglages autonome du médecin (`/insulin-therapy`) mute l'état ISF/ICR localement à l'ajout/édition et envoie UN `PUT` par paramètre **réellement modifié** à l'enregistrement (pas de `PUT` sur un paramètre non touché — évite un rejet `emptySlotSet` sur un patient sans ISF/ICR configuré). |
| **Disposition groupée + snapshot de base + CAS d'ensemble (US-2663 épic, S0+S1+S2)** | Toute proposition d'ajustement — quelle que soit l'origine (patient/infirmière/médecin/**algorithme**), même si un seul créneau change — porte la **disposition ENTIÈRE** du levier (jeu de créneaux complet). Modèle unique `SlotSetProposal` (généralisé) ; typage cible = **union discriminée par levier** (`src/lib/insulin/grouped-proposal.ts` : ISF/ICR `startHour`·g/L·U ou g/U ; basale pompe `startTime`·U/h ; basale stylo `basalDoseKind`·U totales ; dose fixe `moment`·U). **`baselineSlots`** = snapshot de la base **PAR CRÉNEAU à la génération** (`captureBaselineSlots`, même encodage que `proposedSlots`). `source` dérivé **serveur** (ADR #27, jamais du body). **Garde-fou MDR — CAS d'ensemble fail-closed (S1, LIVRÉ)** : à l'acceptation, **sous verrou** `tryLockInsulinSlots` (lecture LIVE atomique, pas de TOCTOU), la base actuelle DOIT être identique au snapshot (`assertBaselineUnchanged`, `src/lib/insulin/slot-baseline-cas.ts` ; appariement par clé `startHour`, `mealLabel` non dosant **ignoré**). Toute dérive (valeur/borne/structure) → **`baselineMoved`** (409, rollback → reste `pending`, à régénérer) : n'écrase jamais un ajustement MÉDECIN concurrent (ex. baisse post-hypo). Snapshot `null` (legacy pré-S0) → **`baselineMissing`** (409, fail-closed : jamais d'apply sur une base non certifiable). Sémantique S1 = **rejet d'ensemble** (toute divergence rejette la disposition entière) ; diff-merge valeur-seule différé (S1bis). Chemin **DOCTOR direct** (`replaceSlotSet` sans `expectedBaseline`) = pas de CAS (écrasement explicite assumé). **Revue médecin (S2, LIVRÉ)** : `SlotSetProposal` **PENDING** surfacée sur `/patients/[id]/review` (`GroupedProposalReview`), jusqu'ici invisible à la revue (seules les `AdjustmentProposal` par-valeur y apparaissaient). `slotSetProposalService.listPendingForReview` expose `baselineSlots` (contrairement à `listSetProposals`, qui l'omet pour la liste patient — minimisation) : usage DOCTOR-gated légitime pour le decision-support. Diff (créneau PROPOSÉ vs valeur LIVE actuelle) pré-calculé **serveur** (`src/lib/insulin/slot-diff.ts`, `diffSlots`/`hasStructuralChange`) ; lignes divergentes surlignées à l'affichage. Variante NON-throwing du CAS (`isBaselineUnchanged`, `slot-baseline-cas.ts`) affiche un bandeau d'AVERTISSEMENT si la base a dérivé depuis la génération — **non bloquant à l'affichage** (le blocage réel reste le 409 `baselineMoved`/`baselineMissing` à l'acceptation, ci-dessus) : prévient le médecin AVANT une tentative d'acceptation vouée à l'échec. *S3 moteur groupé + re-source anti-cliquet, S4 voie manuelle, S5 retrait par-valeur + iOS à suivre.* |

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
| `ENGINE_DEESCALATION_COOLDOWN_HOURS` | **72 h** | Anti-ratchet cooldown : aucune **dé-escalade à magnitude fixe** (−10 % ICR/ISF/basal, −min(10 %, 2 U) fixedDose) sur un `(patient × paramètre × créneau/moment)` dont l'ACCEPTÉE précédente < 72 h. Prévient l'accumulation multi-itérations avant que l'effet soit observable (≥ 3 j). Appliqué au câblage du générateur (tous 4 leviers). | idem |

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

### Dé-escalade sur hypos récurrentes (US-2653 complète, validé medical)

Déclencheur **indépendant du deadband** : des hypos récurrentes (nadirs) doivent proposer **moins d'insuline** 
même si la moyenne est « normale ». **Extension complète à 4 leviers** : chacun nourri par sa **propre source de nadir** 
(jamais cross-fed).

| Constante / règle | Valeur | Sens clinique |
|---|---|---|
| `HYPO_DEESCALATION_PERCENT` | **+10 %** | Pas fixe pour ICR/ISF/basal : magnitudes pures, scalées par clamp ±20 %. Persistance titre **cumulativement**. Pour fixedDose, −min(10 %, 2 U), snap 0,5 U. |
| `recurrentPostMealHypo` / `recurrentPostCorrectionHypo` / `recurrentNocturnalHypo` | **≥ 2 nadirs < 0,70** parmi ≥ 3 | « Récurrent » = corroboration exigée. Plus strict que la garde (qui tire sur 1 sévère isolé) → un artefact capteur seul ne réduit pas l'insuline. **Source distincte par paramètre** : repas/corrections/nocturne. |
| `SEVERE_HYPO_GL` | **0,54 g/L** | Hypo sévère (niveau 2, < 0,54) : un **seul** relevé suffit, tous les analyseurs refusent une direction hypo, même sans récurrence. |

**Matrice per-créneau / per-moment — moyenne × hypo récurrente** :

**ICR** (nadir source : post-repas isolés) :
- `> plafond` & non → **BAISSE ICR** (deadband) 
- `> plafond` & **récurrent** → **flag `highVariabilityPostMeal`** (pas de dose)
- **dans la bande** & récurrent → **HAUSSE ICR +10 %** (cœur US-2653)
- dans la bande & non-récurrent → rien
- `< borne basse` → **HAUSSE** (deadband)

**ISF** (nadir source : corrections post-correction propres) :
- `> cible correction` & **récurrent** → **flag `highVariabilityPostCorrection`** (pics + creux post-corr : pas d'automatisme)
- `> cible` & non-récurrent → **HAUSSE ISF +10 %** (corrections plus douces)
- **dans la bande** & récurrent → **HAUSSE ISF +10 %**
- `< cible` (sur-correction) → **BAISSE** (deadband normal)
- **single severe** → **flag** (sûreté)

**Basal** (nadir source : nadirs nocturnes) — **Cas Somogyi (REJETÉ)** :
- `fasting HIGH (>cible)` & **recurrent nocturnal hypo** → **flag `nocturnalHypoHighFasting`** (**JAMAIS baisse auto**)
  - **Rationale** : phénomène de l'aube domine cliniquement le rebond Somogyi en CGM moderne. Une baisse basal laisse 
    la glycémie à jeun haute non traitée → risque intolérable sans contexte métabolique précis. Médecin juge. 
    Fail-closed : proposition refusée.
- `> cible` & non-récurrent → **HAUSSE BASAL +20 %** (deadband, snappé 0,05 U/h)
- **dans la bande** & recurrent nocturnal hypo → **BAISSE BASAL −10 %** (moins d'insuline nuit, hypos moins profondes)
- dans la bande & non-récurrent → rien
- **single severe nocturnal** → **flag** (sûreté)

**FixedDose** (nadir source : creux pré-dose BGM par moment, décalage Option B) :
- `> cible pré-dose` & **récurrent** (≥2 creux < 0,70 / ≥3 relevés) → **flag `highVariabilityFixedDose`** (variabilité exige revue)
- `> cible` & non-récurrent → **BAISSE DOSE −min(10 %, 2 U)**, floor 0,5 U, snap 0,5 U
- **dans la bande** & récurrent → **BAISSE DOSE −min(10 %, 2 U)**
- `< cible` (BGM baisse) → **HAUSSE** (deadband normal)
- dose déjà à floor ou pas réductible → **flag** (non-actionnable)
- **single severe hypo pré-dose** → **flag** (sûreté)

**Anti-ratchet (tous 4 leviers, ⚠️ 2026-07)** :
`ENGINE_DEESCALATION_COOLDOWN_HOURS = 72 h` appliqué au générateur : aucune dé-escalade à magnitude fixe 
(`+10 % ICR/ISF/basal`, `−min(10 %, 2 U) fixedDose`) si l'ACCEPTÉE précédente pour le même 
`(patient × paramètre × créneau/moment)` < 72 h. La **dé-escalade proportionnelle deadband** (ex. clampée ±20 %) 
n'est pas gatée (self-limiting par les bornes cliniques). Prévient l'accumulation itérative 10%+10%+10% avant 
jugement de l'effet sur ≥ 3 j CGM/BGM.

**Re-source de l'anti-cliquet — acceptations GROUPÉES incluses (US-2663 S3a, garde-fou #4)** : le « dernier
changement accepté » (`lastAcceptedChangeAt`, `proposal-generator.service.ts`) considère désormais **les DEUX
modèles** — `AdjustmentProposal accepted` (par-valeur, par créneau) **ET** `SlotSetProposal accepted` (d'ensemble
ISF/ICR, sans granularité créneau car elle remplace tout le jeu) — et retient le **plus récent**. Sans ce terme,
une édition groupée acceptée (patient ISF/ICR aujourd'hui, moteur groupé en S3+) était **invisible** au cooldown,
qui pouvait empiler une dé-escalade juste après. Hors ISF/ICR (basalRate/fixedDose) : aucune `SlotSetProposal`,
terme nul. Prérequis de la bascule moteur groupé (S3+).

**Porte d'observation POST-changement (fix Q6a, 2026-07)** — invariant de sécurité complétant le délai :
une dé-escalade à magnitude fixe ne se juge **que sur les observations datées APRÈS le dernier changement
accepté** (`dayIso > cutoff`, `cutoff` = jour local du `reviewedAt` de l'ACCEPTÉE précédente). Le délai des
72 h seul ne suffit pas : sans ce filtre, une récurrence d'hypos **périmées** (antérieures au changement)
re-déclencherait une baisse alors que l'effet du dernier ajustement n'a pas encore été observé. Deux verrous
cumulatifs, donc : **(1)** délai `≥ 72 h` écoulé **ET (2)** signal récurrent tenant sur ≥ 3 observations
*post-changement*. `cutoff = null` (aucun changement antérieur) → première dé-escalade jugée sur la fenêtre
entière. Implémentation : helpers `lastAcceptedChangeAt` / `deescalationTiming` / `afterCutoff`
(`proposal-generator.service.ts`) ; `dayIso` propagé jusqu'aux relevés (`CorrectionPoint`, `fixedDoseTrend`,
nadirs à jeun, nadirs repas) via `localDay` (`meal-trends.service.ts`).

**Surfaçage de sévérité pendant blocage (fix Q6b, 2026-07)** — si une dé-escalade est **bloquée** (délai
non écoulé **ou** données post-changement insuffisantes) mais qu'une **hypo sévère** (`< 0,54 g/L`,
`hasSevereHypo`) est présente sur la fenêtre (jugée sur la **fenêtre entière**, superset du post-changement),
l'événement n'est **jamais tu silencieusement** : levée d'un flag de revue clinique. Couverture **symétrique
sur les 4 leviers** (parité stricte — un anti-ratchet ne masque jamais un signal de danger patient) :

| Levier | Flag levé | Chemins Q6b couverts |
|--------|-----------|----------------------|
| ICR | `highVariabilityPostMeal` | dé-escalade bloquée (délai/post-changement) **+** hypo sévère post-repas **isolée** non récurrente (in-band, sous borne basse, ou plafond avec baisse annulée par la garde-hypo) |
| ISF | `highVariabilityPostCorrection` | dé-escalade bloquée **+** hypo sévère post-correction **isolée** |
| Basal (à jeun / nocturne) | `nocturnalHypoHighFasting` | dé-escalade bloquée **+** hypo nocturne sévère **isolée** — pompe, single_injection, **dose SOIR** du split |
| Basal stylo (matin / pré-dîner, US-2661) | `daytimeHypoHighPreDinner` | **dose MATIN** du split_injection : signal DIURNE (titrée pré-dîner, garde nadirs de jour) — dé-escalade bloquée, confondeur bolus-midi (flag-only), hypo de jour sévère isolée |
| FixedDose | `highVariabilityFixedDose` | dé-escalade bloquée / dose non réductible (≤ plancher) **+** relevé sévère **isolé** |

**Sémantique du cooldown — RÉSOLU (US-2663 S3a)** : le « dernier changement accepté » qui arme le cooldown et
fixe le `cutoff` est lu sur **les DEUX modèles** — `AdjustmentProposal { status: "accepted" }` (par-valeur, par
créneau) **ET** `SlotSetProposal { status: "accepted" }` (groupé ISF/ICR, sans granularité créneau car il
remplace tout le jeu), en retenant le **plus récent** (`lastAcceptedChangeAt`, cf. §Re-source ci-dessus). Une
acceptation groupée réarme donc bien le cooldown moteur. **Écart résiduel connu (pré-existant, hors S3a)** :
l'écriture DIRECTE DOCTOR (`PUT sensitivity-factors`/`carb-ratios` → `replaceSlotSet`) mute la config **sans**
créer de ligne `accepted` → reste invisible au cooldown. Piste de fond (suivi S3+) : sourcer le cooldown sur
l'**horodatage de mutation de config** (`updatedAt` des lignes ISF/ICR ou audit `CONFIG_APPLIED`) plutôt que
sur les propositions comme proxy.

**Contextual flag types** (`reviewFlags` namespace i18n FR/EN/AR) :
- `highVariabilityPostCorrection` — ISF : pics + creux post-correction → revue (pas de dose)
- `nocturnalHypoHighFasting` — Basal à jeun/nocturne (pompe, single, **dose SOIR** du split) : Somogyi soupçonné, glycémie à jeun élevée + hypos nocturnes récurrentes → revue (pas de baisse)
- `daytimeHypoHighPreDinner` — Basal stylo **dose MATIN** du split (US-2661) : signal DIURNE (titrée sur la glycémie pré-dîner, garde nadirs de jour). Libellé **non affirmatif** (« Basale du matin à revoir (glycémie pré-dîner) ») car un cas — le confondeur bolus-midi (IOB) — ne garantit **aucune** hypo (medical). Découplé du flag nocturne : la dose du matin a un mode d'échec diurne, l'y assigner affirmait une fenêtre physiologique fausse.
- `highVariabilityFixedDose` — FixedDose : variabilité pré-dose → revue (pas de dose)

Aucun flag n'implique une dose. Ordonnent la revue médecin, structurent le dialogue clinique.

**Implementation** : slices A/B du code pur + slice C (générateur + matrice), **livrées 2026-07**. 
Cf. `algorithme-propositions-ajustement.md` §5ter et `src/lib/proposal-algorithm.ts` 
(`analyzeIsfHypoDeescalation`, `analyzeBasalHypoDeescalation`, `analyzeFixedDoseHypoDeescalation`, `hasSevereHypo` ; 
wiring `proposal-generator.service.ts`).

### Flag d'orientation `hba1cStale` (mode c nonInsulin, US-2651)

`generateOrientationFlags` lève `hba1cStale` si la **dernière HbA1c enregistrée** (plus récente de
`GlycemiaEntry.hba1c` / `DiabetesEvent.hba1c`) date de > `HBA1C_STALE_DAYS` (180 j) **ou est absente**.
- **Seuil conditionnel (à venir)** : 180 j = borne ADA « stable / à l'objectif ». Un DT2 **non contrôlé**
  devrait être re-dosé à **90 j**. Tant que le TIR (`tirBelowTarget`, slice 2) n'est pas câblé, le
  générateur n'a pas le contexte de contrôle → seuil unique 180 j (faux-négatif possible, jamais de
  sur-dosage). À rendre conditionnel (90 j hors-cible / 180 j à l'objectif) une fois le TIR disponible.
- **Provenance** : HbA1c **saisie in-app** (potentiellement auto-déclarée), pas garantie labo — suffisant
  pour un signal de **récence** (flag gaté médecin, non dosant ; le soignant voit valeur + date).
- **Cas absent** : un diabétique suivi doit avoir une HbA1c → flag = **vrai positif** (« à réaliser »).

### Flag `tirBelowTarget` (mode c) + suivi BGM-only (US-2651, validé medical #676)

`tirBelowTarget` : TIR 14 j < `DASHBOARD_TIR.TARGET_PERCENT` (70 %), bornes **pathology/grossesse-aware**
(`getCgmDefaults(isPregnancy?"GD":pathology).titrLow/titrHigh` — un DT2 **enceinte** est scoré contre
0,63–1,40, pas 0,70–1,80). `null` si capture CGM < 30 % → pas de flag. Seuil 70 % **plat** (pas
pathology-aware) : les **bornes** tightenées encodent déjà le consensus grossesse (70 % dans 63–140).
Helper réutilisable `objectivesService.computeTirPercent`.

> **Suivi (MEDIUM) — gap BGM-only** : un non-insuliné **sans CGM** avec une HbA1c **récente mais mauvaise**
> ne déclenche **aucun** flag (`hba1cStale` faux = récente, `tirBelowTarget` null = pas de CGM). Trou
> « patient silencieux ». À combler par un flag **valeur d'HbA1c** (> cible, ex. > 8 %), non-CGM
> (slice 3, compagnon d'`observance`). Capture 30–70 % : TIR « indicatif » (biais de capture possible).

### Flag `hba1cAboveTarget` (mode c, US-2651 — comble le trou BGM-only #3b, validé medical)

Levé si la dernière HbA1c est **récente** (`!isStale`, ≤ `HBA1C_STALE_DAYS`) ET sa **valeur** > cible (%).
Cible = `AnnexObjective.objectiveHba1c + HBA1C_TARGET_MARGIN_PERCENT (0,5)` si plausible ([4;14], garde
fail-loud contre import corrompu) ; sinon **défaut** `HBA1C_HIGH_DEFAULT_PERCENT (8,0)` adulte /
`HBA1C_HIGH_DEFAULT_PREGNANCY_PERCENT (6,0)` grossesse (sans marge). Marge = bruit analytique ~± 0,5 %.
Défaut 8,0 conservateur (évite la fatigue d'alerte sur DT2 bien gérés à 7-7,7 %). **Partition propre** :
le périmé/absent appartient à `hba1cStale`, le récent-mauvais à `hba1cAboveTarget` — pas de double-signal.
Comble le patient « silencieux » BGM (sans CGM, TIR null). Libellé neutre (jamais « intensifier »).

### Assemblage à jeun basal `fastingTrend` (US-2651 basal, validé medical #678)

Fenêtres d'assemblage (dans `meal-trends.service`) pour peupler `analyzeBasalTrend` :
- `PRE_BREAKFAST_WINDOW_MIN` = **90 min** : fenêtre pré-petit-déjeuner du relevé **à jeun** (dernier
  relevé CGM dans `[petit-déj − 90 min, petit-déj]`).
- `MAX_NOCTURNAL_WINDOW_MIN` = **720 min (12 h)** : plafond de remontée du jeûne nocturne si aucun
  apport glucidique du soir n'est identifié — borne l'intervalle inter-prandial `[dernier glucide, petit-déj]`.

Le **nadir nocturne** = min CGM sur cet intervalle (garde hypo Somogyi), **contigu** avec le relevé à
jeun (les deux se terminent au petit-déjeuner). **Un nadir par nuit**, aligné 1:1 avec les jours (respecte
les 2 caveats medical #678). Le petit-déjeuner = premier repas du moment « morning » (jour/moment dérivés de l'instant réel `eventDate`).

- `NOCTURNAL_ANCHOR_MIN_CARB_G` = **20 g** : seuil « repas substantiel » pour ancrer le jeûne nocturne.
  Un **resucrage** d'hypo (petit glucide nocturne) NE tronque PAS la fenêtre nadir (sinon l'hypo qui l'a
  motivé sortirait de la fenêtre → **garde Somogyi masquée**, validé medical #679). L'ancre = dernier
  repas ≥ 20 g avant le petit-déj (pas `carbTimes`).
- **Limite connue** : un patient **sautant le petit-déjeuner** (jeûne intermittent) n'a pas d'ancre de
  fin de jeûne → aucune entrée à jeun ce jour-là (fail-closed : réduit `supportingEvents`, jamais la
  direction). Amélioration future possible : ancre de repli à fenêtre fixe.
- **Suivi câblage (slice 3)** : `FastingDay` est en **mg/dL** ; `analyzeBasalTrend` attend **g/L** → le
  générateur devra **÷ 100 + filtrer les null** (sinon garde hypo silencieusement désactivée).

### Générateur basal (US-2651, validé medical) — snapping délivrable + spec slice 3b

**Snapping (slice 3a, livré)** : `analyzeBasalTrend` **arrondit** le débit proposé au multiple de
`PUMP_BASAL_INCREMENT` (0,05 U/h) le plus proche ; sinon `createEngineProposal` le **rejette**
(`isDeliverableBasalRate`) → quasi toutes les propositions basales seraient silencieusement droppées.
Le **sens** (`basalTooLow`/`basalTooHigh`) et la **garde hypo** utilisent la valeur **snappée**. Une
variation qui s'arrondit à < 1 incrément → aucune proposition. (Mirror `analyzeFixedDose`.)

**Générateur basal (slice 3b, LIVRÉ)** — `generateForPatient`, mode `basalBolus`, après le chemin ICR — validé medical :
- **Scope pompe** (`configType === "pump"` + `pumpSlots`) ; stylo/MDI = dose fixe (autre chemin).
- **Créneau titré** = celui actif à `NOCTURNAL_TITRATION_REF_HOUR` (**05:00** — action insuline ~05:00 →
  effet 06:00-08:00 = fasting). Seul le nocturne ; créneaux de jour différés.
- **Cible à jeun** : `glucoseTargets.targetGlucose/100` clampée `[FASTING_TARGET_MIN_GL 0,80 ;
  FASTING_TARGET_MAX_GL 1,30]` (grossesse `[0,80 ; FASTING_TARGET_MAX_PREGNANCY_GL 1,00]`), sinon
  **défaut** `FASTING_TARGET_DEFAULT_GL 1,00` / `FASTING_TARGET_PREGNANCY_GL 0,90`. **JAMAIS `titrLow`**
  (plancher hypo → sur-titration vers l'hypo).
- **Deadband** : aucun (basal = titrate-to-target symétrique ; ±2 %/±20 % + garde nadir suffisent).
- **Coverage guard** : n'autoriser une **hausse** que si ≥ 3 nuits de nadir CGM (sinon Somogyi invisible) ;
  **baisses** inconditionnelles. `source: "cgm"`.

**Limites connues du générateur basal (slice 3b, tracées en suivi)** :
- **Couplage ICR** : le chemin basal est gaté derrière l'existence des carb-ratios (`generateForPatient`
  renvoie tôt `EMPTY("noCarbRatios")`). Un patient pompe avec basale mais sans carb-ratios n'a pas encore
  de proposition basale (acceptable pour un `basalBolus` bien formé). Découplage à évaluer.
- **Cible non fasting-scoped** : la cible individualisée lit `glucoseTargets[0]` (1re cible active, pas
  forcément à jeun) ; sûr car clampée `[0,80 ; 1,30]`. Préférer un champ fasting dédié si disponible.
- **Seuil couverture** `MIN_NADIR_NIGHTS = 3` (constante locale, distincte de `MIN_MEALS_PER_SLOT`).

### Titration basale STYLO (MDI) — socle S0 (US-2659, cadrage validé medical 2026-07-11)

**Motivation** : le générateur ci-dessus ne titre que la basale **pompe** (`configType === "pump"`). Un
patient sous **stylo** (`single_injection` = 1 dose lente/j ; `split_injection` = matin + soir) n'obtient
**aucune** proposition basale — c'est la « limite connue » que US-2659 comble. La basale stylo se distingue
de la pompe par le **geste**, la **granularité** (unités TOTALES, pas U/h) et le **risque**.

**Discriminateur de cible `AdjustmentProposal.basalDoseKind`** (`daily`/`morning`/`evening`, enum
`BasalDoseKind`, NULL pour pompe/ISF/ICR/fixedDose) — **pré-requis** de toute proposition stylo : la basale
pompe cible un `PumpBasalSlot`, la basale stylo n'a **pas de créneau adressable** ; ce discriminateur
identifie la dose visée sur `BasalConfiguration` (`daily` → `dailyDose` ; `morning`/`evening` →
`morningDose`/`eveningDose`). Il **étend le tuple de l'index unique partiel** `adjustment_proposals_one_pending_per_slot`
(`NULLS NOT DISTINCT`, `WHERE status = 'pending'`) → deux propositions stylo pending sur des doses
différentes (matin vs soir) ne se collisionnent plus à tort. Migration `20260719100000`. **Contrat iOS**
(nouveau discriminateur) → coordination `swift-expert`.

**Table de décision — `parameterType` → discriminateur autoritaire → unité** (contrat partagé back ↔ iOS).
`AdjustmentProposal` empile désormais **5 discriminateurs de cible mutuellement exclusifs** ; `parameterType`
seul ne suffit plus à désambiguïser `basalRate` (pompe vs stylo). Le client lit le discriminateur **non-NULL**
selon la ligne :

| `parameterType` | Discriminateur non-NULL | Cible | Unité de `current/proposedValue` |
|---|---|---|---|
| `insulinSensitivityFactor` | `timeSlotStartHour` (+ `timeSlotEndHour`) | créneau ISF | g/L·U (ou mg/dL·U) |
| `insulinToCarbRatio` | `carbRatioSlotStart` (+ `carbRatioSlotEnd`) | créneau ICR | g/U |
| `fixedDose` | `moment` | `FixedDoseSlot` | U (dose totale) |
| `basalRate` **+ pompe** | `pumpBasalSlotId` | `PumpBasalSlot` | **U/h** (débit) |
| `basalRate` **+ stylo (MDI)** | `basalDoseKind` (`daily`/`morning`/`evening`) | `BasalConfiguration.dailyDose`/`morning`/`eveningDose` | **U** (dose totale) |

> ⚠️ **Piège d'unité** : une proposition `basalRate` est en **U/h** (pompe) OU en **U totales** (stylo) — ne
> jamais supposer « U/h » pour tout `basalRate`. Brancher l'affichage sur le discriminateur présent.

**Invariant d'exclusivité verrouillé en base** (CHECK `adjustment_proposals_basal_target_exclusivity_check`,
migration `20260719100000`) : pour `parameter_type = 'basalRate'`, **exactement un** de (`pump_basal_slot_id`,
`basal_dose_kind`) est non-NULL (XOR) ; hors `basalRate`, `basal_dose_kind` est **toujours** NULL. Le client
peut donc router l'affichage sur la simple présence du discriminateur sans heuristique divergente. (Le CHECK
est invisible au drift-gate — Prisma ne modélise pas les CHECK — mais appliqué par `migrate deploy`.)

**Constantes dédiées `MDI_BASAL_*`** (table §1) — sémantique et magnitudes propres à la basale stylo :
**jamais** l'incrément pompe (0,05 U/h, mismatch U/h vs U totales), **jamais** les magnitudes dose fixe
(±2 U trop serrées pour une basale adulte). Toutes en **unités totales**. Défaut d'incrément **fail-closed
= 1 U** (0,5 U seulement si stylo demi-unité lu sur l'appareil).

**Logique de titration** — `single_injection` **LIVRÉE en S1** (ci-dessous) ; `split_injection` = S2 (à venir :
dose du **soir sur l'à jeun**, dose du **matin sur le pré-dîner**, **une seule dose titrée par run**, priorité
soir/à jeun). **Jamais auto-appliqué** (ADR #13). Réfs : ADA Standards of Care 2025 §9 ; Riddle Treat-to-Target
2003 ; INSIGHT ; ISPAD (stylos demi-unité).

### Titration `single_injection` (US-2659 S1, LIVRÉ, validé medical 2026-07-11)

**Analyseurs purs** (`proposal-algorithm.ts`) — dose DIRECTE en **unités totales** :
- `analyzeMdiBasalDailyTrend(fastingValues, T, currentDose, nocturnalNadirs, incrementU)` — treat-to-target sur
  la **glycémie à jeun**. **Hold zone asymétrique** `[T − 0,20 ; T + 0,30]` g/L (obligatoire pour un pas FIXE :
  déclencher au seul signe sur-corrigerait ; bande haute plus large = anti-overshoot, bande basse plus serrée =
  sens sûr). Au-dessus → **hausse** `min(max(+2 U, +10 %), +20 %, +4 U)` (le cap % l'emporte sur le plancher +2 U
  = protège les petites doses) ; en dessous → **baisse** treat-to-target (symétrique) ; dans la bande → HOLD.
  **Snap `floor` asymétrique** (arrondi TOUJOURS vers moins d'insuline : hausse jamais au-dessus du cap, baisse vers
  plus de réduction) à l'incrément stylo (défaut **1 U** fail-closed) ; `|delta| < incrément` → `null` (non
  actionnable). **Garde hypo** : une hausse est supprimée si un nadir nocturne est en hypo (repli à jeun).
- `analyzeMdiBasalDailyHypoDeescalation(currentDose, nocturnalNadirs, incrementU)` — **dé-escalade** sur nadirs
  nocturnes récurrents (indépendante de la hold zone) : `−min(20 %, 4 U)` (**`−min`, jamais `−max`** — `−max`
  produirait −40 % → rebond hyper/cétose), snap `floor`, plancher 0,5 U ; non actionnable → `flagNonActionable`.

**Matrice générateur** (`proposal-generator.service.ts`, bloc `configType === "single_injection"`, ordre) :
1. **Somogyi** — à jeun HAUT (`> T + 0,30`) + hypo nocturne récurrente → **flag** `nocturnalHypoHighFasting` (D10).
2. **Dé-escalade** (hypos nocturnes récurrentes, in-band ou sous la bande) — **prime** sur la baisse treat-to-target
   (plus spécifique ; couvre la cible grossesse serrée). Jugée sur les nadirs POST-changement + cooldown (Q6a/Q6b).
3. **Titration treat-to-target** (pas d'hypo nocturne récurrente) — jugée sur l'**à jeun POST-changement**
   (`afterCutoff`, fix M1 : évite qu'un pas FIXE s'empile sur une moyenne 7 j contaminée par ~4 j pré-changement
   avant le steady state ; < 3 à jeun post-changement → l'analyseur renvoie null → **HOLD**). Hausse (si
   **couverture nocturne** ≥ 3 nadirs, sinon **AC-4 : flag explicite**, jamais un drop muet) OU baisse ;
   **cooldown `MDI_BASAL_COOLDOWN_HOURS` (72 h V1) gate les DEUX sens** (Risk #1, divergence assumée vs pompe :
   steady state 3–4 j + incrément 1 U grossier → anti-empilement).

**Surfaçage sévère (Q6b)** — pendant tout blocage (cooldown / dé-escalade non actionnable), une hypo sévère
(< 0,54 g/L) **nocturne (CGM) OU à jeun (BGM-only, relevé réveil)** est surfacée en flag (`hasSevereHypo` sur
`nadirs nocturnes ∪ à jeun`) — jamais tue, y compris sans couverture CGM.

**Source du signal à jeun** : **CGM d'abord** (porte les nadirs nocturnes → autorise hausses + Somogyi + dé-escalade),
**à défaut BGM** (patient MDI souvent BGM → à jeun présent mais aucun nadir → hausses refusées AC-4 → flag, baisses
permises). Fail-closed : jamais de hausse à l'aveugle. Fenêtre **7 j** (`MDI_BASAL_ANALYSIS_DAYS`), ≥ 3 à jeun.

**Cooldown sensible à la MOLÉCULE (US-2662, validé medical)** — le cooldown anti-cliquet est résolu **SERVEUR** à
la génération (`resolveMdiCooldownHours`, `proposal-generator.service.ts`) via la molécule basale du patient
(`InsulinTherapySettings.basalInsulinId → PatientInsulin → InsulinCatalog.typicalDurationHours`), et appliqué
**identiquement aux 3 cibles** (daily/evening/morning) : durée `≥ ULTRALONG_BASAL_DURATION_MIN_H` (30 h) ⇒
`MDI_BASAL_COOLDOWN_HOURS_ULTRALONG` (96 h — dégludec ~42 h, U300 ~36 h) ; sinon `MDI_BASAL_COOLDOWN_HOURS`
(72 h — U100 24 h, detemir 20 h). **Discriminateur durée-based** (molécule-agnostique) : medical **rejette**
`peak IS NULL` (glargine U100 est aussi peakless → sur-capture) et le match `genericName` (fragile au nommage).
**Fail-closed** : molécule non résoluble (`basalInsulinId` null / durée absente) ⇒ **96 h** (le plus protecteur —
l'empilement, harm de commission non surfacé, prime sur le retard de titration, harm d'omission surfacé ; cohérent
avec la hold zone asymétrique). *Suivi tracé (hors US-2662) : envisager un reset de titration après changement de
molécule basale (le « dernier accepté » peut précéder le switch).*

**Avertissement dose élevée (US-2662)** — une proposition de basale STYLO dont `proposedValue > MDI_BASAL_WARN_U`
(80 U) surface un badge **non bloquant** « Dose basale élevée — à confirmer » à l'écran de revue médecin
(`review` i18n FR/EN/AR). Dérivé **SERVEUR** (bornes cliniques jamais côté client) ; l'acceptation reste possible
(informatif, pas un garde-fou). La basale stylo n'a **pas** de plafond dur (décision US-2659 : U300/dégludec > 80 U
légitimes) — d'où un simple avertissement, pas un blocage.

**Contrat service** (`adjustment.service.ts`) : cible `basalDoseKind = "daily"` → `resolveCurrentValue` lit
`BasalConfiguration.dailyDose` (scopé patient) ; `validateProposedValue` route les bornes **stylo** (`MDI_BASAL_MIN_U`,
délivrable demi-unité, pas de plafond dur) et non pompe (U/h). **Application groupée (US-2660, LIVRÉ)** :
`accept(applyImmediately)` d'une proposition stylo écrit la dose ciblée par `basalDoseKind`
(`dailyDose`/`morningDose`/`eveningDose`) sur l'**unique** `BasalConfiguration` du patient (contraintes
`settings_id @unique` + `patient_id @unique` → 1 config/patient, `updateMany` scopé patient touche ≤ 1 ligne).
Gardes fail-closed (rollback, jamais d'« accepté + appliqué » fantôme) :
- **compare-and-swap `baselineMoved`** (409) — check explicite : si la dose live a dérivé depuis la proposition ;
- **CAS atomique DB** : la valeur attendue est verrouillée dans le `WHERE` de l'`updateMany`
  (`<colonne>: currentValue`, `proposal.currentValue` Prisma Decimal, comparaison numérique Postgres exacte).
  Une base déplacée dans la fenêtre TOCTOU (le check `baselineMoved` lit **hors transaction**) ou une **dose
  effacée** depuis (NULL ≠ valeur) matche 0 ligne → **`styloBasalNotFound`** (rollback) — jamais de réintroduction
  silencieuse d'une dose supprimée, jamais d'écrasement d'un changement concurrent. Ce verrou est porté sur les
  **5 leviers** (ISF/ICR/pompe/dose fixe + stylo) pour cohérence ;
- **`basalTargetAmbiguous`** (422) si un `basalRate` portait les DEUX discriminateurs (`pumpBasalSlotId` **et**
  `basalDoseKind`) — invariant inatteignable sous le CHECK base d'exclusivité, filet en profondeur ;
- **`noApplicableApplyTarget`** (422) si `applyImmediately` est demandé sans cible résoluble (fantôme évité).

Les 5 codes `…SlotNotFound`/`styloBasalNotFound` sont mappés **409** (conflit récupérable — régénérer), les 2
invariants **422**, par la route `accept` (US-2660). **Colonnes stylo élargies `Decimal(5,2)→(6,2)`** (migration
`20260722100000`, alignées sur `total_daily_dose`) : la politique « pas de plafond dur » n'aurait pas dû pouvoir
déclencher un `numeric overflow` Postgres brut sur une dose ≥ 1000 U.

### Titration `split_injection` (US-2659 S2, LIVRÉ, validé medical 2026-07-11)

DEUX doses stylo (matin + soir). La **matrice de titration d'une dose** est factorisée (`decideMdiDose`, pure)
et **partagée** avec `single_injection` (mêmes bornes, hold zone, snap, dé-escalade `−min`, cooldown post-changement,
surfaçage Q6b). Le service (`resolveCurrentValue` → `morning`/`eveningDose`, bornes stylo, accept fail-closed) est
**générique** depuis S1 (S2 n'ajoute pas de code service).

- **Dose du SOIR** (`basalDoseKind="evening"`) → titrée sur la glycémie **à jeun** (= chemin `single_injection` :
  source CGM→BGM, garde **nocturne**, Somogyi, AC-4).
- **Dose du MATIN** (`basalDoseKind="morning"`) → titrée sur la glycémie **PRÉ-DÎNER** (`preMgdl` des repas
  `moment="evening"` de `dailyJournal`). Garde hypo = **nadirs de JOUR** (repas `morning`+`noon`), **jamais** le
  nadir nocturne (D9 « jamais croisé » — fenêtre de la dose du soir). Cible pré-dîner = `resolveFastingTarget`
  (préprandiale ADA 80–130, même hold zone). **Confondeur (§3.2)** : un **bolus de midi** (`moment="noon"`,
  `bolus>0`) contamine le pré-dîner par son IOB → dose du matin **flag-only** (hausse ET dé-escalade), jamais une
  proposition (décision basale-vs-bolus rendue au médecin). ⇒ un split **basal-bolus** ne titre que le soir ;
  un split **basal-seul** titre les deux. *Limite S2 : le pré-dîner est lu sur le journal CGM ; un split BGM-only
  n'obtient pas de proposition matin (fail-closed).*

Le signal pré-dîner et la garde de jour sont lus sur un **journal dédié fenêtre 7 j** (`MDI_BASAL_ANALYSIS_DAYS`,
comme la dose du soir), distinct du `journal` ICR (14 j) — la fenêtre analysée == `analysisPeriod` persisté (traçabilité).

**Orchestration (D4 raffiné, Q5)** — **une seule proposition basale/run**, priorité **sécurité-d'abord** :
dé-escalade (soir ou matin) > titration ; à égalité, **soir/à jeun** (nocturne = pire mode d'échec). Les **flags**
sont toujours levés (revue, pas un changement de dose) ; si **les deux** doses dé-escaladent, la winner est
persistée et la dé-escalade **perdante est immédiatement flaggée** (fail-loud — jamais un drop silencieux d'un
signal de sécurité ; une titration perdante défère). **Verrou « 1 basale stylo pending »** (Q6) : au plus une
proposition stylo `pending` par patient, toutes cibles confondues (changer les 2 doses d'un coup détruit
l'attribution + risque l'empilement). Double couche : garde **applicative** (le générateur vérifie une pending
avant de créer) + **index unique partiel base** `adjustment_proposals_one_pending_stylo_basal`
(`WHERE parameter_type='basalRate' AND basal_dose_kind IS NOT NULL AND status='pending'`, migration `20260720100000`
— ferme la course inter-run cron/on-demand ; violation P2002 → `duplicatePendingProposal`). **Fail-loud** : si le
verrou bloque une **dé-escalade** (sécurité), un **flag** est levé (jamais un drop silencieux).

### Baisse basale proposable par le PATIENT (US-2659 S3, LIVRÉ, validé medical + HDS 2026-07-11)

**Relâchement d'un garde-fou de sécurité** (`patientDecreaseForbidden`, `adjustment.service.ts`) — une baisse
basale patient était **interdite** ; elle devient **proposable** mais gatée. Le médecin reste le garde-fou
(proposition `pending`, **jamais** auto-appliquée, ADR #13 ; l'accept-with-apply stylo écrit désormais la dose,
US-2660) — interdire la proposition était anti-ETP. **Tout lu SERVEUR (anti-tamper)** :
maturité, valeur courante, **mode de délivrance** (dérivé de la config, jamais du body — E1 HDS).

| | **Pompe** (`pumpBasalSlotId`, U/h — réversible) | **Stylo** (`basalDoseKind`, U totales — dose entière) |
|---|---|---|
| Baisse **proposable** | dès **INTERMEDIATE** | **CONFIRME uniquement** (plus risqué : dose entière nuit+jour, non réversible) |
| Amplitude max | ≤ `PATIENT_MAX_CHANGE_PERCENT` (10 %) sur le **vrai delta** | ≤ **min(10 %, `MDI_BASAL_PATIENT_MAX_DELTA_U` 2 U)** |
| Accusé **DKA** (jour de maladie) | non requis (persisté si fourni) | **requis `=== true`** (bloquant `dkaAcknowledgmentRequired`) |
| Snap incrément | — | baisse infra-incrément / non délivrable → `noChangeProposed` |
| `JUNIOR` | ❌ refus (`maturityTooLowForDecrease`) | ❌ refus |
| Cooldown | 24 h | 24 h |
| Application | ❌ jamais — `pending`, médecin décide | ❌ jamais — `pending`, médecin décide |

**Codes** : `maturityTooLowForDecrease` (403), `dkaAcknowledgmentRequired`/`deliveryModeMismatch`/`noChangeProposed`
(422). **Accusé DKA** persisté en colonne **immuable** `AdjustmentProposal.sickDayAcknowledgedAt` (timestamp du
consentement ; NULL = non acquitté) — consentement de sécurité requêtable/immuable (MDR ISO 14971). **Audit
enrichi** de la baisse patient (E3) : `direction`/`deliveryMode`/`dkaAcknowledged`/`maturityAtDecision`, **zéro
valeur de dose** ; les **refus** sont aussi audités (E6 — insistance = signal clinique/forensic). **Garde-fou du
relâchement** : l'écran de revue médecin surface désormais les `ClinicalReviewFlag` **ouverts** (dont Somogyi
`nocturnalHypoHighFasting`) — le médecin voit le contexte hypo AVANT d'accepter une baisse (baisse sur Somogyi =
mauvais geste). L'avertissement Somogyi/DKA côté patient est un **texte ETP statique** (le serveur ne bloque que
sur l'accusé DKA). **Contrat iOS** : inputs `basalDoseKind`/`sickDayAcknowledged` + nouveaux codes → `swift-expert`.

### Assemblage corrections ISF `correctionTrend` (US-2651 ISF slice 2, validé medical)

Apparie les **corrections propres** (`mealtimePattern.correctionTrend`, CGM only) pour peupler
`analyzeIsfSlot`. Une correction (`BolusCalculationLog`) n'est retenue que si :
- **Propreté** : `correctionDose > 0`, pas de repas (`mealBolus == 0`, `inputCarbsGrams` 0/null), **IOB nul**,
  **non plafonnée** (`wasCapped == false` — sinon dose sous-délivrée → lecture haute → baisse ISF → hypo),
  **bolus standard** (pas d'étalé/dual-wave), `inputGlucoseGl` connu, `wasDelivered == true`.
- **Signal** : élévation `inputGlucoseGl − cible ≥ CORRECTION_MIN_ELEVATION_GL` (0,30 g/L) ET
  `correctionDose ≥ FIXED_DOSE_MIN` (0,5 U).
- **Confondeurs** : aucun glucide dans `[t0−CORRECTION_COB_LOOKBACK_MIN (180 min), t0)` (COB) ; aucun
  glucide NI bolus dans `(t0, t0+INSULIN_ACTION_MAX (5 h)]` (repas/insuline empilée).

`postGlucoseGl` = relevé **settled à 5 h** ± `CORRECTION_SETTLE_TOL_MIN` (30 min), **fail-closed** si absent
(pas de fallback — lire à 5 h et non 3,5 h évite le biais « encore en baisse » vers plus d'insuline).
`nadirGl` = min CGM sur la fenêtre (garde hypo tardive). Attribution au créneau ISF **appliqué**
(`localHour(t0)`). Période ISF par défaut = **30 j** (corrections propres rares). Limite connue :
l'exercice (creux → sens sûr, capté par la garde) n'est pas un gate dur (pas d'intensité dans les données).

**Limites connues (ISF assemblage)** : (1) une correction dont la fenêtre COB `[t0−180 min]` déborde
avant le début de la fenêtre d'analyse est **exclue** (fail-closed — glucides pré-correction non
chargés, COB non vérifiable). (2) Les **glucides non loggés** (patient mange sans saisir) ne peuvent
être exclus par aucun filtre d'événement : limite data intrinsèque de la titration, atténuée par la
garde nadir (ISF slice 1) + le doctor-gating (ADR #13).

### Générateur ISF (US-2651 ISF slice 3, LIVRÉ) — `generateForPatient`, mode `basalBolus`, après ICR + basal

- `correctionTrend(patientId, ISF_ANALYSIS_PERIOD 30 j)` → corrections propres appariées.
- Grouper par **créneau ISF appliqué** : `findSlotForHour(sensitivityFactors, point.localHour)`.
- Par créneau : `analyzeIsfSlot(slot, points)` → `createEngineProposal({ parameterType:
  "insulinSensitivityFactor", timeSlotStartHour/EndHour })` ; rejets fail-closed non fatals.
- **Pas de coverage guard dédié** (≠ basal) : `correctionTrend` est CGM-only + fail-closed, donc chaque
  point a un nadir → la garde hypo d'`analyzeIsfSlot` (baisse ISF = plus d'insuline) suffit. Plancher
  analyseur = 3 corrections/créneau. Sens : baisse ISF gardée, hausse (moins d'insuline) libre.

**Générateur multi-levier complet** : ICR + basal + ISF de bout en bout (doctor-gated, ADR #13).
Reste : `fixedDose` (bloqué migration `moment`), mode-c `observance`, activation cron prod.

**Suivi (impact cumulé multi-levier)** : le générateur produit des propositions ICR/basal/ISF
**indépendantes** (par paramètre, jeux d'événements disjoints — pas de double-titration). Mais accepter
plusieurs propositions en une session augmente l'insuline totale ; l'écran de revue ne montre pas encore
d'**impact cumulé**. Atténué par le jugement médecin par-paramètre + les caps ±20 % + one-pending/créneau.
Enhancement futur de l'écran de revue (non bloquant, validé medical #684).

### Persistance des propositions DOSE FIXE (US-2652, débloqué)

`createEngineProposal`/`createProposal` acceptent désormais le paramètre `fixedDose` (avant : `fixedDoseNotWired`).
Discriminateur = **`moment`** (`DoseMoment` : morning/noon/evening/night), nouvelle colonne sur
`AdjustmentProposal` (migration `20260710100000`, index anti-spam partiel `one_pending_per_slot` étendu à
`moment`). `resolveCurrentValue` lit la `FixedDoseSlot` **scopée patient** via `patientInsulin`
(anti-IDOR). `validateProposedValue` : plancher `FIXED_DOSE_MIN` (0,5 U) uniquement (pas de plafond
bloquant — cf. §1). À l'**accept**, `fixedDoseSlot.updateMany({ patientInsulin: { patientId }, moment })`
écrit `valueU` (fail-closed `fixedDoseSlotNotFound` si count 0). Reste : l'**assemblage** (glycémie par
moment) + le **générateur** `fixedDose` (mode `fixedDose`, pas encore branché dans `generateForPatient`).

### Assemblage DOSE FIXE `fixedDoseTrend` (US-2652 slice 2, validé medical)

Peuple `analyzeFixedDose` pour un patient « doses simples » (BGM-only). Par `DoseMoment`, les **creux
pré-dose** qui jugent la dose de ce moment.
- **Décalage (Option B, `FIXED_DOSE_NEXT_WINDOW`)** : une dose fixe agit **en aval** → jugée sur la
  **fenêtre SUIVANTE** (morning→noon, noon→evening, evening→night, night→morning). Le relevé de la même
  fenêtre reflète, lui, la dose PRÉCÉDENTE (attribuer au même moment = Option A, **cliniquement fausse**).
  Miroir du basal (créneau nocturne ← glycémie à jeun).
- **Creux** = relevé le **plus tôt par jour** dans la fenêtre (proxy pré-dose, évite le biais post-prandial).
  Relevés BGM **bruts** en g/L (chacun un `postGlucoseGl` ; `analyzeFixedDose` moyenne, plancher ≥3).
- **Cible** (appliquée par le générateur, slice 3) = `resolveFastingTarget` (pré-prandial 1,00/0,90 g/L,
  clampé, individualisé) — **JAMAIS** la bande carnet ni `titrLow`. Même cible aux 4 moments.
- **Période 14 j** (comme le basal, réactif). Pas de hard-filtre de confondeur (shift + earliest/jour +
  moyenne + caps + doctor-gating suffisent).
- **Garde hypo** : déjà dans `analyzeFixedDose` (`hypoBlocksProposal` sur les creux) — avec le shift, les
  creux SONT les nadirs → la garde protège le bon moment. ⚠️ Garde hypo **pathology-AGNOSTIQUE** (seuils
  `SEVERE_HYPO_GL`/`LEVEL1_HYPO_GL` fixes) tandis que la **cible** est pathology-aware.

**Limites connues (assemblage dose fixe, validé medical #686)** :
- *Earliest-in-window pas garanti pré-prandial pour les fenêtres de JOUR* (`morning→noon`, `noon→evening`) :
  un relevé post-prandial (ex. 10:30 post-petit-déj) peut être le plus tôt de la fenêtre → `avgPost`
  biaisé vers le haut → léger nudge de **hausse** de la dose. Borné (caps ±10 %/±2 U, doctor-gated) ;
  pas de risque hypo (valeurs hautes). Le cas `night→morning` (à jeun) est immunisé.
- *Fenêtre `night` (22–04, cross-minuit)* : sur le jour-frontière, `earliest-par-jour` garde le relevé
  ~02-04 h (plus proche du vrai nadir nocturne) et écarte le ~22 h → réduit légèrement N pour la dose
  `evening`, conservateur, **pas de mauvaise direction**. Amélioration future possible (appariement nuit réelle).

### Générateur DOSE FIXE (US-2652 slice 3, LIVRÉ) — `generateFixedDoseProposals`, mode `fixedDose`

Branche dédiée dans `generateForPatient` (`mode === "fixedDose"` → route vers `generateFixedDoseProposals`).
- Charge les `FixedDoseSlot` (via `patientInsulin`, **pas** `InsulinTherapySettings`). Aucune dose → `EMPTY("noFixedDose")`.
- Cible : `resolveFastingTarget(glucoseTargets individualisée, isPregnancy)` — pré-prandiale 1,00/0,90, **JAMAIS `titrLow`**.
- Creux pré-dose par moment : `analyticsService.fixedDoseTrend(patientId, "14d")` (shift Option B).
- Par moment : `{postGlucoseGl, targetGl}[]` → `analyzeFixedDose(slot, readings)` → `createEngineProposal({ parameterType: "fixedDose", moment })` ; rejets fail-closed non fatals (bucket `fixedDose:<moment>`).

**Générateur multi-levier COMPLET** : ICR + basal + ISF + **fixedDose** de bout en bout, doctor-gated (ADR #13).

**Limites connues (générateur dose fixe)** :
- *Garde soft-delete* : `generateFixedDoseProposals` renvoie `EMPTY("noPatient")` si le patient est
  soft-deleted (fail-closed RGPD, ADR #4 ; symétrie avec le chemin basalBolus).
- *Edge multi-`PatientInsulin`* : `FixedDoseSlot` est unique sur `[patientInsulinId, moment]` (pas
  `[patientId, moment]`). Si un patient avait 2 `PatientInsulin` actifs portant le même moment, le
  `findMany` émettrait 2 candidats ; tout reste **sûr** (`resolveCurrentValue` = `findFirst` + le 2e
  candidat → `duplicatePendingProposal` / `baselineMoved`) → proposition supprimée, **jamais fausse**.

### Flag `observance` (US-2651 mode c, LIVRÉ, validé medical) — « suivi glycémique insuffisant »

4ᵉ flag d'orientation du mode nonInsulin (`generateOrientationFlags`). **Honnêteté du scope** : mesure
l'**auto-surveillance glycémique** (seule donnée disponible ; pas d'adhésion médicamenteuse ni de présence RDV).
Libellé UI « Suivi glycémique à vérifier ». Source : `OBSERVANCE` (`clinical-bounds.ts`).

- **Logique either/or** : `observancePoor = !cgmAdequate && bgmCount < seuil`. `cgmAdequate = cgmCount > 0
  && cgmCaptureRate(cgmCount, 30) ≥ MIN_CGM_CAPTURE_RATE (30 %)`. → un **porteur CGM régulier** (capture ≥ 30 %,
  un capteur abandonné retombe sous le seuil) OU un **testeur BGM diligent** n'est **jamais** faussement flagué ;
  seul le double-échec l'est.
- **Seuils BGM pathology-aware** : `BGM_MIN_READINGS_DEFAULT` = **4 / 30 j** (DT1/DT2, < ~1×/sem) ;
  `BGM_MIN_READINGS_PREGNANCY` = **30 / 30 j** (GD/grossesse, < ~1×/j — population critique, cible 4×/j).
- **Garde enrollment** : pas de flag si `patient.createdAt` < `MIN_ENROLLMENT_DAYS` (30 j) — fenêtre pas
  encore observable (n'accuse pas un patient récemment inscrit).
- **Fenêtre** `WINDOW_DAYS` = 30 j. **Chevauchement** avec `hba1cStale` acceptable (axes distincts :
  récence HbA1c vs comportement de suivi ; un patient totalement désengagé déclenche les deux, cohérent).
- **Direction fail-safe** : orientation-only, idempotent, doctor-gated → seuils **lenients** (err vers NE PAS
  flaguer, anti fatigue d'alerte). Jamais une dose (frontière MDR).

### Enregistrement d'un GROUPE de créneaux (US-2655, replaceSlotSet)

Restructurer un profil ISF/ICR se fait désormais par **remplacement transactionnel du jeu complet**
(`insulinTherapyService.replaceSlotSet`), plus ligne par ligne. Invariants **re-validés serveur** (jamais
confiance au client) sur l'état **final** :
- **Chevauchement** → rejet dur `slotOverlap` (409) : deux créneaux sur la même minute = double-dose.
- **Trou de couverture 24 h (ISF/ICR)** → rejet `slotGap` (422) : un bolus doit toujours résoudre un créneau.
  Applicable ici (contrairement au déplacement mono-créneau) car on valide le set **complet**, sans état
  transitoire troué. Source unique : `analyzeSlotCoverage` (`src/lib/insulin/slot-coverage.ts`).
- **Durée nulle** (`startHour === endHour`) → `zeroDurationSlot` ; **jeu vide** → `emptySlotSet` (un profil
  ne peut finir à 0 créneau).
- **Convention d'encodage** : `endHour ∈ [0,23]` ; un profil complet **enjambe minuit** via un créneau
  `startHour > endHour` (ex. ISF `[22,6)`) — pas de `endHour = 24` (`endHour = 0` = minuit). Aligné sur le
  seed et `replaceSlotSet`.
- **Anti-IDOR** : le remplacement groupé (`replaceSlotSet`/`replacePumpSlotSet`) dérive `settingsId`/
  `basalConfigId` du **patient** (jamais du body) → un jeu d'un autre patient n'est jamais touché.
- **Propositions** : les `pending` du même paramètre pour le patient passent **`superseded`** (nouveau statut
  `ProposalStatus`) — libère l'index `one_pending_per_slot`, pas de collision P2002.
- **Rôle** : chemin **DOCTOR direct** (PUT `/api/insulin-therapy/{sensitivity-factors,carb-ratios}`). Le chemin
  proposition (NURSE/patient, garde `proposalAlreadyPending`) est ouvert par US-2657.
- **Bornes de valeur** : ISF ∈ [`ISF_GL_MIN`, `ISF_GL_MAX`], ICR ∈ [`ICR_MIN`, `ICR_MAX`] — re-vérifiées
  **dans le service** (`valueOutOfBounds`, 400), pas seulement à la route Zod (défense en profondeur :
  service sûr même appelé directement). Conversion g/L→mg/dL mutualisée via `glToMgdl` (`src/lib/statistics.ts`).
- **Profil « une seule valeur sur 24 h »** : s'exprime en **≥ 2 créneaux** de même valeur (ex. `[0,12)`+`[12,0)`).
  Inhérent au résolveur `findSlotForHour` (aucun `[h,h)` ne couvre 24 h) — un mono-créneau reçoit `slotGap` (422),
  fail-closed. À gérer en confort UI (auto-split) côté US-2656.

### Génération de propositions à la demande (US-2658)

Au-delà du run nocturne (cron), un **DOCTOR ou NURSE** peut déclencher la génération pour un patient sur
une **fenêtre d'analyse choisie**, via `POST /api/patients/[id]/proposals/generate` (`windowDays` ∈ **[2,14]** ;
hors bornes → 400 `windowOutOfBounds`).
- **Réutilise le générateur** (`generateForPatient` + paramètre `windowDays`) — aucun nouveau chemin de dose.
  `windowDays` s'applique aux chemins **ICR / basal / dose fixe** (repas, à-jeun, creux pré-dose) ; l'**ISF
  garde sa fenêtre 30 j** (corrections propres rares — décision US-2658 §3). Absente (cron) → 14 j inchangé.
- **Plancher 2 j** : sous les seuils de suffisance (`MIN_MEALS_PER_SLOT` = 3, `MIN_NADIR_NIGHTS` = 3, etc.) le
  moteur ne propose rien — c'est un **succès** (`created: 0`, `reason`), pas une erreur. **Plafond 14 j** :
  au-delà, les données ne reflètent plus la titration actuelle (aligné `AGP_SUFFICIENCY.MIN_DAYS`).
- Tous les garde-fous existants restent actifs (garde hypo, bornes cliniques, anti-empilement
  `one_pending_per_slot`, frontière MDR `nonInsulin`). **Propose, n'applique jamais** (ADR #13).
- **RBAC** : DOCTOR/NURSE (min NURSE) ; patient/VIEWER → 403. Scopé patient (anti-IDOR → 404). Audité
  (`proposal.generator.on_demand` : acteur soignant réel, fenêtre, résultat, sans PHI).

### Niveau de maturité du patient (US-2657 slice A)

`Patient.maturityLevel` (enum `MaturityLevel { JUNIOR, INTERMEDIATE, CONFIRME }`, **défaut JUNIOR**) — niveau
d'autonomie (ETP) **posé par le soignant**, jamais auto-déclaré. Gate les capacités du **PATIENT (rôle
VIEWER)** dans `deriveEditCapability` :
- **JUNIOR** → `canEditSlots = false` : le patient ne propose que des **valeurs** (pas de restructuration).
- **INTERMEDIATE / CONFIRME** → `canEditSlots = true` : + créneaux (ajouter/supprimer/déplacer les heures).
- **DOCTOR/ADMIN** (édition directe) et **NURSE** (clinicien) : `canEditSlots = true` sans condition de maturité.
- Fail-closed : `canEditSlots = false` si rien n'est éditable (config incohérente / mode non éditable).

Pose du niveau : `PATCH /api/patients/[id]/maturity`, **exactement DOCTOR** (`requireRole("DOCTOR")` +
exclusion explicite d'ADMIN) → un patient (VIEWER) ne peut **jamais** s'auto-élever (403). Idempotent,
audité `UPDATE PATIENT` (metadata `from → to`, sans PHI). `patientService.setMaturityLevel`.

**Depuis 2026-07-10** : le niveau de maturité gouverne **uniquement** les capacités d'édition du patient
(proposer des valeurs, proposer une restructuration de créneaux, refuser/contre-proposer). Il n'existe plus
de voie d'**auto-application** experte gouvernée ; toute édition d'un patient expert génère une
**proposition** (statut `pending`) validée par un médecin. L'auto-application experte a été retirée (US-2657).

