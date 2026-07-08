# Epic — Standardisation glycémie en mg/dL (stockage + API)

> Statut : **🆕 À démarrer** · Type : refactor backend transverse, cliniquement sensible · Branche : `epic/glucose-mgdl-standardization`
> Motivation : éliminer la dette **dual-unité** (g/L + mg/dL coexistants) qui a produit le fail-open C6
> (une hypo saisie en mg/dL seul était ignorée par la garde hypo — corrigé en interim par COALESCE dans la
> PR #706). Cette epic supprime l'ambiguïté à la source.

## 1. Décisions (arbitrées)

| Sujet | Décision |
|---|---|
| **Stockage** | Les mesures CGM/BGM sont stockées **en mg/dL uniquement** (source de vérité unique). |
| **Logique clinique** | Reste en **g/L**, conversion **mg/dL→g/L à la lecture** (Option 1 — réutilise le pattern `glycemiaMgdl/100`). Les ~30 seuils g/L et gardes cliniques restent **inchangés** (risque minimal). |
| **API** | **mg/dL partout.** Les champs de réponse `valueGl` / `glycemiaGl` / `currentGlucoseGl` deviennent mg/dL. |
| **Affichage** | Les **fronts (web + iOS)** convertissent mg/dL → unité préférée de l'utilisateur (`UserUnitPreferences.unitGlycemia` : 3=g/L, 4=mg/dL, 5=mmol/L — cf. **US-3248**). |
| **iOS** | Rupture de contrat API **assumée** (champs en mg/dL) → **coordination `swift-expert` obligatoire** avant release (CLAUDE.md §alignement iOS). |

## 2. Carte d'impact (analyse 3 agents)

### 2.1 Stockage — colonnes concernées (`prisma/schema.prisma`)
- `CgmEntry.valueGl` (g/L **seul**, L1513) — **table partitionnée par mois, gros volume (~105k/patient/an)**. → créer `valueMgdl`, backfill `round(valueGl*100)`, drop `valueGl`. CHECK `cgm_partitioning.sql:19` (0.20–6.00 g/L, **déjà en drift, non appliqué**) à réécrire en mg/dL (20–600). **Migration lourde à coordonner avec `docs/runbook/postgres-partitioning.md`.**
- `GlycemiaEntry.glycemiaGl` + `glycemiaMgdl` (L1532-1533, nullables) → backfill `glycemiaMgdl` depuis `glycemiaGl` là où null, **`glycemiaMgdl` NOT NULL + CHECK 20–600**, **drop `glycemiaGl`**.
- `CgmObjective` (L988-993), `GlycemiaObjective` (L967-978), `GlucoseTarget.targetRangeLower/Upper` (L1282-1283) : seuils g/L → mg/dL.
- `InsulinSensitivityFactor.sensitivityFactorGl` (L1323), `BolusCalculationLog.inputGlucoseGl/isfUsedGl` (L1388/1391) : g/L redondants (variantes `*Mgdl` existent) → drop après vérif.
- **Déjà mg/dL (rien à faire)** : `DiabetesEvent.glycemiaValue`, `EmergencyAlert.glucoseValueMgdl`, `GlucoseTarget.targetGlucose`, `AlertThresholdTemplate.glucose*Mgdl`, `ISF.sensitivityFactorMgdl`.

### 2.2 Écriture
- `mydiabby-sync.service.ts:497,515-516` : supprimer les `/100.0` (MyDiabby → mapper produit déjà du mg/dL) ; écrire `valueMgdl`/`glycemiaMgdl` directement (supprime l'aller-retour g/L→mg/dL→g/L).
- `app/api/patients/[id]/glycemia/route.ts:30-31,200-218` : Zod `glycemiaMgdl` **obligatoire**, retirer `glycemiaGl`.
- `objectives.service.ts:43-70,196-200`, `pregnancy-mode.service.ts:102`, `seed.ts:532-536,1051-1075` : seeds/objectifs en mg/dL.

### 2.3 Lecture (conversion mg/dL→g/L, Option 1) — la logique clinique NE change PAS
Points à envelopper d'une conversion `/100` à la lecture (le pattern existe déjà pour le BGM) :
`glycemia.service.ts:41-43,88,108,148,151-154,171`, `analytics.service.ts:672-682` (SQL `AVG(value_mgdl)/100` etc.), `auto-apply-context.ts` (CGM/capillaire), `meal-trends.service.ts:236,260`. Les seuils (`statistics.ts`, `clinical-bounds.ts *_GL`, `dose-safety-guards`, `proposal-algorithm`, `objectives`) restent en g/L.

### 2.4 API / contrat (rupture assumée)
Champs de réponse à passer en mg/dL : `app/api/patients/[id]/cgm/route.ts` (`valueGl`→mg/dL, `docs/API.md:544`), `app/api/patients/[id]/glycemia/route.ts:50-51,70-71`, entrée bolus `currentGlucoseGl` (`API.md:416`). **Coordonner `swift-expert` + types OpenAPI partagés (US-3248 §OpenAPI).**

### 2.5 Neutre (conversion à la présentation conservée)
Composants d'affichage (`GlucoseCard`, `GlucoseBadge`, `GlycemiaValue`, `CgmChart`, `AlertBanner`…), `formatters`/`useFormatters` (déjà `valueMgdl` canonique), `glycemia-thresholds.ts` (déjà mg/dL), tokens `bg-glycemia-*` (sans unité), i18n (libellés déjà mg/dL), email (aucune glycémie). L'`AgpPercentileChart:67-68` et `agp-report.ts:118` : **retirer** la conversion g/L→mg/dL (déjà faite en amont).

### 2.6 RGPD / export
`export.service.ts:187,245` (dump brut) : contenu des colonnes change (g/L → mg/dL). Valider si un contrat d'export documenté existe.

## 3. Plan par phases (chaque phase = 1 PR reviewée)

1. **P0 — Cadrage iOS/OpenAPI** (`swift-expert`) : figer les noms/unités des champs API mg/dL, décider transition (les fronts convertissent). *Bloquant pour P4.*
2. **P1 — `GlycemiaEntry`** (faible volume) : backfill `glycemiaMgdl`, NOT NULL + CHECK, drop `glycemiaGl`, adapter écriture (route glycémie) + lectures (conversion). Rodage du pattern sur la petite table.
3. **P2 — Objectifs/cibles/ISF** : `CgmObjective`/`GlycemiaObjective`/`GlucoseTarget.targetRange*` + colonnes `*Gl` redondantes → mg/dL. Seeds.
4. **P3 — `CgmEntry`** (gros volume, partitionné) : `valueMgdl` + backfill + drop `valueGl`, réécrire CHECK/partitionnement (runbook). MyDiabby sync sans `/100`. **Migration de données à fenêtrer.**
5. **P4 — API mg/dL** : basculer les champs de réponse + Zod en mg/dL ; retirer les conversions amont charts/PDF ; fronts web convertissent selon `UserUnitPreferences`. Release iOS coordonnée.
6. **P5 — Nettoyage** : supprimer `glToMgdl`/conversions devenues inutiles, mettre à jour `docs/API.md`, catalogue clinique, CLAUDE.md (ADR).

## 4. Risques

| Risque | Sévérité | Mesure |
|---|---|---|
| Bug d'unité (facteur 100) sur une garde de dose | **Critique** | Option 1 (logique g/L inchangée) ; tests de non-régression sur seuils/TIR/gardes ; revue `medical-domain-validator` par phase. |
| Rupture contrat iOS | Élevée | P0 cadrage `swift-expert` **avant** P4 ; release coordonnée. |
| Migration `CgmEntry` volumineuse/partitionnée | Élevée | P3 isolée, fenêtrée, coordonnée avec `docs/runbook/postgres-partitioning.md` ; backfill batché ; réversibilité (garder `value_gl` en lecture le temps du backfill puis drop). |
| Drift gate CI | Moyenne | migrations versionnées ; `migrate diff` vert à chaque phase. |

## 5. Liens
- Préférence d'affichage patient : **US-3248** (`docs/UserStory/Patient-user-stories/0-MVP/23-preferences-perso/US-3248-unites-glycemie.md`).
- Interim déjà livré : fail-open C6 corrigé par COALESCE (PR #706, `auto-apply-context.ts`).
- Runbook partitionnement : `docs/runbook/postgres-partitioning.md`. Catalogue clinique : `docs/clinical-logic/regles-et-constantes-diabete.md`.
