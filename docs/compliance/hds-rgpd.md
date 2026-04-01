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
  "resourceId": "123",
  "ipAddress": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "metadata": {},
  "createdAt": "2026-04-01T10:00:00Z"
}
```

Actions tracees : LOGIN, LOGOUT, READ, CREATE, UPDATE, DELETE, EXPORT, UNAUTHORIZED, BOLUS_CALCULATED, PROPOSAL_ACCEPTED, PROPOSAL_REJECTED.

L'AuditLog est protege par un trigger PostgreSQL qui empeche toute modification ou suppression apres creation (`audit_immutability.sql`).

## RGPD — Reglement General sur la Protection des Donnees

### Article 9 — Donnees de sante

Les donnees de sante sont des donnees sensibles sous RGPD Article 9. Leur traitement necessite :

1. **Consentement explicite** — Verifie via `requireGdprConsent(userId)` sur chaque route accedant a des donnees de sante
2. **Base legale** — Consentement enregistre dans `UserPrivacySettings.gdprConsent` avec horodatage `consentDate`
3. **Revocation** — Si `gdprConsent = false`, toutes les routes de donnees medicales retournent 403

### Article 17 — Droit a l'oubli

`DELETE /api/account` declenche une suppression en cascade :

1. Audit log cree AVANT suppression (le seul log qui survit)
2. Suppression de toutes les donnees patient (30+ tables)
3. Patient soft-delete (pas de suppression physique)
4. Anonymisation du User : champs chiffres avec "ANONYMISE", passwordHash = "DELETED"
5. Nullification des champs PII (phone, address, nirpp, ins...)
6. emailHmac remplace par hash non reversible

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
