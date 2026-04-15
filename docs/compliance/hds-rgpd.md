# Conformite HDS et RGPD

## Hebergement de Donnees de Sante (HDS)

Diabeo BackOffice est concu pour respecter les exigences de la certification HDS (ISO 27001/27018) requise en France pour tout hebergement de donnees de sante.

### Exigences implementees

| Exigence | Implementation |
|----------|---------------|
| Chiffrement at-rest | AES-256-GCM applicatif sur tous les champs PII |
| Chiffrement in-transit | HTTPS obligatoire (TLS 1.3) |
| Tracabilite des acces | AuditLog immutable sur chaque acces sante |
| Controle d'acces | RBAC 4 niveaux + controle par service de sante |
| Authentification forte | JWT RS256 + MFA (TOTP) prevu |
| Integrite des logs | Trigger PostgreSQL empeche UPDATE/DELETE sur AuditLog |
| Sauvegarde | Backup PostgreSQL chiffre sur OVH Object Storage |

### Audit Trail

Chaque acces a une donnee de sante genere un enregistrement dans `AuditLog` :

```json
{
  "userId": 42,
  "action": "READ",
  "resource": "PATIENT",
  "resourceId": "patient:123",
  "ipAddress": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "requestId": "a1b2c3d4e5f60718",
  "metadata": {},
  "createdAt": "2026-04-01T10:00:00Z"
}
```

**Actions tracees** (union `AuditAction` dans `src/lib/services/audit.service.ts`) :

| Groupe | Actions |
|---|---|
| Acces | `LOGIN`, `LOGOUT`, `READ`, `CREATE`, `UPDATE`, `DELETE` |
| Export | `EXPORT`, `IMPORT` |
| Securite | `UNAUTHORIZED`, `RATE_LIMITED`, `CONFIG_ERROR` |
| MFA | `MFA_SETUP_INITIATED`, `MFA_ENABLED`, `MFA_DISABLED`, `MFA_CHALLENGE_FAILED` |
| Metier | `BOLUS_CALCULATED`, `PROPOSAL_ACCEPTED`, `PROPOSAL_REJECTED` |

**Separation semantique** : les actions `RATE_LIMITED` et `CONFIG_ERROR` ont ete
introduites apres PR #104/#105 pour eviter de polluer `UNAUTHORIZED` avec des
evenements qui ne sont pas des violations de controle d'acces — garde le triage
SIEM et breach-notification (RGPD Art. 33) propre.

**Correlation** : le champ `requestId` (PR #105) joint chaque entree audit aux
lignes de log applicatives via le header `x-request-id`. Assignee par le
middleware, validee (regex anti-injection), echoed dans la reponse.

**Immuabilite** : `audit_logs` est protege par un trigger PostgreSQL
(`prisma/sql/audit_immutability.sql`) qui empeche toute UPDATE / DELETE. Meme un
compromis middleware n'altere pas les traces.

### Consentement GDPR — cache Redis

`requireGdprConsent(userId)` met en cache le resultat pour :

- **60s** si consentement present (`true`) — borne la fenetre de latence entre
  revocation DB et propagation (RGPD Art. 7(3) "aussi facile que donner").
- **300s** si absent/null — pas de risque confidentialite a sur-cacher un "non".

Invalidation explicite sur :

- `PUT /api/account/privacy` quand `gdprConsent` est dans le payload
- `DELETE /api/account` (RGPD Art. 17) — invalidation AVANT transaction pour
  survivre a un crash mi-TX, ET apres commit (idempotent).

Fail-open sur panne Redis : la route re-query Prisma (optimisation, pas
frontiere de confiance).

## RGPD — Reglement General sur la Protection des Donnees

### Article 9 — Donnees de sante

Les donnees de sante sont des donnees sensibles sous RGPD Article 9. Leur traitement necessite :

1. **Consentement explicite** — Verifie via `requireGdprConsent(userId)` sur chaque route accedant a des donnees de sante
2. **Base legale** — Consentement enregistre dans `UserPrivacySettings.gdprConsent` avec horodatage `consentDate`
3. **Revocation** — Si `gdprConsent = false`, toutes les routes de donnees medicales retournent 403

### Article 17 — Droit a l'oubli

`DELETE /api/account` declenche une suppression en cascade :

1. Audit log cree AVANT suppression (le seul log qui survit)
2. Invalidation du cache GDPR (pre-TX, survit a un crash mi-suppression)
3. Suppression de toutes les donnees patient (30+ tables)
4. Patient soft-delete (pas de suppression physique)
5. Anonymisation du User : champs chiffres avec "ANONYMISE", passwordHash = "DELETED"
6. Nullification des champs PII (phone, address, nirpp, ins...)
7. **MFA reset** : `mfaSecret`, `mfaEnabled=false`, `mfaLastUsedStep=null` (regression guard PR #106)
8. emailHmac remplace par hash non reversible
9. Seconde invalidation du cache GDPR apres commit (idempotent)

La suppression necessite la confirmation du mot de passe.

### Article 20 — Portabilite

`GET /api/account/export` genere un export JSON complet :

- Profil utilisateur (dechiffre)
- Donnees patient et medicales (dechiffrees)
- Historique CGM et glycemie
- Evenements diabete
- Insulinotherapie et propositions d'ajustement
- Rendez-vous et documents (metadonnees)

### Consentement et partage

| Parametre | Description | Default |
|-----------|-------------|---------|
| gdprConsent | Consentement traitement donnees sante | false |
| shareWithProviders | Partage avec equipe soignante | true |
| shareWithResearchers | Partage avec chercheurs | false |
| analyticsEnabled | Analyse d'usage | true |

Si `shareWithProviders = false`, les routes professionnelles (`/api/patients/:id/cgm`, `/api/patients/:id/analytics`) retournent 403.

## Authentification forte — MFA TOTP

Depuis PR #106 (voir `docs/security/mfa-flow.md` pour les diagrammes de sequence), l'authentification supporte un second facteur optionnel base sur TOTP (RFC 6238) — compatible Google Authenticator, 1Password, Aegis.

### Garanties HDS

- **Secret at rest** : `User.mfaSecret` chiffre AES-256-GCM via `encryptField`. Un dump DB ne leak pas les seeds TOTP.
- **Replay protection** : `User.mfaLastUsedStep` (RFC 6238 T counter) + CAS Prisma optimiste. Un OTP ne peut etre utilise qu'une fois, meme dans sa fenetre de validite (±1 step = 60s).
- **Audit dedie** (non pollue avec `UNAUTHORIZED`) :
  - `MFA_SETUP_INITIATED` — generation secret (HDS §IV.3 : operation sensible credential)
  - `MFA_ENABLED` — activation confirmee par premier OTP valide
  - `MFA_DISABLED` — desactivation (password + OTP requis)
  - `MFA_CHALLENGE_FAILED` — OTP invalide avec `metadata.phase` (verify/challenge/disable)
- **Session provenance** : `Session.mfaVerified=true` uniquement sur les sessions issues de `/api/auth/mfa/challenge`. Permet de distinguer en forensic les sessions second-factor des sessions password-only.

### JWT audience split

Le token mfa-pending (5 min TTL) utilise une audience distincte `diabeo-mfa-pending`. Le middleware verifie `diabeo-hc` → le mfa-pending est systematiquement rejete (401 `tokenInvalid`) sur les routes protegees. Tests de cross-confusion dans `tests/unit/jwt.test.ts`.

### Disable — double facteur

`POST /api/auth/mfa/disable` requiert BOTH `{ password, otp }`. 401 uniforme `invalidCredentials` en cas d'echec (pas d'oracle sur le facteur qui a echoue). Une session volee sans le mot de passe ne peut pas desactiver MFA ; un mot de passe fuite sans le telephone ne peut pas non plus.

### Recovery (hors scope POC)

Un utilisateur qui perd son telephone et son mot de passe est actuellement locked out (reset-password est un stub). Les moyens de recovery HDS-compliants sont listes en backlog :

- Backup codes (one-shot, hash at rest)
- Reset MFA admin-attested (identification hors-ligne + `MFA_RESET_BY_ADMIN` audit)
- WebAuthn (hardware token alternative)
