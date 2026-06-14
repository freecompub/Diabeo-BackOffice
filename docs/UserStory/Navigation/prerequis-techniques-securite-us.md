# Prérequis techniques — socle d'accès (suite audit `healthcare-security-auditor`)

> **Périmètre :** déclinaison **technique** des findings de l'audit sécurité du socle d'accès. Chaque US correspond à un finding. **Format B léger.**
> **Baselines :** `BASELINE-RBAC` · `BASELINE-AUDIT` (immuable) · ANSSI/HDS.
> **Phasage :** **V1** = F2, F4, F6, F7, F8 (socle de capacités) · **V4** = F1 + renommage `ADMIN`→`SYSTEM_ADMIN` + MFA forte.

---

## US-TECH-SEC-001 — Découpler l'accès aux données de santé du rôle plateforme (**F1 — V4**)
### 👤 / 🎯
En tant qu'**équipe sécurité**, je veux que l'accès aux données de santé (PHI) ne dépende **que** de la capacité clinique Q1 vérifiée + appartenance scopée, **jamais** d'un rôle plateforme, afin de garantir la séparation **hébergeur ↔ soignant** (Art. 9).
### 📌 / ✔️ Critères d'acceptation
- Retirer le bypass PHI de `canAccessPatient` / `isOrgMember` (plus de `if role === "ADMIN" return true`).
- **Abandonner `ROLE_HIERARCHY` linéaire** (incompatible avec l'orthogonalité Q1/Q2) ; remplacer par une évaluation **2 axes**.
- **Renommer `ADMIN` → `SYSTEM_ADMIN`** (migration enum + données) — fait **avec** le découplage, pas avant (sinon simple renommage d'un super-accès).
- Test de non-régression : **un `SYSTEM_ADMIN` reçoit 403 sur tout endpoint PHI**.
### ⚠️ Risque accepté V1-V3
Tant que non livré, `ADMIN` garde l'accès PHI (cf. US-ACCESS-001 §Phasage). Mesure transitoire : pas de rôle plateforme à un non-soignant.

---

## US-TECH-SEC-002 — Modèle Tenant + politique de vérification fail-secure (**F2 — V1**)
### 👤 / 🎯
En tant que **système**, je veux un **modèle de tenant/organisation** persisté et une **table de politique de vérification**, afin de résoudre la politique `tenant > pays > environnement` de façon fiable.
### ✔️ Critères d'acceptation
- Modèle `Tenant` (ou `HealthcareService` racine promu) + `tenantId` d'isolation ; `country` exploitable.
- Table `VerificationPolicy { tenantId?, country?, mode, expiresAt, setBy, setAt }`.
- **Résolution serveur centralisée**, **défaut `requis` codé en dur** (fail-secure même base vide/corrompue).
- En **prod**, `provisoire` refusé sauf flag pilote explicite **borné** (≤ X jours) + DPIA référencée.

---

## US-TECH-SEC-003 — Appartenance scopée avec capacités + enregistrement PS générique (**F4 — V1**)
### 👤 / 🎯
En tant que **système**, je veux une appartenance **N-N** user↔scope porteuse des capacités, afin de supporter cabinet de groupe, secrétaire partagée scopée et exercice multi-structures.
### ✔️ Critères d'acceptation
- `HealthcareMembership { userId, scope(serviceId/équipe), clinicalRole?, canManage, isPrincipalAdmin }` — relation **N-N** (**retirer `@unique`** sur `HealthcareMember.userId`).
- `ProfessionalRegistration { userId, country, scheme, number, method, verifiedBy, verifiedAt, expiresAt }` (générique multi-pays, **pas** de champ « RPPS » en dur).
- Migration Prisma cadrée avec `prisma-specialist` ; données existantes migrées sans perte.

---

## US-TECH-SEC-004 — Isolation patient en cabinet de groupe (**F6 — V1**)
### 👤 / 🎯
En tant que **médecin en cabinet de groupe**, je veux ne voir **que mes patients**, afin de respecter la frontière de responsable de traitement (RGPD).
### ✔️ Critères d'acceptation
- `canAccessPatient` pour un rôle clinique repose sur le **rattachement praticien (référent)**, **pas** sur la simple appartenance au service.
- Secrétaire partagée scopée (par médecin ou par service — décision point ouvert #4) ; **identité patient sans PHI**.
- Test : « médecin A du cabinet X ne voit pas les patients du médecin B du même cabinet ».

---

## US-TECH-SEC-005 — Révocation immédiate de capacité (**F7 — V1**)
### 👤 / 🎯
En tant qu'**administrateur**, je veux qu'un retrait de capacité (Q1/Q2) prenne effet **immédiatement**, afin de couper l'accès sans attendre l'expiration du JWT (15 min).
### ✔️ Critères d'acceptation
- Les capacités Q1/Q2 **ne sont pas figées dans le JWT** ; **relues en base** (ou cache fail-closed court) à chaque requête sensible.
- Révocation **par (sid, capacité)** ou **bump `authVersion`** (invalide les tokens émis avant).
- Réévaluer la grâce 15 min de `verifyJwtAllowExpired` pour les changements de droits.
- Test : retrait de Q1 → 403 PHI **immédiat** (pas 15 min plus tard).

---

## US-TECH-SEC-006 — Couverture d'audit du socle (**F8 — V1**)
### 👤 / 🎯
En tant qu'**auditeur HDS/CNIL**, je veux une traçabilité **complète et filtrable par scope** des actions sensibles, afin d'assurer le forensics.
### ✔️ Critères d'acceptation
- **Set canonique** d'`action`/`resource` couvrant : octroi/révocation Q1/Q2, changement de politique de vérification, invitations (envoi/consommation/révocation), validation/rejet preuve PS, désactivation établissement, bootstrap org-admin, passage `provisoire`.
- Ajout d'un champ **`scope`/`tenantId` structuré + index** dans `AuditLog` (modèle ADR #18).
- **Aucun PHI/PII de santé** dans `oldValue`/`newValue` (diffs par références/ids).
- Entrées **immuables** (trigger PG existant).

---

## 🔗 Dépendances
`US-ACCESS-001` · `US-ACCESS-002` · `prisma/schema.prisma` (`Role`, `HealthcareService/Member`, `AuditLog`, `Session`) · `src/lib/auth/*` · `src/lib/access-control.ts` · `src/lib/org-access.ts`.

---

## US-TECH-SEC-007 — Sécurité de session (mono-session + timeout + durées) (**V1**)

### 👤 En tant que
Équipe sécurité / système.

### 🎯 Je veux / Afin de
Durcir les sessions backoffice (session unique, timeout d'inactivité, durées adaptées), afin de limiter le risque de **compte partagé** ou de **token volé**.

### 📌 Description fonctionnelle
- **Mono-session** : un seul token valide à la fois pour **tout rôle backoffice** ; **exception `PATIENT`** (multi-appareils). *(consolidé depuis US-ACCESS-001)*
- **Timeout d'inactivité** : déconnexion automatique après inactivité, **renforcé** pour `SYSTEM_ADMIN` / admin principal.
- **Durées token/session réévaluées** (aujourd'hui JWT 15 min, session 24 h) — session plus courte envisagée pour les rôles à fort pouvoir.

### ✔️ Critères d'acceptation
- Nouvelle connexion backoffice **invalide la session précédente** ; `PATIENT` exempté.
- Inactivité → **déconnexion auto** (seuil configurable, plus court pour rôles à fort pouvoir).
- Durées documentées/ajustées ; **révocation immédiate** (lien US-TECH-SEC-005 / F7).

### 🧩 Règles métier
- **Fail-closed** ; réutilise l'infra `revocation` / `Session` existante.

### ⚠️ Points ouverts
- Seuils exacts de timeout ; durée de session des rôles à fort pouvoir.

### 🔗 Dépendances
`US-ACCESS-001` (mono-session) · `US-TECH-SEC-005` (révocation) · `src/lib/auth/*`.
