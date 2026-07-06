# Algorithme de calcul des propositions d'ajustement

> **Portée** — Document technico-fonctionnel de référence de l'algorithme qui **génère** les
> propositions d'ajustement d'insulinothérapie (`proposal-algorithm.ts`). Épic US-2645, US-2651.
> **Source de vérité = le code** (`src/lib/proposal-algorithm.ts`, `src/lib/clinical-bounds.ts`,
> `src/lib/services/adjustment.service.ts`) ; ce document en est le catalogue fonctionnel.
> **⚠️ US-2651 exige la validation `medical-domain-validator`** (voir §7 « Points à valider »).

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

## 6. Chaîne complète (génération → application)

1. **Génération** (`proposal-algorithm`, pur) → `ProposalCandidate` (déjà clampé ± 20 %, ≥ 3 événements, ≥ 2 %).
2. **Persistance** (`adjustmentService.createProposal`) — re-vérifie : frontière nonInsulin (refus),
   **bornes dures** (`validateProposedValue`), `currentValue` **dérivé serveur** (jamais du body),
   garde-fous **proposeur** (cap patient ± 10 %, basale patient jamais en baisse, **cooldown 24 h**
   patient), anti-spam (index `one_pending_per_slot`). Statut `pending`.
3. **Validation médecin** (`accept`) — re-vérifie les bornes + **compare-and-swap** (`baselineMoved`)
   si la base a bougé depuis la proposition. Application scopée patient.

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
