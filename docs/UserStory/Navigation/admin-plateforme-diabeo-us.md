# US-SYSADMIN-001 — Administration plateforme Diabeo (établissements & personnel)

> **Périmètre :** Diabeo BackOffice — **espace plateforme** réservé à l'**éditeur Diabeo**, distinct de l'espace clinique et de la gestion cabinet. **Format B léger.**
> **Baselines :** `BASELINE-RBAC` · `BASELINE-AUDIT` (immuable) · `BASELINE-DESIGN` · `BASELINE-I18N` (FR/AR + RTL).
> **Dépend de :** `US-ACCESS-001` (modèle de capacités Q1/Q2, vérification, politique fail-secure).
>
> **Distinguer 3 « admins » :** **`SYSTEM_ADMIN` (cette US, ops Diabeo)** ≠ **org-admin** (Q2, gère son cabinet — US-ACCESS-001) ≠ rôle clinique.

## 👤 En tant que
**`SYSTEM_ADMIN`** (opérateur Diabeo).

## 🎯 Je veux / Afin de
Administrer la **structure de la plateforme** — créer/gérer les **établissements** et le **personnel**, lancer les **invitations de bootstrap**, régler la **politique de vérification** — afin d'onboarder et exploiter les clients **sans jamais accéder aux données de santé** des patients.

## 📌 Description fonctionnelle
- **Établissements** : créer / configurer / désactiver un établissement (nom, type — libéral / cabinet de groupe / hôpital, **pays & marché** FR/DZ, scope).
- **Bootstrap** : créer un établissement **et inviter son premier org-admin** (résout le démarrage d'un nouvel établissement).
- **Personnel (cross-tenant)** : rechercher un `User`, voir ses **appartenances et capacités** (Q1/Q2) **et leur scope**, **révoquer** en cas d'incident (offboarding, compromission).
- **Invitations** : émettre/relancer/annuler des invitations (org-admin ou membres).
- **Politique de vérification** (cf. US-ACCESS-001) : régler le mode `requis`/`provisoire` **par tenant / pays**, **borné dans le temps**.
- **Vérifications PS manuelles** : valider/rejeter les preuves d'enregistrement déposées (le « back-office » de la vérification manuelle multi-pays).

## 🔒 Frontière d'accès (critique)
- **`SYSTEM_ADMIN` n'accède PAS aux données de santé** des patients (Art. 9). Il administre **structures + comptes + config**, **jamais** le dossier clinique en clair. *(Diabeo = hébergeur/éditeur : séparation hébergeur ↔ accès soignant.)*
- Il **n'octroie pas** la qualité PS « par décret » : il **valide une preuve** (manuelle) ou la délègue à l'API (FR) ; un compte sans preuve ne reçoit pas d'accès clinique, même via `SYSTEM_ADMIN`.

## ✔️ Critères d'acceptation
- Espace `SYSTEM_ADMIN` accessible **uniquement** à ce rôle (filtrage serveur ; absent du DOM sinon) ; **MFA fort obligatoire**.
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
1. **Accès support à un tenant** : faut-il une **impersonation/support tracée** (et jamais d'accès PHI en clair) ? À cadrer avec `healthcare-security-auditor`.
2. **Qui crée les `SYSTEM_ADMIN`** (et combien) — provisioning interne Diabeo, séparation des tâches.
3. **Suppression/anonymisation d'un établissement** : RGPD (rétention, données liées) — process dédié.
4. **Renommage `ADMIN` → `SYSTEM_ADMIN`** dans l'enum `Role` (cohérence corpus) — à planifier (migration).

## 🔗 Dépendances
`US-ACCESS-001` (modèle d'accès + vérification + politique) · `HealthcareService` / `User` / `Role` · `AuditLog` · sous-série « Gestion cabinet » (US-NAV-BO-007/008) · baselines en tête.
