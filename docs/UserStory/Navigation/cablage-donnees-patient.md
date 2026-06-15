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
- [x] **Phase 3 — Onglet Traitements** (PR #545) : réglages insuline réels
  (`insulinTherapyService.getSettings`, audité READ INSULIN_THERAPY, derrière la
  garde accès+consentement) — méthode (pompe/manuel) + config **par créneau**
  ISF (g/L/U) / ICR (g/U) / basal (U/h), pas de moyenne lossy — + traitements
  associés (`getById.treatments`, soft-deleted filtrés). Mapping pur
  `treatment-view.ts` (unit-testé). Insuline bolus/modèle pompe (catalogue/
  device) → backlog. État vide si pas de réglages.
- [x] **Phase 4 — Onglet Documents** (PR #546) : liste documents médicaux réels
  via `documentService.list` (scopé serveur — VIEWER ne voit que `patientShare`,
  `fileUrl` omis, audité READ MEDICAL_DOCUMENT, derrière la garde accès+
  consentement). Affiche titre / catégorie / date / taille + **téléchargement**
  via `/api/documents/[id]/download` (auth + scope + ClamAV serveur). Mapping pur
  `document-view.ts` (unit-testé). État vide « Aucun document ». **Chantier
  câblage données patient terminé.**

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

- ✅ **[Sécu] Convergence des sémantiques de consentement** (FAIT) : les 4
  outliers (page dossier, routes `cgm`/`analytics`, route `download`) convergés
  sur `patientShareConsent` (**fail-closed** + `gdprConsent` + `shareWithProviders`),
  alignés sur les ~18 autres routes per-patient. **Delta de comportement** : un
  patient sans consentement RGPD / sans partage / sans row privacy est désormais
  bloqué sur ces surfaces (404 si inexistant, 403/état « partage désactivé »
  sinon) — durcissement cohérent avec le reste de l'app. **DPIA rédigé** :
  `docs/compliance/dpia-patient-detail-dossier.md` (validations DPO/RSSI à obtenir).
- **[Sécu, à investiguer] Route `glycemia` GET — sur-blocage self-service** :
  cette route admet un VIEWER (`requireAuth`, pas `requireRole`) MAIS appelle
  `patientShareConsent` (qui vérifie `shareWithProviders`) — un patient lisant
  SA propre glycémie avec `shareWithProviders=false` serait bloqué à tort.
  Confirmer si la route est réellement atteinte par un VIEWER ; si oui, exempter
  le VIEWER (comme la route download). Pré-existant (relevé revue PR #547).
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
- ✅ **[Clinique] Cibles spécifiques grossesse (GD)** (FAIT) : à défaut
  d'objectif CGM, `analyticsService` (TIR/donut) ET le badge cible du dossier
  utilisent désormais `getCgmDefaults(pathology)` → GD = 63–140 mg/dL (Battelino
  2019) au lieu de 70–180. Badge et calcul restent cohérents (même source).
- **[RGPD] `getById` sur-déchiffre** `email` + relations non affichées
  (minimisation Art. 5.1.c) — méthode de lecture allégée pour la page.
- **[Perf] Double lookup patient** : la garde consentement fait un `findFirst`
  léger puis `getById` en refait un complet — fusionnable.
- **[Clinique] Plancher 0.40 ↔ fraîcheur (Phase 2)** : une hypo sévère < 40 mg/dL
  exclue par le plancher peut laisser un relevé bénin plus ancien passer pour le
  « dernier relevé » sans déclencher `stale`. À traiter avec l'item plancher.
- ✅ **[Audit] Pivot `metadata.patientId` harmonisé** (FAIT) : ajouté sur
  `READ CGM_ENTRY` / `GLYCEMIA_ENTRY` (`glycemia.service`) et `READ BOLUS_LOG`
  (`getBolusLogs`/`getBolusLogById`, `insulin-therapy.service`), + `requestId`.
  (INSULIN_THERAPY l'avait déjà via Phase 3.)
- **[RGPD] `Treatment.name`/`posology` en clair** (Art. 9) : colonnes non
  chiffrées (≠ identité/medicalData). Chiffrer ou documenter le risque accepté
  en DPIA (schéma pré-existant).
- **[Clinique] Créneaux ISF/ICR/basal — gaps/overlaps non signalés** : la vue
  affiche les créneaux verbatim sans alerter si la couverture 24h n'est pas
  contiguë. Indice visuel non bloquant à envisager.
- **[Produit] Insuline bolus (nom) + modèle pompe** : nécessitent join
  catalogue/device — à ajouter à l'onglet Traitements.
- **[i18n] Clé unité ISF dupliquée** : `dashboardCards.medecinProposals.unitIsfGl`
  ≈ `patientDetail.unitIsf` (« g/L/U ») — consolider une source unique.
- **[Sécu] Route download — `documentNotFound` vs `patientNotFound`** : 2 chaînes
  d'erreur 404 distinctes (oracle d'énumération mineur) — uniformiser en `notFound`
  neutre (Phase 4 a déjà ajouté la garde consentement `shareWithProviders` PRO).
- **[Sécu] Convergence consentement download/list** : la garde `shareWithProviders`
  PRO est désormais sur la route download ET la liste, mais via des checks inline ;
  à converger sur le helper unique (cf. item « convergence des sémantiques »).
