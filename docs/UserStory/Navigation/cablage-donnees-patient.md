# Câblage des vraies données patient — plan de suivi

> **Contexte** : la page dossier patient `src/app/(dashboard)/patients/[id]/page.tsx`
> (US-802) était un **composant client** affichant des données **démo synthétiques**
> (`DEMO_PATIENT` / `DEMO_CGM`). Ce chantier remplace la démo par les **vraies
> données** patient, **scopées serveur**, **PII déchiffrée serveur**, **accès audité**.
> C'est le **prérequis** du dossier patient en onglets (US-2604) et de la barre de
> contexte (US-2603).
>
> **Décisions** :
> - **Phasé** : 1 onglet ≈ 1 PR (revue PHI maîtrisée).
> - Les onglets **pas encore câblés** affichent un **état vide « bientôt disponible »**
>   — jamais de fausses données patient.
> - **Aucune statistique clinique calculée côté frontend** : TIR/GMI/CV/moyenne
>   viennent des **projections serveur** (`analytics.service`). Zéro IA.

---

## Architecture cible

- `page.tsx` devient un **Server Component** : lit `params.id` + rôle/headers,
  **vérifie `canAccessPatient`** (sinon `notFound()` — anti-énumération), appelle
  les **services** (audit `READ` + pivot `metadata.patientId`, ADR #18), mappe et
  passe les données à un enfant **client** `PatientDetailClient` (onglets + graphe).
- Le client ne fait **aucun calcul clinique** ; il rend les valeurs serveur.

## Sources serveur (existantes)

| Donnée | Service | Route | Notes |
|---|---|---|---|
| Profil (PII déchiffrée) + objectifs + devices | `patientService.getById` | `GET /api/patients/[id]` | inclut `glycemiaObjectives`, `cgmObjectives`, `referent`, `medicalData` |
| Accès patient | `canAccessPatient` | — | ADMIN / DOCTOR-NURSE (via service) / VIEWER self |
| Stats TIR/GMI/CV/moy. (calc. serveur) | `analyticsService.glycemicProfile` | `GET /api/patients/[id]/analytics` | max 90j |
| CGM (série) | `glycemiaService.getCgmEntries` | `GET /api/patients/[id]/cgm` | max 30j |
| Réglages insuline (ISF/ICR/basal/pompe) | `insulinTherapyService.getSettings` | (route à ajouter ou appel RSC) | — |
| Documents | (pipeline MinIO/MedicalDocument) | (à brancher) | — |

## Mappings clés

- **TIR** : `analytics.tir {severeHypo, hypo, inRange, elevated, hyper}` →
  `TirData {veryLow, low, inRange, high, veryHigh}`.
- **Objectif cible** : `cgmObjectives.titrLow/titrHigh` (g/L) → mg/dL (×100).
- **Cibles consensus** (TIR ≥ 70 %, hypo < 4 %) : constantes cliniques ADA/EASD
  (mêmes pour tous), pas des champs patient.
- **Âge** : dérivé de `user.birthday`. **Diag** : `medicalData.yearDiag`.
- **Référent** : `referent.pro.name` (fallback `patientServices[0].service.name`).

---

## Phases

- [x] **Phase 1 — Garde d'accès + audit + RSC + onglet « Vue d'ensemble »** (PR #543)
  - Conversion RSC, `canAccessPatient` → audit `accessDenied` + `notFound()`, audit via services.
  - **Garde consentement `shareWithProviders`** ajoutée (opt-out → état « partage désactivé », aucune PII déchiffrée) — cohérence avec routes cgm/analytics.
  - KPIs (moyenne, TIR, GMI, CV) + carte profil + objectifs + donut TIR — **réels**.
  - Cible affichée = `cgm.low/ok` (mêmes bornes que le calcul TIR serveur).
  - Caveat si capture CGM < 70 % (`warning`/`captureRate` du service).
  - Onglets Glycémie / Traitements / Documents → **état vide « bientôt disponible »**.
  - Middleware : `/patients` ajouté à la liste `no-store` (PHI en SSR).
  - Suppression de `DEMO_PATIENT` / `DEMO_CGM`.
- [x] **Phase 2 — Onglet Glycémie** (PR #544) : graphe CGM réel (24h, série
  `glycemiaService.getCgmEntries` mappée serveur g/L→mg/dL + heure Europe/Paris,
  audité READ CGM_ENTRY) + « dernière glycémie » (dernier relevé, `GlycemiaValue`
  color-codé **sur les cibles patient** `cgm.low/ok`, + **signal de fraîcheur**
  « relevé ancien » si > 30 min — revue clinique). Mapping pur extrait
  (`glycemia-view.ts`, unit-testé). État vide si pas de série.
- [ ] **Phase 3 — Onglet Traitements** : réglages insuline réels
  (`insulinTherapyService.getSettings`, route si nécessaire) + traitements associés.
- [ ] **Phase 4 — Onglet Documents** : documents médicaux réels (MinIO).

## Points de vigilance (revue) — tranchés en Phase 1

- **Consentement `shareWithProviders`** : ✅ **gaté** au niveau page (opt-out →
  état « partage désactivé », aucune PII déchiffrée). Décision : on honore
  l'opposition Art. 21 comme les routes `cgm`/`analytics` (revue HSA).
- **404 vs 403** : ✅ accès refusé → audit `accessDenied` + `notFound()` (uniforme,
  anti-énumération + détection d'abus US-2265).
- **Capture CGM** : ✅ `readingCount === 0` → état « pas de données » ; capture
  < 70 % → caveat clinique (stats non représentatives).
- **Reste (LOW, suivi)** : voir backlog ci-dessous.

## Backlog / suivi (relevé en revue PR #543, non bloquant — patterns partagés)

Items pré-existants ou transverses, hors périmètre de la Phase 1 — à traiter
dans des tickets dédiés, pas dans le câblage des onglets.

- **[Sécu] Convergence des sémantiques de consentement** : 2 implémentations
  coexistent — `patientShareConsent()` (`src/lib/consent.ts`, **fail-closed** +
  gate `gdprConsent`) vs le check inline **fail-open** des routes
  `/api/patients/[id]/cgm` et `/analytics` (que la page Phase 1 réplique pour
  cohérence). Faire converger toutes les lectures PHI sur un seul helper, décision
  documentée en DPIA.
- **[Sécu] Audit de l'accès « partage désactivé »** : la branche opt-out ne
  trace rien (parité avec cgm/analytics) — envisager une ligne `accessDenied`
  `kind: "sharingDisabled"` pour la traçabilité HDS.
- **[Sécu] XFF spoofable** : `ctx.ipAddress` = 1er hop `x-forwarded-for`
  (client-contrôlable) ; durcissement transverse — cf.
  `docs/security/xff-trusted-proxy.md`. Réutiliser `extractRequestContext`.
- **[Clinique] Plancher capteur 0.40 g/L** (`analytics.service.ts`) exclut les
  hypo sévères au plancher des agrégats (mean/CV/TIR severeHypo) — sous-estime la
  charge hypoglycémique. Inclure les relevés clampés au plancher dans le bucket
  severe-hypo.
- **[Clinique] Cibles spécifiques grossesse (GD)** : les cibles consensus
  (70/180, TIR 70 %, hypo 4 %, CV 36 %) sont DT1/DT2 ; seeder des cibles GD plus
  strictes (TIR 63–140) côté `cgmObjective`.
- **[RGPD] `getById` sur-déchiffre** `email` + relations non affichées
  (minimisation Art. 5.1.c) — méthode de lecture allégée pour la page.
- **[Perf] Double lookup patient** : la garde consentement fait un `findFirst`
  léger puis `getById` en refait un complet — fusionnable.
