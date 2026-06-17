# DPIA — Gestion du personnel & des droits du cabinet (US-2610, PR4a backend)

**Statut** : Brouillon — à signer DPO + RSSI avant mise en service patients réels.
**Périmètre (PR4a)** : service `org-membership.service` (lister/inviter membres,
octroyer/révoquer capacités Q1/Q2, retirer un membre) + routes `/api/cabinet/[id]/members`
+ email d'invitation. UI = PR4b.
**Lié à** : `dpia-access-foundations.md` (capacités Q1/Q2), `dpia-session-security.md`
(révocation immédiate F7), `gestion-personnel-droits-us.md`.

## 1. Données traitées

| Donnée | Catégorie | Traitement |
|---|---|---|
| `User.email` / `firstname` / `lastname` du membre | PII | chiffrées AES-256-GCM ; déchiffrées **serveur** pour la liste (gestionnaire autorisé) |
| Capacités `HealthcareMembership` (clinicalRole, canManage, isPrincipalAdmin) | métadonnée d'accès | en clair |
| Token d'invitation (`VerificationToken`) | secret | single-use, TTL 1h, keyé `emailHmac` (F15 anti-énumération) |

**Aucune donnée de santé** sur cet écran (gestion = régime distinct du PHI).

## 2. Modèle d'autorisation (2 axes)

- **Accès à la gestion** = capacité **Q2** (`canManage`) dans le **scope** du service
  (`assertCanManage`, ADMIN bypass V1). Un médecin sans Q2 n'y accède pas.
- **Octroi/retrait Q2** (`canManage`) = **admin principal** (ou ADMIN).
- **`isPrincipalAdmin`** = **ADMIN uniquement** (un principal ne nomme que des délégués
  → limite la prolifération d'admins et le rayon d'un compte compromis).
- **Q1** (`clinicalRole`, PHI) = **octroyable en V1** (« considéré vérifié » ; cf. §4).
- **Non-auto-élévation** : on ne modifie pas ses propres capacités (`selfElevation`).
- **Anti-self-lockout** : le dernier admin principal d'un service ne peut pas être retiré.
- **Révocation immédiate (F7)** : toute modif/retrait bump `User.authVersion` +
  `invalidateAllUserSessions` → accès coupé à la requête suivante (≤ refresh sinon).

## 3. Décisions de design à valider DPO

- **3.1 — Invitation single-use** : réutilise `VerificationToken` (flux set-password,
  keyé `emailHmac`, TTL 1h) → cohérent avec reset-password, anti-énumération (F15).
  Email sans PHI (`emailService.sendStaffInvitation`).
- **3.2 — Création de membre** : email existant → rattachement ; sinon création d'un
  `User` clinique + invitation. Données déjà créées par un membre retiré **restent**
  (append-only / audit).
- **3.3 — Audit canonique (F8)** : `INVITATION_SENT` (ORG_INVITATION),
  `CAPABILITY_GRANTED`/`CAPABILITY_REVOKED` (HEALTHCARE_MEMBERSHIP), tous scopés
  `scopeServiceId`. **Aucun PHI** ; PII membre jamais en clair dans l'audit.

## 4. ⚠️ Risques acceptés V1

- **Q1 octroyable par la gestion en V1** (décision produit) : la vérification PS réelle
  (RPPS/Ordre) est reportée en **V4** → un org-admin peut associer un rôle clinique
  « considéré vérifié ». **Risque** : chemin d'octroi d'accès PHI avant vérification.
  **Atténuation** : pilote maîtrisé + onboarding de soignants connus + audit. Durci en
  V4 (gate sur `ProfessionalRegistration.status = verified`).
- **Pas de rôle « gestionnaire non-soignant »** (F1/V4) : en V1 un membre géré est un
  utilisateur clinique (`DOCTOR`/`NURSE`). La **secrétaire pure Q2-seule** est reportée V4.
- **`ADMIN` bypass PHI** : inchangé (V4 / F1).

## 5. Tests (PR4a)

- `tests/unit/org-membership.service.test.ts` — accès Q2 (ADMIN bypass), liste déchiffrée,
  invite (nouveau/existant/déjà-membre), principal-only Q2, ADMIN-only isPrincipalAdmin,
  non-auto-élévation, anti-self-lockout, révocation immédiate (bump + invalidate).
- `tests/integration/api-cabinet-members.test.ts` — RBAC + mapping erreurs (403/404/409) +
  validation Zod.

## 6. Validations à obtenir

- [ ] DPO : modèle 2 axes en gestion (§2) ; **Q1 considéré-vérifié V1** (§4) + report V4.
- [ ] RSSI : invitation single-use (§3.1), audit scopé sans PHI (§3.3), révocation immédiate.
- [ ] Direction Médicale : gestion ≠ accès santé ; gestionnaire pur Q2 reporté V4.

---

*Dernière mise à jour : 2026-06-17 — DPIA initiale gestion cabinet (PR4a : service +
routes + invitations).*
