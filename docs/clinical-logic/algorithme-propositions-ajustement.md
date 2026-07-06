# Algorithme de calcul des propositions d'ajustement

> **Portée** — Document technico-fonctionnel de référence de l'algorithme qui **génère** les
> propositions d'ajustement d'insulinothérapie (`proposal-algorithm.ts`). Épic US-2645, US-2651.
> **Source de vérité = le code** (`src/lib/proposal-algorithm.ts`, `src/lib/clinical-bounds.ts`,
> `src/lib/services/adjustment.service.ts`) ; ce document en est le catalogue fonctionnel.
> **⚠️ US-2651 exige la validation `medical-domain-validator`** (voir §7 « Points à valider »).

---

## 0. Glossaire (termes techniques & abréviations)

> À lire d'abord — ce document emploie du vocabulaire clinique et technique. Aucun terme ci-dessous
> n'est laissé sans définition dans le corps du document.

### Termes techniques & cliniques

| Terme | Définition |
|---|---|
| **Nadir** | Point le **plus bas** de la glycémie sur une fenêtre donnée (ici, le creux post-prandial ou nocturne). Une moyenne peut masquer un nadir dangereux → on le fournit explicitement à la garde hypo. |
| **Bucketing** (repas → créneau) | Regroupement de chaque **repas dans le créneau horaire** (d'ICR) qui couvre son heure, afin d'analyser un ratio par créneau. « Bucket » = seau/panier. |
| **Deadband** (zone morte) | Plage de glycémie autour de la cible où **aucune proposition** n'est émise (évite de titrer sur du bruit ou sur un patient déjà bien contrôlé). Ici **asymétrique** : bornes haute et basse distinctes. |
| **Post-prandial** | **Après le repas** (par opposition à « à jeun »). La glycémie post-prandiale est physiologiquement plus haute qu'à jeun, même avec un dosage parfait. |
| **Titration** | Ajustement **progressif et prudent** d'une dose, par petits pas, jusqu'à l'objectif (d'où les caps ± 20 % / ± 2 U). |
| **Effet Somogyi** | **Hypo nocturne** suivie d'un **rebond hyperglycémique** au réveil. Piège : la glycémie à jeun est haute alors qu'il y a eu une hypo → augmenter la basale serait dangereux. |
| **Dawn phenomenon** (phénomène de l'aube) | Montée **physiologique** de la glycémie en fin de nuit (sécrétion hormonale) qui peut élever la moyenne à jeun sans excès d'insuline manquant. |
| **Fail-closed** | En cas de doute ou de donnée manquante, le système **refuse** (aucune proposition/aucune dose) plutôt que de risquer une valeur erronée. Sécurité par défaut. |
| **Fail-closed containment** | Variante du bucketing : ne rattacher un moment à un créneau **que s'il y tient entièrement**, sinon on **skip** (pas de mauvaise attribution). |
| **Snapshot → persist** | Le candidat est calculé sur un **instantané** (snapshot) de la config ; s'il a **dérivé** avant l'enregistrement, on rejette (`baselineMovedAtPersist`). |
| **Compare-and-swap** (`baselineMoved`) | Vérifier que la **valeur de base n'a pas changé** entre lecture et écriture avant d'appliquer ; sinon on annule. |
| **Hypo sévère / légère** | Hypoglycémie **niveau 2** (< 0,54 g/L, urgence clinique) / **niveau 1** (0,54–0,70 g/L, à traiter mais moins critique). |
| **Bolus / basal** | **Bolus** = insuline ponctuelle (repas ou correction). **Basale** = insuline de fond, continue (débit U/h). |

### Abréviations & sigles

| Sigle | Développé | Sens |
|---|---|---|
| **ICR** | *Insulin-to-Carb Ratio* | Ratio insuline/glucides — grammes de glucides couverts par 1 unité d'insuline. |
| **ISF** | *Insulin Sensitivity Factor* | Facteur de sensibilité — baisse de glycémie attendue pour 1 unité d'insuline. |
| **PPG** | *PostPrandial Glucose* | Glycémie post-prandiale ; ici mesurée **à 2 h** (« PPG 2 h »). |
| **CGM** | *Continuous Glucose Monitoring* | Mesure du glucose **en continu** (capteur interstitiel). |
| **BGM** | *Blood Glucose Monitoring* | Glycémie **capillaire** (lecteur au bout du doigt). |
| **TIR** | *Time In Range* | Temps passé dans la cible glycémique. |
| **HbA1c** | Hémoglobine glyquée | Reflet de la glycémie moyenne des ~3 derniers mois. |
| **MDR** | *Medical Device Regulation* | Règlement européen (UE) 2017/745 sur les dispositifs médicaux. |
| **IEC 62304** | — | Norme du **cycle de vie du logiciel** de dispositif médical. |
| **GD** | Diabète gestationnel | Diabète de la grossesse (cibles plus strictes). |
| **DT1 / DT2** | Diabète de type 1 / type 2 | — |
| **U** / **U/h** | Unité(s) d'insuline | Dose / débit (unités par heure pour la basale). |
| **g/L** / **mg/dL** | — | Unités de glycémie. **1 g/L = 100 mg/dL**. |
| **ADA** | *American Diabetes Association* | Source de plusieurs seuils (PPG < 180 mg/dL, etc.). |

---

## 1. Principe & garde-fous fondamentaux

- Une proposition est une **suggestion**, **JAMAIS** appliquée automatiquement (ADR #13). Format :
  `AdjustmentProposal` (statut `pending`) → validation **DOCTOR** (accept/reject) → application.
- **Frontière dispositif médical (MDR / IEC 62304)** : l'algorithme ne recommande **jamais** de
  posologie orale/GLP-1. Un patient **non insuliné** (mode c) ne reçoit **aucune** proposition de
  dose (voir §5) — refus serveur `nonInsulinNoDose` + `ClinicalReviewFlag` d'orientation.
- **Fail-closed** : toute valeur hors bornes cliniques est refusée à la création
  (`adjustmentService.createProposal`), pas seulement à l'accept.
- **Séparation des responsabilités** :
  - `proposal-algorithm.ts` = **pur** (aucune I/O) — calcule des *candidats* à partir de données déjà agrégées.
  - `adjustmentService.createProposal` = persistance + **re-validation** des bornes + garde-fous
    proposeur (cap patient, sens interdit, cooldown) + audit.

## 2. Constantes (source : `CLINICAL_BOUNDS`)

| Constante | Valeur | Rôle |
|---|---|---|
| `MAX_CHANGE_PERCENT` | **± 20 %** | Cap de variation **moteur** : toute proposition auto est clampée à ± ce %. |
| Seuil « minimum d'événements » | **3** | En dessous → aucune proposition (bruit statistique). |
| Seuil « variation significative » | **2 %** | `|changePercent| < 2 %` → aucune proposition (non actionnable). |
| `PATIENT_MAX_CHANGE_PERCENT` | ± 10 % | Cap **patient** (proposition self-service) — plus strict que le moteur, appliqué au niveau service. |

## 3. Primitives communes (`proposal-algorithm.ts`)

- **`getConfidenceLevel(eventCount)`** — force de preuve par volume :
  - `> 10` événements → `high`
  - `6 – 10` → `medium`
  - `< 6` → `low`
- **`clampChangePercent(pct)`** — borne `pct` dans `[-20, +20]` (`MAX_CHANGE_PERCENT`).
- **`computeProposedValue(current, changePercent)`** — `current × (1 + clamp(changePercent)/100)`,
  arrondi à 4 décimales.

## 4. Mode (a) — basal/bolus complet (existant)

Trois analyseurs, chacun : **≥ 3 événements** requis, **|variation| ≥ 2 %** requise, sinon `null`.
Base d'erreur relative = écart moyen à la cible. `confidence` = `getConfidenceLevel(nb événements)`.

### 4.1 `analyzeIsfSlot(slot, corrections[])` — facteur de sensibilité (ISF)
- Entrée : glycémies **post-correction** vs cible, pour un créneau horaire.
- `errorPercent = ((avgPost − avgTarget) / avgTarget) × −100`, puis clampé.
- **Sens (code, cliniquement correct)** :
  - Glycémie post-correction **au-dessus** de la cible → correction trop faible → **ISF trop haut** →
    proposition de **baisse** de l'ISF (`reason = isfTooHigh`).
  - **En dessous** de la cible (sur-correction) → **ISF trop bas** → **hausse** (`reason = isfTooLow`).

### 4.2 `analyzeIcrSlot(slot, meals[])` — ratio insuline/glucides (ICR)
- Entrée : glycémies **post-repas** vs cible, pour un créneau horaire.
- `errorPercent = ((avgPost − avgTarget) / avgTarget) × −100`, puis clampé.
- **Sens (direction du changement, cliniquement correcte)** :
  - Post-repas **au-dessus** de la cible → bolus trop faible → **baisse** de l'ICR (plus d'insuline/gramme),
    `reason = icrTooHigh` (l'ICR courant est trop haut).
  - **En dessous** → **hausse** de l'ICR, `reason = icrTooLow`.

### 4.3 `analyzeBasalTrend(fastingValues[], targetGl, currentRate)` — débit basal
- Entrée : glycémies **à jeun** (pré-petit-déjeuner) vs cible, débit basal courant.
- `errorPercent = ((avgFasting − targetGl) / targetGl) × 100` (**pas** de ×−1 ici — dérive directe).
- **Sens** :
  - Glycémie à jeun **au-dessus** de la cible (montée nocturne) → basale **trop basse** → **hausse**
    (`reason = basalTooLow`).
  - **En dessous** (chute nocturne) → basale **trop haute** → **baisse** (`reason = basalTooHigh`).

> Sortie de chaque analyseur : `ProposalCandidate` (`parameterType, reason, currentValue,
> proposedValue, changePercent, confidence, supportingEvents, totalEventsConsidered,
> timeSlotStartHour?/EndHour?, averageObservedValue?`).

## 5. Multi-mode (US-2651) — routage par `treatmentMode`

Le mode est **dérivé serveur** (`resolveTreatmentMode`, fail-closed : un DT1 n'est jamais `nonInsulin`).

| Mode | Logique de proposition |
|---|---|
| **(a) basalBolus** | Analyseurs ISF/ICR/basal du §4 (existant). |
| **(b) fixedDose** | **`analyzeFixedDose(slot, readings)` (livré, pur)** : dose **directe** par **moment** (carnet BGM). Au-dessus de la cible → dose trop basse → hausse (`fixedDoseTooLow`) ; en dessous → baisse (`fixedDoseTooHigh`). Bornée : **plus petit** de ± `FIXED_DOSE_MAX_CHANGE_PERCENT` (10 %) et ± `FIXED_DOSE_MAX_DELTA_U` (2 U) ; plancher `FIXED_DOSE_MIN` (0,5 U) ; arrondi à l'incrément délivrable (0,5 U) — pas nul → aucune proposition. **Cooldown 72 h/moment** (`FIXED_DOSE_COOLDOWN_HOURS`) au câblage du générateur (pas dans l'analyseur pur). **Jamais** : convertir doses fixes → basal-bolus, ni créer ISF/ICR ex nihilo. |
| **(c) nonInsulin** | **Aucune proposition de dose** (frontière MDR). Uniquement des `ClinicalReviewFlag` d'orientation (« à revoir en consultation », HbA1c périmée, TIR sous cible, observance). La **cible** glycémique reste ajustable **par le médecin** (bornée, plus stricte en `pregnancyMode`). |

## 5ter. Générateur ICR nocturne (mode a) — spec d'implémentation (validée medical, US-2651)

> **Statut** : spec **validée** avant build (`proposalGeneratorService.generateForPatient`, chemin ICR).
> Les analyseurs sont purs et prêts ; ce qui suit est le **contrat d'assemblage** des données qui les
> nourrit, corrigé des 6 points relevés par `medical-domain-validator`. **Le générateur qui persiste
> ne sera câblé qu'une fois ces contrats tenus** — sinon risque d'emballement hypo.

**Source & fenêtre** — `mealtimePattern.dailyJournal(patientId, "14d", …, {source:"cgm"})`. CGM (pas BGM :
un BGM n'a quasi jamais un relevé pile à +2 h). PPG 2 h en mg/dL → **÷ 100** en g/L. Filtrer `postMgdl null`.

**Cible = post-prandiale, JAMAIS à jeun (CRITICAL)** — nourrir l'analyseur avec la cible à jeun (~1,0 g/L)
proposerait des **baisses d'ICR systématiques** (plus d'insuline) chez des patients bien contrôlés →
**emballement vers l'hypo**. Utiliser un **deadband asymétrique** :
- PPG moyenne **> plafond** `getCgmDefaults(isPregnancy ? "GD" : pathologie).ok` (**1,80** adulte /
  **1,40** GD-grossesse) → **baisse** d'ICR (plus d'insuline).
- PPG moyenne **< borne basse** (`POSTPRANDIAL_TITRATION_LOW_GL` = **1,0** ; grossesse
  `…_PREGNANCY_GL` = **0,9**) → **hausse** d'ICR (moins d'insuline).
- **Entre les deux → aucune proposition** (bon contrôle préservé).

**Grossesse (HIGH)** — `isPregnancy = patient.pregnancyMode === true || pathologie === "GD"`. Un DT1
**enceinte** a `pathologie = DT1` → `getCgmDefaults("DT1")` renverrait 1,80 (trop lâche pour la
population la plus à risque). Répliquer exactement la règle de `meal-trends`.

**Nadir post-prandial tardif (HIGH)** — la garde hypo ne voit que le point +2 h ; le nadir d'un analogue
rapide tombe à ~3-4 h. Fournir à `hypoBlocksProposal` le **nadir** glycémique sur
`[t0, min(prochain glucide, t0 + POSTMEAL_NADIR_WINDOW_MIN=300 min)]`, **pas** seulement la PPG 2 h
(la *moyenne* qui pilote la direction reste sur la PPG 2 h). `JournalMeal` n'expose ni l'heure ni le
nadir → **prérequis build** : augmenter l'assemblage (au niveau `DiabetesEvent`/`meal-trends`).

**Bucketing meal → créneau ICR (MEDIUM/HIGH)** — bucketer à l'**heure réelle** du repas
(`findSlotForHour(carbRatios, heureLocale)`), **jamais** au midpoint du moment (une frontière de créneau
peut tomber au milieu d'un moment → mauvaise attribution). Fallback si contraint au moment : **fail-closed
containment** (bucketer seulement si le moment entier tient dans un seul créneau, sinon skip).

**Portes qualité (MEDIUM/HIGH)** — exclure un repas si : glucides absents/0 (`carbs`), bolus absent
(`bolus`), ou pré-repas hors bande cible (`preMgdl` — la PPG refléterait une correction, pas l'ICR).
Les repas avec glucide intercurrent avant t0+90 sont déjà nullés en amont (`computeJournal`).

**Minimum de preuve** — **≥ 3 repas/créneau** (aligné `analyzeIcrSlot` + `BGM_CARNET.MIN_READINGS_PER_MOMENT`),
sinon fail-closed (aucune proposition).

**Persistance** — chaque candidat → `createEngineProposal({ …, expectedCurrentValue: candidat.currentValue,
carbRatioSlotStart, carbRatioSlotEnd })` : re-dérive `currentValue`, re-borne, garde hypo (déjà dans
l'analyseur), anti-spam, frontière nonInsulin. Cooldown moteur au niveau générateur.

## 6. Chaîne complète (génération → application)

1. **Génération** (`proposal-algorithm`, pur) → `ProposalCandidate` (déjà clampé ± 20 %, ≥ 3 événements, ≥ 2 %).
2. **Persistance** (`adjustmentService.createProposal`) — re-vérifie : frontière nonInsulin (refus),
   **bornes dures** (`validateProposedValue`), `currentValue` **dérivé serveur** (jamais du body),
   garde-fous **proposeur** (cap patient ± 10 %, basale patient jamais en baisse, **cooldown 24 h**
   patient), anti-spam (index `one_pending_per_slot`). Statut `pending`.
3. **Validation médecin** (`accept`) — re-vérifie les bornes + **compare-and-swap** (`baselineMoved`)
   si la base a bougé depuis la proposition. Application scopée patient.

## 6bis. Persistance d'une proposition MOTEUR — `createEngineProposal` (US-2651)

`createProposal` est **humain-only** (source patient/nurse/doctor ; viole la contrainte CHECK
`algorithm`). Le générateur persiste via **`adjustmentService.createEngineProposal(input, ctx)`** :
`source = algorithm`, `proposedByUserId = null`, métriques moteur (`confidence`/`supportingEvents`)
**non nulles** (CHECK). Reprend les garde-fous serveur de `createProposal` : frontière **nonInsulin**
(MDR), **bornes dures**, `currentValue` **re-dérivé serveur** (le candidat est calculé sur un snapshot →
re-vérif contre la config LIVE) + `changePercent` recalculé, **anti-spam** (`one_pending_per_slot`).
Statut `pending` ; notifie le référent (best-effort). Le générateur fournit les **discriminateurs de
créneau** selon le slot analysé (ISF/ICR → `timeSlot*`/`carbRatio*` ; basal → `pumpBasalSlotId`).

**Fenêtre snapshot→persist (validé medical)** : le candidat est calculé sur `expectedCurrentValue`
(snapshot). Si la config a **dérivé** entre l'analyse et la persistance, `createEngineProposal`
**REJETTE** (`baselineMovedAtPersist`) au lieu de persister une magnitude hors-cap ou un sens inversé
(le `baselineMoved` de l'accept ne couvre que persist→accept). En défense en profondeur, la cohérence
`reason` ↔ signe du delta est asservie (`reasonDirectionMismatch`), et `supportingEvents > 0` exigé.

## 7. Validation `medical-domain-validator` (US-2651) — verdicts

Deux incohérences **clinique↔code** relevées en documentant, **validées et corrigées** dans cette slice
(directions appliquées toutes correctes → **aucun CRITICAL** ; grep confirmé : **aucun consommateur ne
dérive la direction/dose depuis `reason`** → le libellé n'impacte que l'explication affichée) :

1. **Commentaire ISF (`analyzeIsfSlot`) — CORRIGÉ.** L'ancien commentaire était **inversé** ; le **code
   était correct** (au-dessus de la cible → ISF trop haut → baisse). Commentaire réécrit pour matcher le code.
2. **Libellés `reason` ICR (`analyzeIcrSlot`) — CORRIGÉ.** La **direction** était correcte mais les
   **libellés étaient inversés** (`icrTooLow`↔`icrTooHigh`) — ils contredisaient le commentaire (correct)
   de la fonction et affichaient une mauvaise explication au médecin. Ternaire corrigé + test de verrou
   ajouté. Sévérité MEDIUM (aucun impact dose ; aucun consommateur ne lit la direction depuis `reason`).
3. **Basal — aucun défaut** (direction + libellé corrects). Seuils (`±20 %`, `≥3 événements`, `≥2 %`, cap
   patient 10 %, cooldown 24 h) **cliniquement défendables** (jamais auto-appliqué, confiance graduée).

**Reste à livrer** — `proposal-algorithm.ts` n'est **relié à aucune persistance** (seulement testé). Le
router multi-mode (§5), `analyzeFixedDose*` (mode b) et le câblage `→ createProposal` restent à faire ;
toute sortie devra repasser par la frontière nonInsulin + les bornes (§6).
