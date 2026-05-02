# Securite — Chiffrement et authentification

## Chiffrement des donnees de sante (AES-256-GCM)

### Principe

Toutes les donnees personnelles identifiables (PII) sont chiffrees au niveau applicatif avant insertion en base de donnees. Meme en cas de compromission de la base, les donnees restent illisibles.

### Format de stockage

```
IV (12 bytes) + Auth Tag (16 bytes) + Ciphertext
```

Converti en base64 pour stockage dans les colonnes String de PostgreSQL.

### Champs chiffres

#### Utilisateur (User)
- email, firstname, lastname, phone
- address1, address2, cp, city
- nirpp, nirppPolicyholder, ins, codeBirthPlace

#### Donnees medicales (PatientMedicalData)
- historyMedical, historyChirurgical, historyFamily
- historyAllergy, historyVaccine, historyLife
- diabetDiscovery

#### Evenements (DiabetesEvent)
- comment

#### Rendez-vous (Appointment)
- comment

#### Grossesse (PatientPregnancy)
- notes

### Lookup email — HMAC-SHA256

L'email etant chiffre, un lookup direct est impossible. Un HMAC-SHA256 deterministe (`emailHmac`) est stocke comme index unique :

```typescript
hmacEmail(email) = HMAC-SHA256(email.toLowerCase().trim(), HMAC_SECRET)
```

### Chiffrement des fichiers (OVH Object Storage)

Les documents medicaux et photos de profil stockes sur OVH Object Storage (S3-compatible) sont proteges par :

1. **SSE-S3 (Server-Side Encryption)** — `ServerSideEncryption: "AES256"` sur chaque `PutObjectCommand`. OVH chiffre at-rest avec des cles gerees par l'infrastructure.

2. **TLS 1.3 en transit** — le endpoint OVH (`s3.gra.perf.cloud.ovh.net`) impose HTTPS.

3. **Pas de presigned URLs** — tous les acces S3 passent par le backend Next.js avec verification JWT + RBAC + audit. Le client ne recoit jamais de lien direct vers S3.

4. **Scan antivirus** — chaque fichier est ecrit en temp, scanne par ClamAV (`scanBuffer`), puis uploade. Fail-closed en production (refuse sans ClamAV).

| Type | Prefix S3 | Taille max | MIME autorises | RBAC |
|------|-----------|------------|----------------|------|
| Documents medicaux | `documents/` | 50 MB | PDF, JPEG, PNG, WebP, DOCX | NURSE+ |
| Avatar profil | `avatars/` | 5 MB | JPEG, PNG, WebP | Auth (tous) |

Les cles d'objet sont des UUID : `{prefix}/{uuid}.{ext}` — pas de nom de fichier utilisateur dans le path S3.

### Cles de chiffrement

| Variable | Usage | Format |
|----------|-------|--------|
| HEALTH_DATA_ENCRYPTION_KEY | AES-256-GCM | 32 bytes hex (64 chars) |
| HMAC_SECRET | Email lookup | 32+ bytes |
| JWT_PRIVATE_KEY | Signature JWT RS256 | PEM RSA privee |
| JWT_PUBLIC_KEY | Verification JWT RS256 | PEM RSA publique |
| OVH_S3_ACCESS_KEY | Object Storage S3 | Credential OVH |
| OVH_S3_SECRET_KEY | Object Storage S3 | Credential OVH |
| OVH_S3_ENDPOINT | Object Storage URL | URL (prod: s3.gra.perf.cloud.ovh.net) |
| OVH_S3_BUCKET | Nom du bucket | String |
| OVH_S3_REGION | Region OVH | String (ex: gra) |
| FIREBASE_SERVICE_ACCOUNT_KEY | FCM push notifications | Base64(JSON service account) |
| FIREBASE_PROJECT_ID | Firebase project ID | String (optionnel si dans la cle) |

### Push notifications (Firebase Cloud Messaging)

Les notifications push transitent par Google FCM. Mesures de protection :

1. **Pas de donnees de sante dans le payload FCM** — le champ `notification` global n'est pas utilise. Le contenu est envoye via les canaux specifiques plateforme (APNs/Android/WebPush). Les templates ne doivent contenir que des codes generiques (`alertType=hypo`, pas `glucoseValue=0.45`).

2. **PushNotificationLog ne stocke pas le contenu en clair** — seul le templateId et un idempotency key sont enregistres. Le titre et le body sont remplaces par des references (`[push:{templateId}]`).

3. **Autorisation cible** — `canAccessPatient()` verifie que l'envoyeur a une relation de soin avec le destinataire. Les non-patients ne peuvent etre notifies que par un ADMIN.

4. **Rate limiting fail-closed** — 50 envois/heure par utilisateur. Si Redis est indisponible, les envois sont bloques (pas fail-open).

5. **Retry limite** — seuls les codes retriable FCM (`internal-error`, `server-unavailable`, `unavailable`) declenchent un retry. Un idempotency key est inclus dans le payload data pour la deduplication cote client.

6. **Variables templates sanitisees** — tronquees a 200 caracteres, valeurs data limitees a 500 caracteres via Zod.

7. **Cle Firebase** — stockee en base64 dans env var, validee au demarrage par schema Zod (type, project_id, private_key, client_email).

## Authentification JWT RS256

### Flux

1. `POST /api/auth/login` — email + password
2. Lookup par emailHmac, comparaison bcrypt
3. Verification MFA si active (bloquant sinon)
4. Generation JWT RS256 (24h, issuer: diabeo-backoffice, audience: diabeo-hc)
5. Creation Session en base
6. Retour du token

### Payload JWT

```json
{
  "sub": 42,
  "role": "DOCTOR",
  "platform": "hc",
  "sid": "session-id",
  "iss": "diabeo-backoffice",
  "aud": "diabeo-hc",
  "iat": 1711900800,
  "exp": 1711987200
}
```

### Middleware

Le middleware Next.js (Edge Runtime) verifie le JWT sur toutes les routes `/api/**` sauf `/api/auth/*`. Il injecte `x-user-id` et `x-user-role` dans les headers, et strippe ces headers sur les routes auth pour empecher le spoofing.

### Rate limiting

- 3 tentatives echouees : lockout 5 minutes
- 4e tentative : lockout 15 minutes
- 5e+ : lockout 60 minutes
- Stockage in-memory (TODO: Redis pour multi-instance)

## RBAC — Controle d'acces base sur les roles

| Role | Hierarchie | Permissions |
|------|-----------|-------------|
| ADMIN | 3 | Tout — gestion users, audit, config systeme |
| DOCTOR | 2 | Patients de son service, validation InsulinConfig, propositions |
| NURSE | 1 | Consultation patients, creation InsulinConfig (sans validation) |
| VIEWER | 0 | Lecture seule sur son propre perimetre |

### Controle d'acces patient

```typescript
canAccessPatient(userId, role, patientId):
  ADMIN   → acces a tous les patients non supprimes
  VIEWER  → acces a son propre dossier uniquement
  DOCTOR/NURSE → acces via PatientService (lien service de sante)

resolvePatientId(userId, role, patientIdParam?):
  VIEWER  → retourne son propre patientId
  Pro     → verifie canAccessPatient sur patientIdParam
```
