# QA — Patients

Écrans : `/patients`, `/patients/[id]`, `/patients/new`.
Voir [conventions](README.md#3-conventions--légende).

> ⚠️ **Important QA** : les écrans **liste** et **détail** affichent actuellement
> des **DEMO_DATA** synthétiques (`src/app/(dashboard)/patients/page.tsx`,
> `.../[id]/page.tsx`). Les routes API réelles existent et sont testables au
> niveau **contrat** (auth, RBAC, chiffrement, audit), mais l'UI ne les consomme
> pas encore. → Tester en 2 volets : *affichage (demo)* et *contrat API (réel)*.
> Le **wizard de création** (`/patients/new`), lui, appelle la **vraie** API.

---

## Écran : Liste patients (`/patients`) 🟡

**Rôle / RBAC** : NURSE+ (NURSE, DOCTOR, ADMIN). ADMIN voit tout ; DOCTOR/NURSE
via `PatientService → HealthcareService`. Patients soft-deleted exclus.
**Statut impl.** : 🟡 DEMO_DATA pour l'affichage · 🟢 `GET /api/patients/search` réel.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Patients » | visible |
| Barre de recherche | placeholder « Rechercher un patient… » |
| Filtres pathologie | boutons [Tous] [DT1] [DT2] [GD] · sélectionné en teal |
| Bouton « + Ajouter patient » | → `/patients/new` |
| Colonnes table | Patient (+ badge « Inactif »), Pathologie (badge couleur), Âge, Dernière glycémie (mg/dL ou « — »), TIR (% + badge qualité), Dernière sync, chevron |
| Compteur | « N patient(s) » |
| État vide | « Aucun patient trouvé » / « Aucun patient trouvé pour « X » » |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Recherche par nom | (demo : filtre client) · réel : `GET /api/patients/search?search=…` | liste filtrée | **lecture** · audit READ (`resourceId:"search"`) · `Cache-Control: no-store` · match **HMAC exact** sur `firstnameHmac`/`lastnameHmac` |
| Filtre pathologie | (demo : filtre client) | bouton actif + liste filtrée | aucun |
| Clic ligne | — | `/patients/{id}` | (déclenche le détail) |
| Clic « Ajouter patient » | — | `/patients/new` | aucun |

### Scénarios (Gherkin)

```gherkin
Feature: Liste des patients

  Scenario: un NURSE accède à la liste
    Given je suis connecté en tant que "NURSE"
    When je vais sur "/patients"
    Then je vois la barre de recherche "Rechercher un patient"
    And je vois les filtres "DT1", "DT2", "GD"

  Scenario: filtrer par pathologie DT1
    Given je suis sur "/patients"
    When je clique le filtre "DT1"
    Then seules les lignes de pathologie "DT1" sont affichées
    And le filtre "DT1" est visuellement actif

  Scenario: la recherche réelle utilise un match HMAC exact (contrat API)
    Given je suis connecté en tant que "NURSE"
    When j'appelle GET "/api/patients/search?search=Durand"
    Then la réponse est 200 avec en-tête "Cache-Control: no-store"
    # Effet base: audit_logs(action=READ, resource=PATIENT, resourceId="search")
    # Note: recherche par nom EXACT (HMAC), pas de recherche partielle (protection PHI)

  Scenario: un VIEWER ne peut pas lister les patients
    Given je suis connecté en tant que "VIEWER"
    When j'appelle GET "/api/patients"
    Then la réponse est 401 ou 403
```

### Cas limites

- **Recherche = match exact** (HMAC), pas de recherche partielle/trigramme
  (protection PHI). Taper un nom partiel ne renvoie rien côté API réelle.
- **Soft-delete** : patients `deletedAt != null` jamais listés.
- **Consentement** : la liste réelle filtre `shareWithProviders=true`.

---

## Écran : Détail patient (`/patients/[id]`) 🟡

**Rôle / RBAC** : NURSE+ avec `canAccessPatient(user, role, patientId)`. 403
`forbidden` si pas d'accès, 404 `patientNotFound` si soft-deleted, 400
`invalidPatientId` si non numérique.
**Statut impl.** : 🟡 DEMO_DATA pour l'affichage · 🟢 `GET /api/patients/[id]`,
`PUT/PATCH /api/patient/objectives` réels.

### Affichage attendu

| Onglet | Contenu attendu |
|---|---|
| En-tête | « {nom} \| {pathologie} — {âge} ans — Suivi par {référent} » |
| **Vue d'ensemble** | 4 KPI (Glycémie actuelle, TIR 7 j + badge, GMI, CV + badge) · carte profil (pathologie, diagnostic, sexe, âge, référent, glycémie moyenne 14 j, objectifs) · donut TIR 7 j |
| **Glycémie** | « Profil glycémique (24 h) » + CgmChart 288 points + zones cibles |
| **Traitements** | carte insulinothérapie (méthode, pompe, insuline bolus, basal moyen, ICR, ISF) · « Aucun traitement complémentaire enregistré » |
| **Documents** | « Aucun document enregistré » |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Chargement page (réel) | `GET /api/patients/{id}` | onglets remplis (PII déchiffrée) | **lecture** · audit READ (`resource:PATIENT`, `metadata.patientId`) |
| Changer d'onglet | — | onglet affiché | aucun |
| Éditer objectifs CGM (DOCTOR) | `PUT /api/patient/objectives` | toast « Objectifs mis à jour » | UPSERT `cgm_objective` · audit UPDATE (`resource:OBJECTIVE`, `metadata.kind:"cgm"`) |
| Éditer objectifs annexes (DOCTOR) | `PATCH /api/patient/objectives` | toast | UPSERT `annex_objective` · audit UPDATE (`metadata.kind:"annex"`) |

> Bornes Zod objectifs CGM (g/L) : `veryLow ∈ [0.30,1.00]`, `low ∈ [0.40,1.50]`,
> `ok ∈ [1.00,3.00]`, `high ∈ [1.50,5.00]`, ordre strict `veryLow<low<ok<high`,
> `titrLow<titrHigh`. Annexes : `hba1c ∈ [4.0,14.0]`, `poids ∈ [20,300]` kg,
> `minWeight ≤ maxWeight`, `walk ∈ [0,600]` min/j.

### Scénarios (Gherkin)

```gherkin
Feature: Détail patient

  Scenario: un DOCTOR ouvre la fiche d'un patient de son portefeuille
    Given je suis connecté en tant que "DOCTOR"
    When j'appelle GET "/api/patients/1"
    Then la réponse est 200 avec les PII déchiffrées
    # Effet base: audit_logs(action=READ, resource=PATIENT, resourceId="1", metadata.patientId=1)

  Scenario: accès refusé à un patient hors portefeuille (anti-énumération)
    Given je suis connecté en tant que "DOCTOR"
    When j'appelle GET "/api/patients/9999" pour un patient hors de mon cabinet
    Then la réponse est 403 "forbidden"

  Scenario: patient soft-deleted renvoie 404
    Given un patient avec deletedAt non nul
    When j'appelle GET "/api/patients/{id}"
    Then la réponse est 404 "patientNotFound"

  Scenario: un DOCTOR met à jour les objectifs glycémiques
    Given je suis connecté en tant que "DOCTOR"
    When je PUT "/api/patient/objectives" avec veryLow=0.54 low=0.70 ok=1.80 high=2.50
    Then la réponse est 200
    And je vois "Objectifs mis à jour"
    # Effet base: UPSERT cgm_objective + audit_logs(UPDATE/OBJECTIVE, metadata.kind="cgm")

  Scenario: objectifs hors bornes cliniques rejetés
    Given je suis connecté en tant que "DOCTOR"
    When je PUT "/api/patient/objectives" avec ok=0.50 (sous la borne)
    Then la réponse est 400 "validationFailed"
    # Effet base: AUCUNE écriture
```

### Cas limites

- 400 `invalidPatientId` (id non numérique), 403 `forbidden`, 404
  `patientNotFound`, 403 `gdprConsentRequired`.
- Édition objectifs réservée **DOCTOR** (NURSE en lecture).

---

## Écran : Création patient — wizard (`/patients/new`) 🟢

**Rôle / RBAC** : NURSE+. `POST /api/patients`.
**Statut impl.** : 🟢 Réel (couvert par le test manuel `tests/manual/patients-new.spec.ts`).

### Affichage attendu

| Étape | Contenu attendu |
|---|---|
| Barre progression | 2 barres (étape active en teal) |
| **Étape 1 — Identité** | « Ces données seront chiffrées » · Email* · Prénom* · Nom* · Sexe (Homme/Femme/Autre) · Date de naissance (optionnelle) · [Annuler] [Suivant] |
| **Étape 2 — Pathologie** | radios DT1 / DT2 / GD (sélection en teal) · Année du diagnostic (1900–année courante, optionnelle) · [Retour] [Créer patient] |
| Bouton « Suivant » | désactivé si email invalide OU prénom/nom vides |
| Bouton « Créer patient » | « Création en cours… » pendant l'envoi · désactivé si année invalide |
| Erreur | bannière critique en haut |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Étape 1 → 2 / Retour | — (local) | change d'étape | aucun |
| Annuler | — | `/patients` | aucun |
| Soumettre | `POST /api/patients` (header `X-Requested-With` requis) | succès → redirection `/patients/{id}` · erreur → bannière | **transaction Prisma** : INSERT `users` (PII chiffrées + HMAC, role VIEWER, `needPasswordUpdate`), INSERT `patients` (pathology), INSERT `patient_medical_data` (yearDiag), INSERT `verification_token` (invitation 1 h) · 2× `audit_logs` (CREATE USER + CREATE PATIENT) · email invitation best-effort |

> Validation Zod : email RFC max 254 (trim+lowercase), prénom/nom 1–100, sexe
> ∈ {M,F,X}, birthday ∈ [1900, today], pathology ∈ {DT1,DT2,GD} requis,
> yearDiag ∈ [1900, année courante]. Body ≤ 16 KB.

### Scénarios (Gherkin)

```gherkin
Feature: Création d'un patient (wizard 2 étapes)

  Scenario: création réussie par un DOCTOR
    Given je suis connecté en tant que "DOCTOR"
    And je suis sur "/patients/new"
    When je remplis "email" avec un email unique
    And je remplis "prénom" avec "Test" et "nom" avec "QA"
    And je clique "Suivant"
    And je sélectionne la pathologie "DT1"
    And je clique "Créer patient"
    Then la réponse de POST "/api/patients" est 201
    And je suis redirigé vers "/patients/{id}"
    # Effet base: INSERT users(role=VIEWER, PII chiffrées AES-256-GCM, emailHmac)
    #             + INSERT patients(pathology=DT1) + INSERT patient_medical_data
    #             + INSERT verification_token(TTL 1h)
    #             + audit_logs ×2 (CREATE/USER via patient_creation, CREATE/PATIENT)

  Scenario: bouton Suivant désactivé tant que l'identité est incomplète
    Given je suis sur "/patients/new"
    Then le bouton "Suivant" est désactivé
    When je remplis un email valide, un prénom et un nom
    Then le bouton "Suivant" est activé

  Scenario: email déjà utilisé
    Given un patient existe déjà avec "patient.dt1@diabeo.test"
    When je soumets le wizard avec ce même email
    Then la réponse est 409 "emailExists"
    And je vois le message d'erreur correspondant
    # Effet base: AUCUNE création + audit anti-énumération

  Scenario: requête sans en-tête CSRF rejetée
    When je POST "/api/patients" sans en-tête "X-Requested-With"
    Then la réponse est 403 "csrfMissing"
```

### Cas limites

- 409 `emailExists` (+ rate-limit anti-énumération), 403 `csrfMissing`, 413 si
  body > 16 KB, 429 `tooManyAttempts`.
- L'échec d'envoi de l'email d'invitation **ne rollback pas** la création.
- Le patient est créé en rôle **VIEWER** avec `needPasswordUpdate=true`.
