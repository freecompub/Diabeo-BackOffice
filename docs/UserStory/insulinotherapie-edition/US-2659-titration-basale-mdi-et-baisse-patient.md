# US-2659 — Titration de la basale **stylo (MDI)** & proposition patient de **baisse basale** par mode de délivrance

> 📌 Sous-US de [US-2645](US-2645-EPIC-insulinotherapie-edition-multimode.md) (épic édition insulinothérapie multi-mode) · **back + migration + contrat iOS** · Taille **L** · **Version : V1**
>
> **Statut** : ✅ **LIVRÉ** (S0–S3, PRs #723→#726 ; S3 en attente de merge) — cadrage + design de chaque slice validés `medical-domain-validator` (+ HDS pour S3). Slices : **S0** socle schéma (#723) · **S1** single_injection (#724) · **S2** split_injection (#725) · **S3** baisse patient gatée (#726). Détails : ADR #29 (CLAUDE.md) + catalogue `docs/clinical-logic/regles-et-constantes-diabete.md`.
> **Risque** : **MOYEN-ÉLEVÉ** — (1) nouvelle logique de titration clinique (basale stylo), (2) **relâchement d'un garde-fou patient de sécurité** (baisse de basale). Validate-first appliqué ; toute slice repasse en revue `medical-domain-validator` + `code-reviewer` (+ `healthcare-security-auditor` / `prisma-specialist` / `swift-expert` selon la slice).
> **Dépend de** : US-2651 (générateur multi-levier), US-2650 (une proposition à la fois), US-2657 (niveaux de maturité `JUNIOR/INTERMEDIATE/CONFIRME`), US-2646 (provenance + discriminateurs de créneau).
> **Sources code** : `src/lib/services/proposal-generator.service.ts` (bloc basal ~L320-420 ; `generateFixedDoseProposals`), `src/lib/proposal-algorithm.ts` (`analyzeBasalTrend`, dé-escalade, `hypoWindowBlocks`), `src/lib/clinical-bounds.ts`, `src/lib/services/treatment-mode.service.ts`, `src/lib/services/adjustment.service.ts` (`createProposal` garde patient), `prisma/schema.prisma` (`BasalConfiguration`, `PumpBasalSlot`, `AdjustmentProposal`, enum `BasalConfigType`).

---

## 1. Intention (voix produit)

> **Médecin** : « Mon patient est sous **stylo** (basale lente une fois par jour, ou matin + soir). Aujourd'hui l'algorithme ne me propose **rien** sur sa basale — il ne titre que les patients sous **pompe**. Or c'est justement là que j'ai besoin d'une aide à la décision rapide et **pertinente** : titrer sa dose lente sur sa glycémie à jeun, comme un treat-to-target. »
>
> **Patient (autonomie graduée)** : « Je fais des hypos et je pense que ma basale est trop forte. Je ne peux même pas le **proposer** à mon médecin depuis l'appli — alors que ce n'est qu'une proposition qu'il validera. Proposer et en discuter, c'est ma formation. »

Deux constats, une même racine : **la gestion de la basale doit distinguer le mode de délivrance** (pompe vs stylo), parce que le geste, la granularité et le risque diffèrent — et parce que l'algorithme n'existe que pour faire au médecin des **propositions pertinentes**.

### État actuel (vérifié dans le code)

`BasalConfigType` = **`pump`** · **`single_injection`** (1 dose lente/jour) · **`split_injection`** (2 doses, matin + soir).

| | Basale **pompe** | Basale **stylo (MDI)** |
|---|---|---|
| Stockage | `PumpBasalSlot` (créneaux, U/h) | `BasalConfiguration.dailyDose` / `morningDose` / `eveningDose` (U) |
| Titrée par l'algorithme | ✅ créneau nocturne (`analyzeBasalTrend`, glycémie à jeun) | ❌ **rien** (bloc gaté `configType === "pump"`) |
| Proposable par-valeur | ✅ (`basalRate` → `pumpBasalSlotId`) | ❌ **aucune cible** (pas de créneau pompe) |
| Baisse patient | ❌ interdite (`patientDecreaseForbidden`) | ❌ interdite **et** non représentable |

> ⚠️ Confirmé par `grep` : **aucune** référence à `dailyDose`/`morningDose`/`eveningDose` dans le générateur, l'algorithme ou le service de propositions. Un patient basal-bolus **sous stylo** — comme un patient purement stylo — n'obtient **aucune** proposition basale. C'est la « limite connue » à combler.

---

## 2. Décisions actées (cadrage clinique validé)

| # | Décision | Justification clinique |
|---|----------|------------------------|
| **D1** | Étendre la titration basale au **stylo** (single & split), en **plus** de la pompe (inchangée). | L'algorithme doit faire des propositions **pertinentes** à toute la population insulinée, pas seulement aux porteurs de pompe. |
| **D2** | **single_injection** → titrer `dailyDose` sur la **glycémie à jeun** (treat-to-target). | Dose lente une fois/jour = signal à jeun (ADA 2025 §9 ; Riddle Treat-to-Target 2003). |
| **D3** | **split_injection** → **dose du soir titrée sur la glycémie à jeun** ; **dose du matin sur la glycémie pré-dîner**. | Fenêtre d'action de chaque injection (NPH/detemir : soir → nuit ; matin → journée). |
| **D4** | **Une seule dose basale titrée par run** (split). L'autre dose doit être **sans proposition `pending`**. Priorité au **soir/à jeun** si les deux signaux dévient. | Fenêtres d'action qui se chevauchent → changer les deux à la fois détruit l'**attribution** et risque l'empilement/sur-correction. L'hypo nocturne est le mode d'échec le plus grave → priorité. |
| **D5** | Hausse = **max(+2 U, +10 %)**, plafonnée à **+20 % ET ≤ +4 U**. Baisse (hypo) = **−20 % ou −4 U** (asymétrique, plus agressive côté sécurité). | Treat-to-target (ADA/INSIGHT +2 U ; réduction 10–20 % ou 4 U sur hypo). |
| **D6** | Incrément stylo = **1 U** (adulte) ; **0,5 U** seulement si le dispositif est un stylo demi-unité. **Défaut fail-closed = 1 U.** Plancher **0,5 U**, alerte à **80 U** (**non bloquante** — DT2 insulino-résistant / U300 / dégludec). | Résolution réelle des stylos. **JAMAIS** l'incrément pompe 0,05 U/h (mismatch U/h vs U totales). |
| **D7** | Fenêtre d'analyse **7 j** (plus réactive que 14 j), **≥ 3** glycémies à jeun valides. Cooldown **72 h** (steady state 3–4 j). | Titration treat-to-target tous les 3 j ; steady state glargine/detemir. |
| **D8** | **Garde BGM (différence pompe↔stylo).** Un patient MDI est souvent en **BGM** (pas de nadir CGM nocturne). Une **hausse** n'est autorisée que si des relevés **coucher + réveil** existent ; sinon → **flag**, jamais une hausse (l'absence de donnée nocturne masquerait une hypo à 3 h). | Sécurité : la garde hypo pompe s'appuie sur le nadir CGM ; en BGM il faut corroborer avant de monter. |
| **D9** | **Garde hypo** : mêmes seuils (sévère < 0,54 g/L **isolée** ; ≥ 2 relevés < 0,70 g/L), **fenêtre suivant la dose** (nadir nocturne → dose du soir ; nadir de jour → dose du matin). **Dé-escalade** fixe (−2 U/−20 %, snap 1 U, plancher 0,5 U, 72 h) ; non-actionnable → **flag**, jamais silencieux. | Transfert des invariants US-2651/US-2653 à la basale stylo. |
| **D10** | **Somogyi** : à jeun HAUT + hypo nocturne récurrente → **flag** (`nocturnalHypoHighFasting`), **jamais** une baisse auto. **Encore plus vrai en stylo** (on ne peut bouger que la **dose entière**, pas un micro-débit). | Direction non fiable (Somogyi vs aube) ; en stylo, baisser « corrige » le creux mais remonte tout l'overnight. |
| **D11** | **Constantes dédiées `MDI_BASAL_*`** (voir §4). Ne PAS réutiliser telles quelles ni les bornes pompe (U/h) ni les bornes dose fixe (0,5 U / ±2 U trop serrées pour une basale adulte). | Sémantique et magnitudes propres à la basale stylo. |
| **D12** | **Discriminateur de cible** `AdjustmentProposal.basalDoseKind` (`daily` / `morning` / `evening`) — **pré-requis** de D2–D10 (aucune cible stylo n'existe aujourd'hui). Étend l'index « 1 pending / (patient × paramètre × cible) ». | Sans cible adressable, ni le moteur ni le patient ne peuvent proposer sur une basale stylo. **Contrat iOS** → coordination `swift-expert`. |
| **D13** | **Voie d'écriture = groupée** (ADR #23/#26). Un ajustement de basale stylo accepté passe par le **remplacement** de la config basale (comme `replaceSlotSet`/`replacePumpSlotSet`), pas une route par-valeur ressuscitée. | Cohérence grouped-only ; supersession des propositions pending. |
| **D14** | **Jamais auto-appliqué** (ADR #13). Toute sortie = `AdjustmentProposal` `pending` gatée médecin. L'auto-application experte reste **retirée** (ADR #28). | Contrat de sûreté du produit. |

### Décisions produit à confirmer (portées par cette US)

| # | Question | Reco cadrage | À trancher |
|---|----------|--------------|-----------|
| **P1** | Baisse basale **proposable par le patient** ? | ✅ Oui (le médecin est le garde-fou ; interdire est anti-ETP) — voir §5. | ☐ |
| **P2** | Gates de la baisse patient | **Pompe** dès `INTERMEDIATE` (≤ 10 %) ; **Stylo** `CONFIRME` uniquement (≤ min(10 %, 2 U)). | ☐ |
| **P3** | Cooldown **dégludec** = 96 h (t½ ~25 h) ? nécessite de lire `InsulinCatalog` (dispo). | Recommandé ; sinon **72 h partout en V1** (simplification). | ☐ |

---

## 3. La titration basale stylo — logique par type

### 3.1 `single_injection` (dose lente une fois/jour)

- **Signal** : glycémie à jeun (pré-petit-déjeuner). Réutilise `fastingTrend` + la direction de `analyzeBasalTrend`.
- **Hausse** : `max(+2 U, +10 %)`, plafonnée à `+20 %` **et** `≤ +4 U`. **Baisse** : `−20 %` **ou** `−4 U`. Snap à l'incrément stylo (défaut **1 U**), plancher **0,5 U**.
- **Garde BGM (D8)** : hausse conditionnée à des relevés coucher + réveil ; sinon **flag**.
- **Somogyi (D10)** : à jeun HAUT + hypo nocturne récurrente → **flag**.
- **Analyse** : fenêtre 7 j, ≥ 3 à jeun ; cooldown 72 h (96 h dégludec — P3).

### 3.2 `split_injection` (matin + soir)

- **Dose du soir → glycémie à jeun** ; **dose du matin → glycémie pré-dîner**.
- **Une seule dose titrée par run** ; l'autre doit être sans `pending` ; priorité **soir/à jeun**.
- **Garde hypo fenêtre-suivant-la-dose** : nadir **nocturne** → dose du **soir** ; nadir **de jour/pré-dîner** → dose du **matin**. Jamais croisé.
- **Confondeur pré-dîner** : si le patient porte des doses prandiales, marquer le signal pré-dîner **basse confiance** → préférer un **flag** à une proposition sur la dose du matin.

### 3.3 Ce qui NE change PAS (pompe)

Le chemin pompe (`analyzeBasalTrend` sur le créneau nocturne, snap 0,05 U/h, `pumpBasalSlotId`) est **inchangé**. Cette US **ajoute** le chemin stylo à côté ; le routage se fait sur `BasalConfiguration.configType`.

---

## 4. Constantes cliniques dédiées (`MDI_BASAL_*`)

> À inscrire dans `src/lib/clinical-bounds.ts` **et** au catalogue `docs/clinical-logic/regles-et-constantes-diabete.md` **dans la même PR** (règle CLAUDE.md — verrou anti-drift `clinical-bounds.test.ts`).

| Constante | Valeur | Sens |
|---|---|---|
| `MDI_BASAL_MIN_U` | **0,5** | Plancher de sanité (= `FIXED_DOSE_MIN`) |
| `MDI_BASAL_WARN_U` | **80** | Seuil d'**avertissement** (non bloquant ; = `FIXED_BASAL_WARN_U`) |
| `MDI_BASAL_STEP_U` | **2** | Pas de hausse treat-to-target |
| `MDI_BASAL_MAX_DELTA_U` | **4** | Cap absolu par ajustement (= pas de réduction sur hypo) |
| `MDI_BASAL_MAX_CHANGE_PERCENT` | **20** | Cap % (ADA 10–20 %) |
| `MDI_BASAL_DELIVERY_INCREMENT_U` | **1** (adulte) / **0,5** (stylo demi-unité) | Résolution du stylo ; défaut fail-closed 1 U |
| `MDI_BASAL_COOLDOWN_HOURS` | **72** (**96** dégludec — P3) | Steady state 3–4 j |
| `MDI_BASAL_ANALYSIS_DAYS` | **7** | Fenêtre d'analyse (plus réactive) |

---

## 5. Proposition patient de **baisse** basale, par mode de délivrance

### 5.1 Le constat clinique (cadrage validé)

L'asymétrie actuelle — un patient peut proposer de **monter** la basale (ajoute du risque hypo, seulement rattrapé par la garde) mais **pas de la baisser** (sens hypo-sûr) — est **rejetée** sous un modèle « proposition gatée médecin » : **le médecin est le garde-fou**, interdire la proposition est paternaliste et contraire à l'ETP.

### 5.2 Règles (par mode de délivrance)

| | **Pompe** | **Stylo (MDI)** |
|---|---|---|
| Baisse **proposable** | ✅ dès **INTERMEDIATE** | ✅ **CONFIRME uniquement** |
| Amplitude | ≤ **10 %** (`PATIENT_MAX_CHANGE_PERCENT`) | ≤ **min(10 %, 2 U)** |
| Avertissement obligatoire (ETP, non bloquant) | Somogyi/rebond | **Somogyi + jour de maladie / DKA** (accusé **requis**) |
| Cooldown | 24 h | 24 h |
| Valeur courante | **lue serveur** (anti-tamper) | **lue serveur** |
| Application | ❌ jamais — proposition `pending`, médecin décide | ❌ jamais — `pending`, médecin décide |

- **Avertissement Somogyi** : « Si votre glycémie du matin est *haute* mais que vous descendez *bas* la nuit, baisser la basale peut être le mauvais geste — à discuter avec votre équipe. »
- **Avertissement DKA (stylo, obligatoire)** : « Ne réduisez jamais votre basale en cas de maladie ; réduire la basale augmente le risque de cétose/acidocétose. »
- **Lien flag** : si un flag `nocturnalHypoHighFasting` est ouvert, en attacher le contexte à la revue médecin de la baisse.

### 5.3 Ce qui reste interdit

- Baisse basale **stylo** pour un patient `JUNIOR` / `INTERMEDIATE` (acte de littératie de titration → `CONFIRME`).
- Toute **application** sans médecin (invariant absolu, ADR #13).

---

## 6. Critères d'acceptation

- **AC-1** Un patient `single_injection` avec glycémie à jeun hors zone (≥ 3 relevés, 7 j) reçoit une **proposition** de titration de `dailyDose` (hausse ou baisse) — `pending`, gatée médecin. Bornes/pas `MDI_BASAL_*` respectés, snap 1 U.
- **AC-2** Un patient `split_injection` reçoit au plus **une** proposition basale par run (soir OU matin), la dose du soir titrée sur l'à jeun, la dose du matin sur le pré-dîner ; jamais les deux.
- **AC-3** Garde hypo : une hypo sévère (< 0,54) **isolée** dans la fenêtre de la dose supprime toute **hausse** ; des hypos récurrentes déclenchent une **dé-escalade** bornée ; une baisse non actionnable (plancher / < 1 incrément) lève un **flag**, jamais un skip silencieux.
- **AC-4** Garde BGM : sans relevés coucher **et** réveil, une **hausse** stylo est refusée → **flag** (pas de hausse à l'aveugle).
- **AC-5** Somogyi : à jeun HAUT + hypo nocturne récurrente → **flag** `nocturnalHypoHighFasting`, aucune baisse auto.
- **AC-6** Un patient **pompe** `INTERMEDIATE`+ peut **proposer** une baisse basale (≤ 10 %) ; un patient **stylo** `CONFIRME` peut proposer une baisse (≤ min(10 %, 2 U)) avec accusé DKA ; tout `JUNIOR` et tout stylo non-`CONFIRME` : refus explicite.
- **AC-7** Aucune proposition n'est **jamais** auto-appliquée ; la basale pompe reste titrée comme avant (non-régression).
- **AC-8** Les constantes `MDI_BASAL_*` figurent au catalogue clinique (même PR, verrou anti-drift vert).

---

## 7. Découpage (slices — chacune validate-first + revue)

| Slice | Contenu | Dépend de | Contrat iOS | État |
|---|---|---|---|---|
| **S0 — Socle schéma** | `AdjustmentProposal.basalDoseKind` (`daily`/`morning`/`evening`) + extension index « 1 pending » + CHECK exclusivité + migration. `MDI_BASAL_*` constantes + catalogue. | — | ⚠️ oui | ✅ **#723** |
| **S1 — Titration single_injection** | Analyseur pur + chemin générateur (`dailyDose`, à jeun, hold zone asymétrique, garde BGM/AC-4, dé-escalade `−min`, Somogyi, cooldown post-changement). | S0 | non | ✅ **#724** |
| **S2 — Titration split_injection** | Mapping soir/à-jeun + matin/pré-dîner, `decideMdiDose` factorisé, une dose/run (priorité sécurité), garde de jour D9, confondeur bolus-midi, verrou 1-pending. | S1 | non | ✅ **#725** |
| **S3 — Baisse patient par mode** | Relâchement gaté de `patientDecreaseForbidden` (pompe INTERMEDIATE / stylo CONFIRME), amplitude min(10 %, 2 U), accusé DKA immuable, mode serveur (anti-tamper), audit enrichi/refus, flags Somogyi à la revue. | S0 | ⚠️ oui (accusé + codes) | ✅ **#726** |

**Écarts assumés vs cadrage initial** (tranchés en validation de design) : cooldown data-justifié 72 h (pas de délivrance-aware V1) ; hold zone asymétrique `[T−0,20 ; T+0,30]` (non prévue au cadrage, requise pour un pas fixe) ; priorité split « sécurité-d'abord » (raffinement de D4) ; confondeur = bolus **midi** spécifiquement ; **application groupée `dailyDose` différée** (accept stylo `styloBasalApplyNotSupported`). **Follow-ups tracés** : flag pré-dîner dédié (enum+i18n), refacto DRY générateur, `MDI_BASAL_WARN_U` non câblée, dégludec 96 h (V2), écriture groupée `dailyDose` à l'acceptation, lien explicite proposition↔flag Somogyi.

> ⚠️ **S3 touche un garde-fou de sécurité patient** → revue `healthcare-security-auditor` + `medical-domain-validator` obligatoire, montrée avant correction.

---

## 8. Alignements & risques

- **ADR** : #13 (jamais auto-appliqué), #23/#26 (grouped-only — la basale stylo s'édite en bloc, pas par-valeur ressuscité), #28 (auto-application retirée — inchangé), #27 (provenance dérivée serveur).
- **Frontière dispositif médical** : un patient `nonInsulin` ne reçoit toujours **aucune** dose (routage `treatment-mode` inchangé).
- **iOS** : S0 (nouveau discriminateur) et éventuellement S3 (accusé) touchent le contrat → coordination `swift-expert`.
- **Non-régression** : le chemin **pompe** ne bouge pas (tests de parité).

## 9. Références cliniques

- **ADA Standards of Care 2025** §9 (titration basale treat-to-target : +2 U / réduction 10–20 % ou 4 U sur hypo ; L1 < 70, L2 < 54 mg/dL).
- **Riddle et al., Treat-to-Target 2003** ; **INSIGHT** (titration patient-led +1 U/j).
- **ISPAD** (stylos demi-unité en pédiatrie ; sick-day / prévention DKA).
- Pharmacocinétique : glargine/detemir (steady state 3–4 j) ; **dégludec** t½ ~25 h (cooldown 96 h).

---

*Cadrage clinique : `medical-domain-validator` (2026-07-11). Spec à valider avant tout code — aucune slice ne démarre sans GO.*
