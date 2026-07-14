# Inventaire des unités glycémiques (CGM / BGM) — traçage exhaustif du code

> **Méthode** : parcours de **tout le code** référençant CGM (`CgmEntry`/`cgm_entries`/`valueGl`/`value_gl`)
> ou BGM (`GlycemiaEntry`/`glycemia_entries`/`glycemiaGl`/`glycemiaMgdl`) — ~35 fichiers. Chaque ligne renvoie
> à `fichier:ligne` du code réel (relevé par lecture directe, jamais de mémoire).
> **Convention du code** : `1 g/L = 100 mg/dL` (helper `glToMgdl(gl) = gl * 100`, jamais ×18).

---

## 0. Réponse synthétique (TL;DR)

| Couche | Unité | Détail |
|---|---|---|
| **Stockage CGM** | **g/L** seul | `cgm_entries.value_gl` `Decimal(6,4)`. Pas de colonne mg/dL. |
| **Stockage BGM** | **g/L + mg/dL** (2 colonnes) | `glycemia_gl` `Decimal(6,4)` + `glycemia_mgdl` `Decimal(6,2)`, toutes deux nullables. Lecture : **g/L prioritaire**, mg/dL en repli. |
| **Algorithme de proposition** | **g/L** | `proposal-algorithm.ts` intégralement en g/L (seuils définis en mg/dL puis `/100`). |
| **Emergency (alertes hypo/hyper)** | **mg/dL** | Seul module de décision en mg/dL. |
| **Analytics** | **mixte** | TIR/AGP/nadir calculés en **g/L** (sortent en %) ; moyennes exposées en **mg/dL**. |
| **meal-trends** (pivot algo) | **mg/dL** interne | Convertit tout en mg/dL à la lecture, re-`/100` en g/L pour les analyseurs. |
| **API CGM** (`GET /api/…/cgm`) | **g/L** brut en sortie | Aucune valeur en entrée, aucune préférence. |
| **API BGM** (`/api/…/glycemia`) | **g/L OU mg/dL** | Entrée accepte les deux ; sortie renvoie les deux colonnes brutes. |
| **Affichage (dashboards)** | **mg/dL** en dur | Conversion `×100` client, dupliquée dans 4 fichiers. |
| **Export RGPD** | brut (g/L CGM, g/L+mg/dL BGM) | Aucune conversion ni libellé d'unité. |

**En clair** : le **cœur clinique (algorithme + stockage de référence) est en g/L** ; les **API et l'affichage sont bi‑unités**, avec le mg/dL très présent aux frontières (ingestion externe, affichage). L'**emergency** est l'exception qui décide en mg/dL.

---

## 1. Chaîne de bout en bout (les conversions)

```
MyDiabby (g/L string)
   │  mapper: glToMgdl = parseFloat(value) * 100        (mydiabby-mapper.service.ts:333-336)
   ▼
glucoseValue (mg/dL, validé 20–600)
   │  sync CGM: valueGl = glucoseValue / 100            (mydiabby-sync.service.ts:497)
   │  sync BGM: glycemiaGl = glucoseValue / 100  +  glycemiaMgdl = glucoseValue  (:515-516)
   ▼
DB : cgm_entries.value_gl (g/L)  |  glycemia_entries.glycemia_gl (g/L) + glycemia_mgdl (mg/dL)
   │
   ├──► meal-trends.loadContext : valueGl*100 / glycemiaGl*100 / glycemiaMgdl  → mg/dL interne   (meal-trends.service.ts:239-264)
   │        └──► proposal-generator : *Mgdl / 100 → g/L  → analyseurs purs (g/L)                 (proposal-generator.service.ts:948…)
   │
   ├──► analytics : valueGl / COALESCE(glycemia_gl, glycemia_mgdl/100) (g/L) → TIR/AGP % en g/L ; moyennes glToMgdl(×100) → mg/dL
   │
   ├──► emergency : valueGl * 100 → mg/dL ; seuils CgmObjective(g/L) × 100 → mg/dL ; classification mg/dL   (emergency.service.ts:554-565)
   │
   ├──► API cgm : valueGl brut (g/L)  ;  API glycemia : 2 colonnes brutes
   │
   └──► affichage : round(valueGl * 100) → mg/dL (dashboard/weekly/patient/glycemia-view)
```

**Aller‑retour notable** : MyDiabby envoie du g/L → le mapper le passe en mg/dL (validation bornes 20–600) → le sync le repasse en g/L pour le stockage CGM et `glycemia_gl`.

---

## 2. Schéma & contraintes

| Élément | Colonne | Type | Unité | Réf. |
|---|---|---|---|---|
| `CgmEntry.valueGl` | `value_gl` | `Decimal(6,4)` NOT NULL | **g/L** | `schema.prisma:1545` ; migration `…baseline_v1:700` |
| `GlycemiaEntry.glycemiaGl` | `glycemia_gl` | `Decimal(6,4)` NULL | **g/L** | `schema.prisma:1564` |
| `GlycemiaEntry.glycemiaMgdl` | `glycemia_mgdl` | `Decimal(6,2)` NULL | **mg/dL** | `schema.prisma:1565` |

**Contraintes CHECK** — divergence à noter :
- **Aucun CHECK** sur `value_gl` / `glycemia_gl` / `glycemia_mgdl` dans `schema.prisma` ni dans la migration baseline.
- Le **seul** CHECK `value_gl BETWEEN 0.20 AND 6.00` (g/L) vit dans `prisma/sql/cgm_partitioning.sql:19` (fichier de **référence** qui recrée `cgm_entries` en table partitionnée) — **pas** appliqué par les migrations versionnées.
- **Aucun** CHECK sur les colonnes BGM nulle part.

---

## 3. Inventaire exhaustif par fichier / fonction

> Colonnes : **L**=lecture, **É**=écriture, **T**=transform. « Unité » = unité manipulée/produite par la fonction.

### 3.1 — Ingestion & stockage

| Fichier:ligne | Fonction | CGM/BGM | L/É/T | Colonne | Unité | Conversion |
|---|---|---|---|---|---|---|
| `types/mydiabby.ts:330-340` | `MyDiabbyCgmEntry` / `MyDiabbyGlycemiaEntry` | CGM+BGM | source | `value` (string) | **g/L** | — |
| `mydiabby-mapper.service.ts:333-336` | `glToMgdl` | CGM+BGM | T | — | g/L→**mg/dL** | `parseFloat(value) * 100` |
| `mydiabby-mapper.service.ts:191-207` | `mapCgmEntries` | CGM | T+valid | →`glucoseValue` | **mg/dL** | skip si `<20` ou `>600` |
| `mydiabby-mapper.service.ts:217-234` | `mapGlycemiaEntries` | BGM | T+valid | →`glucoseValue` | **mg/dL** | idem bornes 20–600 |
| `mydiabby-mapper.service.ts:167-176` | `mapCgmObjective` | CGM (seuils) | T | veryLow/low/ok/high/titr* | **mg/dL** | `glToMgdl` ×100 |
| `mydiabby-sync.service.ts:497` | `syncHealthData` (CGM) | CGM | **É** | `value_gl` | **g/L** | `valueGl = glucoseValue / 100` |
| `mydiabby-sync.service.ts:515-516` | `syncHealthData` (BGM) | BGM | **É** | `glycemia_gl` + `glycemia_mgdl` | **g/L + mg/dL** | `glycemiaGl = glucoseValue/100` ; `glycemiaMgdl = glucoseValue` |
| `seed.ts:1043-1079` | seed CGM | CGM | **É** | `value_gl` | **g/L** | généré directement g/L (base 1,00–1,50 ; clamp 0,40–4,00 ; 4 décimales) |

### 3.2 — Algorithme de proposition (**g/L partout**)

| Fichier:ligne | Fonction | CGM/BGM | L/T | Valeur | Unité | Conversion |
|---|---|---|---|---|---|---|
| `proposal-algorithm.ts:18` | `LEVEL1_HYPO_GL` | — | T | `THRESHOLDS_MGDL.TARGET_LOW` | **0,70 g/L** | 70 mg/dL `/100` |
| `proposal-algorithm.ts:98` | `SEVERE_HYPO_GL` | — | T | `THRESHOLDS_MGDL.SEVERE_HYPO` | **0,54 g/L** | 54 mg/dL `/100` |
| `proposal-algorithm.ts:32-41` | `hypoBlocksProposal` / `hypoWindowBlocks` | CGM/BGM | L | `glucosesGl[]` | g/L | aucune |
| `proposal-algorithm.ts:53-60` | `recurrentPostMealHypo` | CGM/BGM | L | `nadirsGl[]` | g/L | aucune |
| `proposal-algorithm.ts:107-109` | `hasSevereHypo` | CGM/BGM | L | `glucosesGl[]` | g/L | aucune |
| `proposal-algorithm.ts:77-229` | `analyze{Icr,Isf,Basal,FixedDose}HypoDeescalation` | CGM/BGM | L | `nadirsGl`/`readingsGl` | g/L | aucune |
| `proposal-algorithm.ts:314-359` | `analyzeIsfSlot` | CGM | L | `postGlucoseGl`, `targetGl`, `nadirGl` | g/L | aucune |
| `proposal-algorithm.ts:374-422` | `analyzeIcrSlot` | CGM | L | `postGlucoseGl`, `targetGl`, `nadirGl` | g/L | aucune |
| `proposal-algorithm.ts:442-486` | `analyzeBasalTrend` | CGM | L | `fastingValues`, `targetGl`, `nocturnalNadirs` | g/L | aucune |
| `proposal-algorithm.ts:513-563` | `analyzeMdiBasalDailyTrend` | CGM/BGM | L | `fastingValues`, `targetGl` | g/L | aucune |
| `proposal-algorithm.ts:626-678` | `analyzeFixedDose` | BGM | L | `postGlucoseGl`, `targetGl` | g/L | aucune |
| `glycemia-thresholds.ts:25-38` | `GLYCEMIA_THRESHOLDS_MGDL` | — | const | 40/54/70/180/250/400 | **mg/dL** (source affichage), `/100` par l'algo |

### 3.3 — Générateur (lit meal-trends → `/100` → g/L)

| Fichier:ligne | Bloc | CGM/BGM | T | Champ | Unité | Conversion |
|---|---|---|---|---|---|---|
| `proposal-generator.service.ts:271-276` | `buildIcrMeals` | CGM | T | `postMgdl`, `nadirMgdl` | g/L | `/100` |
| `proposal-generator.service.ts:287-295` | `isMealUsableForIcr` | CGM | L | `preMgdl` | g/L | `/100` cmp `ICR_PREMEAL_*_GL` |
| `proposal-generator.service.ts:948-969` | ICR bucket | CGM | T | `postMgdl`, `nadirMgdl` | g/L | `/100` |
| `proposal-generator.service.ts:1033-1053` | basal pompe | CGM | T | `glucoseTargets[0]`, `fastingMgdl`, `nocturnalNadirMgdl` | g/L | `/100` |
| `proposal-generator.service.ts:1116-1231` | basal stylo single/split (`toGl`/`glVals`) | CGM→BGM | T | `fastingMgdl`, `preMgdl`, `nadirMgdl` | g/L | `/100` |

> Le générateur **ne lit jamais** `valueGl`/`glycemiaGl` directement : il consomme les DTO `*Mgdl` de meal‑trends puis `/100`.

### 3.4 — meal-trends (**point de conversion g/L → mg/dL interne**)

| Fichier:ligne | Élément | CGM/BGM | T | Colonne | Unité produite | Conversion |
|---|---|---|---|---|---|---|
| `meal-trends.service.ts:37-38` | `VALID_MIN/MAX_MGDL` | — | T | `CGM_AGGREGATE_RANGE_GL` | mg/dL | `×100` (20 / 600) |
| `meal-trends.service.ts:259-264` | `loadContext` CGM | CGM | L+T | `valueGl` (filtré [0,20;6,00]) | **mg/dL** | `valueGl * 100` |
| `meal-trends.service.ts:235-240` | `loadContext` BGM | BGM | L+T | `glycemiaGl` / `glycemiaMgdl` | **mg/dL** | `glycemiaGl*100`, sinon `glycemiaMgdl` tel quel |
| `meal-trends.service.ts:391-399` | journal repas | CGM/BGM | T | readings | mg/dL **et** g/L | `postMgdl`/`nadirMgdl` (mg/dL) + `postGlucoseGl`/`nadirGl = /100` |
| `meal-trends.service.ts:452-483` | `correctionTrend` | CGM | L+T | `inputGlucoseGl`, `targetGlucoseMgdl` | **g/L** | `targetGlucoseMgdl / 100` → `targetGl` |
| `meal-trends.service.ts:409-498` | `alignedCurve`/`dailyJournal`/`fastingTrend`/`mealTrends` | CGM/BGM | L+T | via `loadContext` | `*Mgdl` **mg/dL** | — |

### 3.5 — Analytics & statistiques

| Fichier:ligne | Fonction | CGM/BGM | Unité entrée | Unité sortie | Conversion |
|---|---|---|---|---|---|
| `analytics.service.ts:179-244` | `glycemicProfile` | CGM | g/L | `averageGlucoseGl` **g/L** + `averageGlucoseMgdl`/`stdDevMgdl`/`targetRangeMgdl` **mg/dL** ; `tir` % | `glToMgdl` ×100 |
| `analytics.service.ts:261-343` | `bgmStats` | BGM | g/L (glycemiaGl, sinon glycemiaMgdl/100) | `avgMgdl` **mg/dL** ; `inRangePercent` % | `/100` repli ; `glToMgdl` sortie |
| `analytics.service.ts:355-437` | `bgmDailyPatternByMoment` | BGM | g/L (repli /100) | `avgMgdl` **mg/dL** | idem |
| `analytics.service.ts:457-533` | `fixedDoseTrend` | BGM | g/L (repli /100) | **g/L** (`gl`) | pas de conversion sortie |
| `analytics.service.ts:544-577` | `timeInRange` | CGM | g/L | `tir` **%** ; `thresholds` **g/L** | aucune (TIR en g/L) |
| `analytics.service.ts:590-615` | `agp` | CGM | g/L | percentiles **g/L** | aucune |
| `analytics.service.ts:629-704` | `dailyStats` (SQL) | CGM ou BGM | g/L (`COALESCE(glycemia_gl, glycemia_mgdl/100)`) | `avg/min/maxMgdl` **mg/dL** ; `inTargetPct` % | `glToMgdl` en projection |
| `analytics.service.ts:717-750` | `hypoglycemia` | CGM | g/L | `nadir` **g/L** | aucune |
| `analytics.service.ts:827-891` | `heatmap` | CGM | g/L | `avgMgdl` **mg/dL** | `glToMgdl` |
| `analytics.service.ts:902-993` | `compare` | CGM | g/L | `averageGlucoseMgdl` **mg/dL** ; tir % | `glToMgdl` |
| `statistics.ts:18-20` | `glToMgdl` | — | g/L | **mg/dL** | `gl * 100` |
| `statistics.ts:30-32` | `glucoseManagementIndicator` (GMI) | — | **mg/dL** | % | `3.31 + 0.02392 * avgMgdl` |
| `statistics.ts:139-161` | `computeTir` | — | valeurs+seuils **même unité** (g/L en pratique) | **%** | agnostique |
| `statistics.ts:227-260` | `computeAgp` | — | g/L (en pratique) | percentiles **g/L** | agnostique |
| `statistics.ts:286-349` | `detectHypoEpisodes` | — | g/L | `nadir` **g/L** | agnostique |
| `glycemia.service.ts:78-108` | `getCgmEntries` | CGM | g/L | **g/L** (`valueGl`) | aucune ; filtre [0,40;5,00] g/L |
| `glycemia.service.ts:135-188` | `getLatestCgmFreshness` | CGM | g/L | timestamp + flags (aucune valeur) | compare g/L |
| `glycemia.service.ts:202-250` | `getGlycemiaEntries` | BGM | g/L + mg/dL | **les 2 colonnes brutes** | **aucune priorité/conversion** |
| `cgm-status.service.ts:22-44` | `patientHasCgm` | CGM | — | boolean | **aucune valeur lue** (timestamp/existence) |

### 3.6 — Emergency (**mg/dL**)

| Fichier:ligne | Fonction | CGM | Unité | Conversion |
|---|---|---|---|---|
| `emergency.service.ts:67` | `GL_TO_MGDL = 100` | — | facteur | — |
| `emergency.service.ts:155-178` | `classifyCgmAlert` | CGM | **mg/dL** | severe_hypo ≤54, hypo <70, hyper >180, severe_hyper ≥250 |
| `emergency.service.ts:208-226` | `captureContextSnapshot` | CGM | mg/dL | `valueGl * 100` |
| `emergency.service.ts:522-567` | `detectFromCgm` (seuils) | CGM | **mg/dL** | seuils `CgmObjective`/`getCgmDefaults` (g/L) `× 100` |

> Kétones (`detectFromKetone`) en **mmol/L** (DKA ≥ 3,0), hors périmètre glycémie.

### 3.7 — Objectifs / population / food

| Fichier:ligne | Fonction | CGM | Unité | Conversion |
|---|---|---|---|---|
| `objectives.service.ts:43-80` | `CGM_DEFAULTS` / `CGM_DEFAULTS_GD` / `getCgmDefaults` | — | **g/L** | — |
| `objectives.service.ts:101-117` | `computeTirPercent` | CGM | **g/L** | `valueGl` cmp `titrLow/titrHigh` (g/L) |
| `population-analytics.service.ts:159-195` | `computePatientMetric` | CGM | g/L (filtré [0,20;6,00]) | TIR **g/L** ; `avgMgdl`+GMI `glToMgdl` |
| `food-monitoring.service.ts:292-337` | `glycemiaMealContextQuery` | CGM | **g/L** (`preMealAvgGl`, `postMealAvgGl`) | aucune (n'alimente PAS l'algo) |

### 3.8 — Routes API (contrat entrée / sortie)

| Fichier:ligne | Route | CGM/BGM | Entrée | Sortie | Remarque |
|---|---|---|---|---|---|
| `api/patients/[id]/cgm/route.ts:18-69` | `GET …/cgm` | CGM | dates seules | **`valueGl` g/L brut** | aucune préférence ; header fraîcheur |
| `api/patients/[id]/glycemia/route.ts:91-162` | `GET …/glycemia` | BGM | dates seules | **`glycemiaGl` (g/L) + `glycemiaMgdl` (mg/dL)** bruts | les 2 colonnes |
| `api/patients/[id]/glycemia/route.ts:27-234` | `POST …/glycemia` | BGM | **`glycemiaGl` 0,20–6,00 (g/L) OU `glycemiaMgdl` 20–600 (mg/dL)** | les 2 colonnes telles que fournies | **pas de dérivation croisée** ; colonne non fournie = null |

### 3.9 — Dashboards / vues / affichage

| Fichier:ligne | Élément | CGM/BGM | Unité | Remarque |
|---|---|---|---|---|
| `doctor-dashboard.service.ts:98-99,220-255,720-842` | TIR (`TIR_LOW_GL 0,70` / `HIGH_GL 1,80`) | CGM | filtre **g/L** → sortie **%** | pathology-aware (GD 0,63–1,40) |
| `doctor-dashboard.service.ts:108-128,280-292` | `UrgencyItem.glucoseValueMgdl` | (alerte) | **mg/dL** | champ dédié `EmergencyAlert`, pas du CGM |
| `doctor-dashboard.service.ts:848-946` | `pendingProposalsQuery` | (ISF) | valeurs **g/L** + `glucoseUnit` = **préférence médecin** (défaut mg/dL) | seul endroit avec préférence d'unité (côté clinicien) |
| `nurse/admin/system-health` | fraîcheur/activité | CGM | — | **aucune valeur** (timestamp/comptes seuls) |
| `glycemia-view.ts:37-67` | `buildGlycemiaView` / `toMgdl` | CGM | g/L→**mg/dL** | `gl*100` (conversion serveur centralisée pour cette vue) |
| `patient-record-views.ts:32-56` | types `CgmEntryLite`/`GlycemiaView` | CGM | `valueGl` g/L → `lastReadingMgdl` mg/dL | plancher 0,40 / plafond 5,00 g/L pour la courbe |
| `dashboard/page.tsx:300-315` | Dashboard médecin | CGM | affichage **mg/dL** | `round(valueGl*100)` |
| `weekly/page.tsx:156-187,485-501` | Semainier | CGM | affichage **mg/dL** | `round(valueGl*100)` ; TIR 70–180 mg/dL |
| `patient/dashboard/page.tsx:158-168,299-305` | Dashboard patient | CGM | affichage **mg/dL** | `round(valueGl*100)` ; avg via analytics |

### 3.10 — Export / suppression

| Fichier:ligne | Fonction | CGM/BGM | Unité | Remarque |
|---|---|---|---|---|
| `export.service.ts:186-187,250-251` | `generateUserExport` | CGM+BGM | **brut** : CGM g/L ; BGM g/L + mg/dL | RGPD Art. 20 ; aucun libellé d'unité ajouté |
| `deletion.service.ts:132-133` | `deleteUserAccount` | CGM+BGM | — | purge `deleteMany` scopée patient (RGPD Art. 17) |

---

## 4. Points d'attention / divergences relevés dans le code

1. **CHECK base incohérent** : le CHECK `value_gl BETWEEN 0.20 AND 6.00` (g/L) n'existe que dans `prisma/sql/cgm_partitioning.sql` (référence), **pas** dans les migrations versionnées ni `schema.prisma`. Aucun CHECK sur les colonnes BGM.
2. **Double stockage BGM sans garde de cohérence** : `POST /api/…/glycemia` accepte `glycemiaGl` **OU** `glycemiaMgdl` et écrit chacun dans sa colonne, **sans dériver l'autre ni vérifier la cohérence** — la colonne non fournie reste `null`. La lecture privilégie `glycemiaGl`, repli `glycemiaMgdl/100`.
3. **Conversion `×100` dupliquée (non centralisée)** : `round(valueGl*100)` est ré‑implémenté dans `dashboard/page.tsx`, `weekly/page.tsx`, `patient/dashboard/page.tsx` et `glycemia-view.ts` — pas de helper unique côté front.
4. **Contrat CGM en g/L, UI en mg/dL** : l'API sort du g/L brut, toute l'UI convertit en mg/dL. La préférence d'unité n'existe qu'à un seul endroit (`pendingProposalsQuery`, côté **médecin**), pas côté patient.
5. **Emergency = seul décideur en mg/dL** : `emergency.service.ts` classe les alertes en mg/dL (seuils `CgmObjective`/défauts convertis `×100`), à l'inverse de l'algorithme de proposition (g/L).
6. **Aller‑retour de conversion à l'ingestion** : MyDiabby g/L → mapper ×100 (mg/dL) → sync ÷100 (g/L). La double conversion est sans perte au-delà de l'arrondi `Decimal`.
7. **Export RGPD sans unité explicite** : les valeurs sont livrées brutes (g/L pour le CGM) sans annotation d'unité — un data subject reçoit `valueGl` sans libellé.

---

## 5. État de l'epic « standardisation mg/dL »

Une décision d'epic (« stocker CGM/BGM + API en mg/dL uniquement, logique clinique en g/L via conversion à la lecture ») a été évoquée. **Le code actuel ne l'implémente pas** : le CGM est stocké en g/L seul, le BGM en double colonne avec g/L prioritaire, et l'algorithme + le stockage de référence sont en g/L. Aucune trace d'implémentation d'un basculement mg/dL‑only dans le schéma ou les services audités. **La source de vérité reste le code inventorié ci‑dessus.**

---

*Inventaire produit par parcours direct du code (relevés A–D), non basé sur la mémoire. Fichiers audités : `types/mydiabby.ts`, `mydiabby-mapper.service.ts`, `mydiabby-sync.service.ts`, `seed.ts`, `schema.prisma`, `cgm_partitioning.sql`, `proposal-algorithm.ts`, `glycemia-thresholds.ts`, `clinical-bounds.ts`, `proposal-generator.service.ts`, `meal-trends.service.ts`, `analytics.service.ts`, `statistics.ts`, `glycemia.service.ts`, `cgm-status.service.ts`, `objectives.service.ts`, `population-analytics.service.ts`, `food-monitoring.service.ts`, `emergency.service.ts`, `doctor/nurse/admin-dashboard.service.ts`, `system-health.service.ts`, `export.service.ts`, `deletion.service.ts`, routes `api/patients/[id]/cgm` & `.../glycemia`, `glycemia-view.ts`, `patient-record-views.ts`, pages dashboard/weekly/patient.*
