# DPIA — Socle d'accès « 2 axes » (Tenant / capacités Q1-Q2 / audit scopé)

**Statut** : Brouillon — à signer DPO + RSSI avant mise en service patients réels.
**Périmètre (PR1 — fondations schéma, additif)** : modèles `Tenant`,
`VerificationPolicy`, `HealthcareMembership`, `ProfessionalRegistration` ; champs de
scope d'audit (`AuditLog.tenantId`/`scopeServiceId`) ; helpers `src/lib/capabilities.ts`
(`resolveVerificationPolicy` fail-secure + lecture capacités). **L'enforcement n'est PAS
modifié en PR1** (canAccessPatient/isOrgMember/requireRole inchangés) → la bascule
(F7 révocation, F6 isolation, écrans Q2) arrive dans les PRs suivantes.
**Lié à** : `gestion-personnel-droits-us.md` (US-2610), `prerequis-techniques-securite-us.md`
(F2/F4/F6/F7/F8), `dpia-patient-detail-dossier.md`.

## 1. Modèle d'accès cible (2 axes orthogonaux)

- **Q1 — capacité clinique (PHI, Art. 9)** : `HealthcareMembership.clinicalRole`,
  **scopée** au service, **gated** sur une « qualité PS vérifiée »
  (`ProfessionalRegistration`). **Jamais octroyable par un admin** (la gestion
  *associe* une preuve vérifiée, elle ne la *crée* pas).
- **Q2 — capacité de gestion** : `canManage` (opérationnel) / `isPrincipalAdmin`
  (peut déléguer Q2). **N'ouvre AUCUN accès aux données de santé.**
- **Tenant** = frontière d'isolation + responsable de traitement RGPD (libéral/cabinet
  = contrôleurs distincts ; hôpital = établissement contrôleur). `country` pilote la
  méthode de vérification PS (FR : RPPS/ADELI ; DZ/autres : manuel).

## 2. Politique de vérification — fail-secure (F2)

`resolveVerificationPolicy` résout `tenant > pays > défaut`, **défaut `required` codé en
dur** : base vide/corrompue → `required` (porte clinique fermée). `provisional` n'est
honoré que **borné** (`expiresAt` futur obligatoire) et **interdit en production** sauf
flag pilote explicite (`VERIFICATION_ALLOW_PILOT`) + DPIA. Réglée par `SYSTEM_ADMIN`
uniquement (jamais l'org-admin → pas d'auto-bypass de la porte clinique). Tout passage
`provisional` est **audité** (action canonique `VERIFICATION_PROVISIONAL_SET`).

## 3. Décisions de design à valider DPO

- **3.1 — `HealthcareMembership` nouvelle table (N-N)** plutôt que mutation de
  `HealthcareMember` : `HealthcareMember` reste le profil praticien (RDV/booking/
  référents) ; l'appartenance porteuse de capacités est séparée → zéro impact sur
  l'existant, et le `userId` reste 1-1 sur `HealthcareMember` (pas de retrait de `@unique`).
- **3.2 — Backfill miroir (PR1)** : 1 `Tenant` par service existant ; 1
  `HealthcareMembership` par `HealthcareMember` (clinicalRole = `User.role`, Q2 =
  manager du service). **Reflète l'accès actuel** → aucun changement de droits en PR1.
- **3.3 — `ProfessionalRegistration` générique multi-pays** (pas de champ « RPPS » en
  dur) : `{ country, scheme, number?, method, status, verifiedBy?, verifiedAt?, expiresAt? }`.
- **3.4 — Audit scopé (F8)** : `tenantId`/`scopeServiceId` + index ; **jamais de
  PHI/PII de santé** (réfs/ids uniquement, ADR #18). Set canonique d'actions ajouté
  (octroi/révocation Q1/Q2, politique vérif, invitations, preuve PS, désactivation
  établissement, bootstrap org-admin).

## 4. ⚠️ Risques acceptés V1 (actés ROADMAP)

- **F1 reporté en V4** : le bypass PHI de `ADMIN` **n'est pas retiré** et `ADMIN`
  **n'est pas renommé** `SYSTEM_ADMIN` en V1 → la garantie « hébergeur sans PHI »
  **n'est pas effective avant la V4**. Mesure transitoire : aucun rôle plateforme à un
  non-soignant.
- **Vérification PS réelle reportée en V4** (US-2611) : en V1 toute inscription est
  « considérée vérifiée ». La porte `provisional` reste fail-secure et bornée.
- **PR1 sans enforcement** : les modèles sont peuplés mais **non encore décisionnels** ;
  aucune réduction ni élargissement d'accès tant que F6/F7 ne sont pas livrés.

## 5. Tests (PR1)

- `tests/unit/capabilities.test.ts` — `resolveVerificationPolicy` fail-secure (vide→required,
  provisional borné/expiré/prod, fallback pays) + lecture capacités N-N.
- `tests/unit/access-foundations-migration-sql.test.ts` — garde du backfill (tenant par
  service, appartenance miroir avec garde-fou booléen, `ON CONFLICT`).
- **Non-régression** : suite complète verte **sans modification** des tests d'accès
  existants (preuve que l'enforcement est inchangé en PR1).

## 6. Validations à obtenir

- [ ] DPO : modèle 2 axes + responsable de traitement par tenant (§1) ; politique
  fail-secure et bornage `provisional` (§2).
- [ ] RSSI : audit scopé sans PHI (§3.4) ; risque accepté F1/vérif reportés V4 (§4).
- [ ] Direction Médicale : la porte clinique reste fermée par défaut (fail-secure).

---

*Dernière mise à jour : 2026-06-17 — DPIA initiale socle d'accès (PR1 : fondations
schéma additives, sans changement d'enforcement).*
