# US-2613 — Administration plateforme Diabeo (établissements & personnel)

> **Périmètre :** Diabeo BackOffice — **espace plateforme** réservé à l'**éditeur Diabeo**, distinct de l'espace clinique et de la gestion cabinet. **Format B léger.**
> **Baselines :** `BASELINE-RBAC` · `BASELINE-AUDIT` (immuable) · `BASELINE-DESIGN` · `BASELINE-I18N` (FR/AR + RTL).
> **Dépend de :** `US-2610` (modèle de capacités Q1/Q2, vérification, politique fail-secure).
>
> **Distinguer 3 « admins » :** **`SYSTEM_ADMIN` (cette US, ops Diabeo)** ≠ **org-admin** (Q2, gère son cabinet — US-2610) ≠ rôle clinique.

## 👤 En tant que
**`SYSTEM_ADMIN`** (opérateur Diabeo).

## 🎯 Je veux / Afin de
Administrer la **structure de la plateforme** — créer/gérer les **établissements** et le **personnel**, lancer les **invitations de bootstrap**, régler la **politique de vérification** — afin d'onboarder et exploiter les clients **sans jamais accéder aux données de santé** des patients.

## 📌 Description fonctionnelle
- **Établissements** : créer / configurer / désactiver un établissement (nom, type — libéral / cabinet de groupe / hôpital, **pays & marché** FR/DZ, scope).
- **Bootstrap** : créer un établissement **et inviter son premier org-admin** (résout le démarrage d'un nouvel établissement).
- **Personnel (cross-tenant)** : rechercher un `User`, voir ses **appartenances et capacités** (Q1/Q2) **et leur scope**, **révoquer** en cas d'incident (offboarding, compromission).
- **Invitations** : émettre/relancer/annuler des invitations (org-admin ou membres).
- **Politique de vérification** (cf. US-2610) : régler le mode `requis`/`provisoire` **par tenant / pays**, **borné dans le temps**.
- **Vérifications PS manuelles** : valider/rejeter les preuves d'enregistrement déposées (le « back-office » de la vérification manuelle multi-pays).

## 🔒 Frontière d'accès (critique)
- **`SYSTEM_ADMIN` n'accède PAS aux données de santé** des patients (Art. 9). Il administre **structures + comptes + config**, **jamais** le dossier clinique en clair. *(Diabeo = hébergeur/éditeur : séparation hébergeur ↔ accès soignant.)*
  - ⚠️ **Effectif en V4** (dépend de **F1** — découplage accès PHI / rôle plateforme). **D'ici là (V1-V3) : risque accepté** — l'`ADMIN` conserve l'accès PHI ; mesure transitoire : pas de rôle plateforme confié à un non-soignant (cf. US-2610 §Phasage).
- Il **n'octroie pas** la qualité PS « par décret » : il **valide une preuve** (manuelle) ou la délègue à l'API (FR) ; un compte sans preuve ne reçoit pas d'accès clinique, même via `SYSTEM_ADMIN`.

## ✔️ Critères d'acceptation
- Espace `SYSTEM_ADMIN` accessible **uniquement** à ce rôle (filtrage serveur ; absent du DOM sinon) ; **MFA forte obligatoire (V4 — SMS exclu, appli TOTP ou clé/passkey ; F9)**.
- **Session unique (V1)** : un seul token valide à la fois pour ce rôle (cf. US-2610 §Session unique).
- Créer un établissement puis **inviter son premier org-admin** fonctionne de bout en bout (l'org-admin reçoit l'invitation et obtient Q2 sur **ce** scope).
- La recherche de personnel est **cross-tenant** mais n'expose **aucune donnée de santé** patient (uniquement comptes/appartenances/capacités).
- Régler la politique de vérification d'un tenant prend effet (résolution `tenant > pays > environnement`, fail-secure) et est **borné + audité**.
- Valider/rejeter une preuve PS met à jour l'état du compte (`vérifié` / `refusé`) et est audité.
- **Audit** (BASELINE-AUDIT) de **toute** action plateforme (création établissement, invitation, octroi/révocation, changement de politique, validation PS) — acteur, cible, scope, horodatage, immuable.
- FR/AR + RTL.

## 🧩 Règles métier
- **Séparation hébergeur ↔ soignant** : le `SYSTEM_ADMIN` gère la structure, **pas le PHI**. Tout accès éventuel à des données patient (support) passerait par un mécanisme **distinct, explicite, tracé** (cf. point ouvert).
- **Capacités scopées** : tout grant émis reste rattaché à un établissement/équipe ; pas de droit clinique « global ».
- **Non-contournement de la vérification** : `SYSTEM_ADMIN` applique la politique, il ne fabrique pas une qualité PS sans preuve.
- **Moindre privilège + traçabilité** : rôle à fort pouvoir → MFA fort, audit exhaustif, idéalement break-glass pour les actions les plus sensibles.

## ⚠️ Points ouverts
1. **Accès support à un tenant** — **décidé** : cible = **support sans accès PHI** (impersonation tracée, jamais de données de santé en clair), mais **reporté en V4** ; **en V1-V3 l'accès reste total** (cohérent avec le report de F1).
2. **Qui crée les `SYSTEM_ADMIN`** — **décidé** : **par l'admin Diabeo** pour le moment (provisioning interne ; séparation des tâches à formaliser plus tard).
3. **Suppression / anonymisation d'un établissement** — **décidé** : **sur demande officielle uniquement, aucune interface** (process ops + RGPD rétention/données liées).
4. **Renommage `ADMIN` → `SYSTEM_ADMIN`** — planifié en **V4** (avec F1, US-2615).

## 🔗 Dépendances
`US-2610` (modèle d'accès + vérification + politique) · `HealthcareService` / `User` / `Role` · `AuditLog` · sous-série « Gestion cabinet » (US-2606/US-2607) · baselines en tête.

---

## US-2614 — Support / impersonation sans accès aux données de santé (**V4**)

### 👤 En tant que
Support / `SYSTEM_ADMIN` Diabeo intervenant sur un tenant.

### 🎯 Je veux / Afin de
Diagnostiquer un problème client **sans jamais accéder aux données de santé**, de façon **tracée et bornée**, afin de respecter la séparation hébergeur ↔ soignant.

### 📌 Description fonctionnelle
- Accès support à un tenant **sans déchiffrement PHI** : vues techniques / structure / config, données **dé-identifiées**.
- Si « voir comme le client » est nécessaire : **impersonation explicite, consentie, bornée, auditée** (`SUPPORT_IMPERSONATION_START/END`), **jamais de PHI en clair**, **alerting SOC**.

### ✔️ Critères d'acceptation
- **Aucun accès aux données de santé** patient via le support (test : masqué/403).
- Impersonation **tracée** (début/fin), **bornée**, **auditée** + alerting.
- **MFA forte** requise.

### 🧩 Règles métier
- Séparation **hébergeur ↔ soignant** ; moindre privilège ; break-glass distinct.

### ⚠️ Points ouverts
- Périmètre exact de l'impersonation ; base de consentement.

### 🗺️ Roadmap
- **V4** (cf. F1). **V1-V3** : accès total = **risque accepté** (US-2613 §Frontière d'accès).

### 🔗 Dépendances
`US-2613` · `US-2615` (F1) · `AuditLog`.
