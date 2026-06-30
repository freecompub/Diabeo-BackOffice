# US-2630 (EPIC) — Fiche patient unifiée (page + drawer) + analytics enrichies

> 📌 **Epic** · Série « Fiche patient » · Maquette : `docs/mockups/fiche-patient-fusion-v1.html`
> Cadrée par 4 revues expertes : architecture/découpage, domaine médical, sécurité HDS, données/backend.

---

## 🎯 Objectif

Fusionner les **deux vues patient actuelles divergentes** en une fiche unique, et l'enrichir
des visualisations de la maquette :

- **Page dossier** `/patients/[id]` (Server Component, id en URL, garde `canAccessPatient` + `patientShareConsent`).
- **Drawer de consultation éphémère** (US-2018b : `publicRef` opaque → `cTok`, aucun id en URL, `inert`/`aria-modal`, plafond 60 min, beacon de fermeture).

→ **Un composant de présentation unique** rendu dans les deux contextes, **sans unifier le modèle d'accès aux données à la baisse**.

Nouveautés fonctionnelles : en-tête contextuel unifié · onglets **Vue d'ensemble · Glycémie · Profil glycémique (AGP) · Tendances de repas · Traitements · Documents** · **sélecteur de période** (1s/2s/1m/3m) et **sélecteur de vue** (Moyenne / Tableau journalier) synchronisés · **adaptation CGM ⇄ BGM** (sans capteur) · **Tendances de repas** façon LibreView (4 mini-courbes par moment + journal repas avant/après/glucides/bolus).

---

## 🧭 Synthèse d'impact (revues expertes)

### Architecture
- Point dur : **deux couches de données radicalement différentes** (RSC pré-projeté vs fetch client par `cTok`). Le sélecteur de période **casse le modèle RSC pur** → ajout d'une couche de fetch client.
- Décision structurante : **composant présentational `<PatientRecord>` (dumb, piloté par DTO)** + **deux adaptateurs de transport** (page = projection RSC scopée `?patientId=` ; drawer = `cTok`). On mutualise 100 % du rendu, on garde 2 résolutions d'accès.
- Largement **back-ready** : `analyticsService.agp` (+ `/api/analytics/agp`), `food-monitoring.service` (pré/post repas + journal), `DiabetesEvent` (carbs/bolus/glycémie), `objectives.service` (cibles pathology-aware). **Aucune migration Prisma nécessaire** — les manques sont des services/requêtes.

### Domaine médical (garde-fous CRITIQUES)
1. **Pathology-aware partout** : la maquette code la cible **70–180 en dur** ; en **diabète gestationnel (GD)** la cible est **63–140**. Un post-prandial à 150–175 affiché « vert » serait un **faux rassurement** (risque fœtal). Toutes les bandes/légendes/couleurs/seuils **doivent lire les bornes du patient** (`getCgmDefaults(pathology)`).
2. **Suffisance de données AGP** : `computeAgp` n'impose **aucun minimum de relevés par slot** ni par fenêtre. 7 j est **sous le seuil consensuel (≥ 14 j, ≥ 70 % capture)** → percentiles = artefacts. Plancher par slot + fenêtre 7 j « indicatif » + propagation du `warning` capture < 70 %.
3. **Mealtime : rattachement glycémie↔repas non défini** → un « pic à +3 h » non borné au repas suivant **surestime** l'excursion → mauvaise suggestion ICR. Définir : pré = dernier relevé [−30 min, repas] ; excursion = max sur (repas, repas + min(3 h, prochain repas)] ; min de repas appariés.
4. **GMI ≠ « HbA1c estimée »** : le GMI (formule FDA) ne doit **pas** être étiqueté « HbA1c estimée » (incite à le comparer à l'HbA1c labo). **Un seul indicateur CGM = GMI** ; **jamais de GMI/eA1c en BGM**.
5. **Suggestions non prescriptives** : « montée > 60 → ajuster ICR » est directif, pathology-neutral, et confond ICR/timing du bolus. Reformuler en hypothèse ; toute proposition d'ajustement passe par `AdjustmentProposal (pending) → review DOCTOR` (ADR 13).
6. **Frontières des moments repas** doivent dériver de la config `dayMoment` du patient et **désigner le slot ISF/ICR exact**, pas un libellé « matin » générique.

### Sécurité HDS / RGPD
- **Densité PHI accrue** → **lazy-load par onglet** obligatoire : *aucune donnée d'un onglet inactif dans le payload ni le DOM* (proscrire le `display:none` de la maquette côté React = PHI déjà déchiffrée envoyée au navigateur).
- **Anti-énumération préservée** : le composant unifié **ne construit jamais d'URL portant un id patient numérique** ; en drawer, transport **exclusivement** `publicRef→cTok` (jeton détruit au close, plafond 60 min).
- **Garde fail-closed inchangée** : `canAccessPatient` → 404 uniforme **puis** `patientShareConsent` **avant tout déchiffrement**, dans les deux modes, sur chaque nouvel endpoint.
- **Audit par agrégat** : chaque vue = un `READ` dédié (`ANALYTICS` kind `agp`/`mealtimePatterns`/`dailyStats`, `DIABETES_EVENT`, `GLYCEMIA_ENTRY`), `metadata` = `{ patientId (pivot), period/window, surface: page|drawer }` **sans aucune valeur clinique**. Boutons d'export = action **`EXPORT`** (≠ READ).
- **Texte libre repas** (`DiabetesEvent.comment`, `GlycemiaEntry.mealDescription`) = colonnes `String` **non chiffrées applicativement** → **chiffrer OU ne pas exposer** (décision DPIA) avant de livrer le journal repas.
- Patiente pilote **mineure (14 ans)** → vérifier le périmètre de consentement (autorité parentale).

### Données / backend (aucune migration)
Manques = services/requêtes : `stdDev` exposé · `patientHasCgm` · `getLastHba1c` · `bgmStats` (% relevés en cible + fréquence/j) · `dailyStats` (1 ligne/jour, raw SQL Europe/Paris) · `bgmDailyPatternByMoment` · `mealtimePattern.alignedCurve` (−1h/+3h par moment + pic) · `dailyJournal` repas (lookup « après repas »).

---

## 🧱 Découpage en User Stories

> Principe médical **non négociable** : **ne jamais livrer une visualisation sans son garde-fou de suffisance de données ET son adaptation pathology-aware**. Le socle US-2631 précède toute vue.

| US | Titre | Type | Dépend de | Taille |
|----|-------|------|-----------|--------|
| **US-2631** | Socle données : suffisance + cibles pathology-aware + helpers backend | back | — | M |
| **US-2632** | Composant présentational `<PatientRecord>` + contrat de données | front | — | M |
| **US-2633** | `PatientContextBar` page/drawer + adaptateur drawer (`<PatientRecord>` dans le drawer) | front/sécu | 2632 | L |
| **US-2634** | Sélecteur de période (1s/2s/1m/3m) synchronisé + `PatientRecordContext` | front/back | 2632 | M |
| **US-2635** | Onglet **AGP** (percentiles) + bandeau stats glucométriques | front/back | 2631, 2634 | M |
| **US-2636** | Vue **Tableau journalier** (1 ligne/jour) + service `dailyStats` | front/back | 2631, 2634 | M |
| **US-2637** | Onglet **Tendances de repas** (mini-courbes alignées + journal repas) | front/back | 2631, 2636 | L |
| **US-2638** | Détection **CGM/BGM** + adaptation Vue d'ensemble & Glycémie | front/back | 2631 | L |
| **US-2639** | **BGM** : AGP→Carnet + carnet repas + HbA1c labo | front/back | 2635, 2637, 2638 | M |
| **US-2640** | Toggle **page ⇄ drawer** + navigation + décommission anciens onglets drawer | front | 2633, 2635, 2637, 2638 | M |
| **US-2641** | Durcissement transverse : tokens, i18n/glossaire, a11y, audit/perf, lazy-load | transverse | 2635→2639 | M |

### Chemin critique
`US-2631 (socle) → US-2632 → US-2633` (fin de la divergence, valeur immédiate) → `US-2634 → US-2635 → US-2636` (période/vue/AGP) → `US-2637` (repas) → `US-2638 → US-2639` (BGM, le plus risqué cliniquement → après stabilisation) → `US-2640 → US-2641`. US-2635/2637/2638 parallélisables une fois 2631+2634 mergées.

---

## ✅ Garde-fous transverses (AC de CHAQUE US de l'epic)

- **Accès** : `canAccessPatient` → 404 uniforme **puis** `patientShareConsent` (fail-closed) **avant** déchiffrement, page **et** drawer.
- **Anti-énumération** : aucune URL portant un id patient numérique générée par le composant ; drawer = `cTok` only.
- **Pathology-aware** : toute bande/seuil/couleur lit `getCgmDefaults(pathology)` / objectif CGM patient. Test obligatoire avec un patient `GD`.
- **Suffisance de données** : états « données insuffisantes » standardisés ; pas de percentile/pic sous le minimum de relevés.
- **Pas de calcul clinique au front** : projection serveur uniquement (DTO).
- **Lazy-load par onglet** : pas de PHI d'un onglet inactif dans le payload/DOM.
- **Audit** : 1 READ par agrégat, `metadata` sans PHI (`patientId`, `period`, `surface`) ; export = `EXPORT`.
- **Design system** : zéro hex/Tailwind brut — tokens (`tokens.ts` SVG/Recharts, classes sémantiques).
- **i18n/glossaire** : libellés FR/EN/AR (BGM, AGP, GMI, ICR, HbA1c) avant usage ; logs jamais i18n.
- **A11y** : `role=tablist` (onglets + segments période/vue), dialog drawer, contraste WCAG AA — gate `accessibility-tester`.

---

## 🔗 Références code (réutilisation)
- Page : `src/app/(dashboard)/patients/[id]/page.tsx` (+ `PatientDetailClient.tsx`) — modèle de garde + audit par domaine.
- Drawer : `src/components/diabeo/consultation/{ConsultationContext,PatientConsultationDrawer,useConsultationData}.tsx` + `consultation.service.ts` (publicRef→cTok).
- Services : `analytics.service.ts` (`agp`, `glycemicProfile`, `computeAgp`, `MIN_CAPTURE_RATE`), `food-monitoring.service.ts` (`glycemiaMealContextQuery`, `foodJournalQuery`), `objectives.service.ts` (`getCgmDefaults`), `glycemia.service.ts`, `events.service.ts`, `statistics.ts` (`computeAgp`, `stddev`, `glucoseManagementIndicator`).
- Bornes : `clinical-bounds.ts` (`DASHBOARD_TIR`, `CGM_AGGREGATE_RANGE_GL`).
- Modèles : `DiabetesEvent`, `CgmEntry`, `GlycemiaEntry`, `UserDayMoment`, `AnnexObjective`, `PatientDevice`.

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`. DPIA dédiée requise (densité PHI + texte libre repas).*
