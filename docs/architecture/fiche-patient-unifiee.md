# Fiche patient unifiée (`<PatientRecord>`) — Architecture

> Epic **US-2630** — livrée 2026-07-01 (US-2631→2641, PR #608→#619). Aucune
> migration Prisma. Ce document décrit l'architecture **telle que livrée**.

## 1. Objectif

Un **composant présentational unique** `<PatientRecord>` rend le dossier patient
à l'identique dans **deux points d'entrée** :

- **Page** — route `/patients/[id]` (RSC gardé par `canAccessPatient`).
- **Drawer de consultation** — workspace éphémère par-dessus la liste (US-2018b),
  sans id patient en URL (jeton `cTok`).

```
<PatientRecord variant="page" | "drawer" data={PatientRecordData} />
```

Le composant ne connaît **pas** le modèle d'accès : les données lui arrivent déjà
projetées et autorisées. La divergence historique (page bespoke vs onglets drawer
bespoke) est supprimée.

## 2. Double transport (injection)

Le composant ne construit **jamais** d'URL porteuse d'id (anti-énumération
US-2265). Le contexte `PatientRecordProvider` reçoit un `fetchAnalytics` injecté :

| Mode | Assemblage DTO | Transport analytics (re-fetch période) |
|------|----------------|----------------------------------------|
| Page | RSC `buildPatientRecordData` (via `?patientId=`, `canAccessPatient`) | `usePagePatientFetcher` → `?patientId=` en query |
| Drawer | `GET /api/patients/record` (en-tête `x-consultation-token`) | en-tête `cTok`, **aucun id en URL** |

- `build-patient-record.ts` = **source unique** du DTO (`PatientRecordData`),
  réutilisée par la page RSC ET la route `cTok`. Chaque agrégat est audité par son
  service (READ PATIENT / ANALYTICS / GLYCEMIA_ENTRY / INSULIN_THERAPY /
  MEDICAL_DOCUMENT).
- **Toggle drawer → page** (US-2640) : bouton « ouvrir en page » →
  `router.push('/patients/${data.id}')` + fermeture drawer. L'`id` vient du DTO
  résolu serveur (pas d'énumération) ; il n'apparaît en URL qu'en mode page.

## 3. Onglets & sélecteurs

Onglets (base-ui `Tabs`, panels **démontés si inactifs** → lazy-load, AC HDS) :
Vue d'ensemble · Profil glycémique (AGP / Carnet BGM) · Tendances de repas ·
Glycémie · Traitements · Documents.

- **Sélecteur de période** (7j/14j/30j/90j) + **vue** (Moyenne/Journalier),
  synchronisés via `PatientRecordContext`. Hooks : `usePeriodAnalytics`
  (seed serveur + re-fetch) et `usePeriodResource` (lazy, seedless). Debounce
  250 ms, `AbortController`.
- **« Label follows data »** (`valuePeriod`) : la donnée porte TOUJOURS le libellé
  de la période réellement affichée, jamais la période demandée pendant un
  chargement/erreur (sécurité clinique — pas de faux rassurement, revue #610).

## 4. CGM vs BGM (fail-closed)

`dataSource = patientHasCgm(patientId) ? "cgm" : "bgm"` (détection : capteur actif
OU relevés CGM < 14 j). **Fail-closed** : un patient BGM ne voit **jamais**
d'indicateur CGM-only (TIR-temps, GMI, AGP) — le gating est sur `dataSource`, pas
sur l'absence de données.

| Indicateur | CGM | BGM (glycémie capillaire) |
|-----------|-----|---------------------------|
| Temps dans la cible | TIR (temps) | **% de relevés en cible** (≠ TIR, + caveat biais d'échantillonnage) |
| Contrôle long terme | GMI (jamais « HbA1c estimée ») | **HbA1c laboratoire** datée (jamais un eA1c dérivé) |
| Profil | **AGP** (percentiles) | **Carnet par moment** (moyenne Nuit/Matin/Midi/Soir) |
| Série glycémie | courbe 24 h continue | **nuage de points** modal-day (pas d'interpolation) |
| Tendances de repas | mini-courbes alignées + journal | **carnet avant/après** (journal seul) |
| Fréquence | taux de capture | relevés/jour |

## 5. Invariants cliniques (AC bloquants)

- **Pathology-aware** : cibles via `getPatientThresholds` → `getCgmDefaults` — GD
  63–140 vs 70–180. **Grossesse** (`pregnancyMode`, même non typée GD) → cibles GD
  strictes, unifié sur tous les agrégats (US-2641). Un `CgmObjective` explicite du
  clinicien reste prioritaire.
- **Suffisance AGP** : ≥ 14 j / 70 % capture ; sous `MIN_SLOT_READINGS` relevés
  par slot 15 min, pas de bande P10–P90 (bruit). Slot vide → `null`, jamais un
  faux 0 (hypo trompeuse).
- **Mealtime** (`mealtimePattern`) : pré = dernier relevé `[t0−30, t0]` ; excursion
  bornée au **prochain apport glucidique** ; pic « non évaluable » si fenêtre
  < 90 min ; post PPG 2 h ; delta **signé** ; plancher ≥ 3 repas appariés ;
  **zéro interpolation** ; libellés **non prescriptifs** (aucun `AdjustmentProposal`).
- **Carnet BGM** : plancher `MIN_READINGS_PER_MOMENT = 3` ; coloration
  pathology-aware complète (zones sévères incluses).
- **Fuseau** : moment/jour dérivés de l'heure **Europe/Paris** ; appariement
  repas↔relevé BGM en **espace heure-murale locale** (`localWallMs`/`matchMs`,
  DST-safe — US-2639).

## 6. Invariants HDS (AC bloquants)

- **Lazy-load** : aucune donnée d'onglet inactif dans le payload/DOM (panels
  base-ui démontés ; jamais de `display:none` React).
- **Anti-énumération** : transport injecté (cTok drawer / `?patientId` page,
  gardé `canAccessPatient`) ; aucun id en URL en drawer.
- **Audit** : 1 `READ` par agrégat, `resourceId=patientId` + pivot
  `metadata.patientId`, metadata **sans valeur clinique** (`period`/`kind`/`source`
  seulement). Action `EXPORT` réservée à l'export RGPD.
- **Texte libre repas** (`DiabetesEvent.comment`, `GlycemiaEntry.mealDescription`)
  **jamais lu ni sélectionné** par les projections de la fiche (AC-6). Le journal
  est **numérique uniquement**.

## 7. Carte des fichiers

| Couche | Fichiers |
|--------|----------|
| Composant | `src/components/diabeo/patient/PatientRecord.tsx` (+ `PatientRecordContext`, `PatientAgpTab`, `PatientDailyTable`, `PatientMealTrendsTab`, `MealMomentCurve`, `PatientBgmOverview`, `PatientBgmScatter`, `PatientBgmCarnet`, `PeriodSelector`, `ViewSelector`) |
| DTO | `src/app/(dashboard)/patients/[id]/build-patient-record.ts` |
| Drawer | `src/components/diabeo/consultation/PatientConsultationDrawer.tsx` |
| Services | `analytics.service.ts` (`glycemicProfile`, `agp`, `dailyStats`, `bgmStats`, `bgmDailyPatternByMoment`, `getPatientThresholds`), `meal-trends.service.ts` (`mealtimePattern`), `cgm-status.service.ts` (`patientHasCgm`), `glycemia.service.ts` (`getLastHba1c`) |
| Routes | `src/app/api/analytics/{glycemic-profile,agp,daily-stats,meal-trends,bgm-stats,bgm-daily-pattern}/route.ts`, `src/app/api/patients/record/route.ts` |
| Modules purs (client-safe) | `src/lib/clinical-bounds.ts`, `src/lib/insulin-slots.ts`, `src/lib/day-moments.ts` |
| DPIA | `docs/compliance/dpia-patient-detail-dossier.md` |

## 8. Suivi (tickets différés, non bloquants)

PPG 1 h grossesse · sur-fetch `/agp` en vue daily · granularité audit
`GLYCEMIA_ENTRY`/`CGM_ENTRY` (vs ancre `DIABETES_EVENT`) · `showZoneLabel` sur les
autres usages de `GlycemiaValue` · contrastes design-system (gate axe-core CI).
