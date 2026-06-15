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
- [ ] **Phase 2 — Onglet Glycémie** : graphe CGM réel (`/api/patients/[id]/cgm`),
  + KPI « glycémie actuelle » (dernier relevé).
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
- **Reste (LOW, suivi)** : `getById` sur-déchiffre `email` + relations non
  affichées (minimisation Art. 5.1.c) — méthode allégée à envisager ; plancher
  capteur 0.40 g/L de l'analytics à documenter (pré-existant, hors PR).
