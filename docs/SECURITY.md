# Sécurité et conformité HDS/RGPD — Diabeo Backoffice

Documentation complète des mécanismes de sécurité et de conformité implémentés.

---

## 1. Chiffrement AES-256-GCM

### Format binaire

**Algorithme** : AES-256-GCM (Advanced Encryption Standard 256-bit, Galois/Counter Mode)

**Composants du ciphertext** :
```
┌─────────────┬──────────────┬───────────────────┐
│    IV       │     TAG      │    CIPHERTEXT     │
│  12 bytes   │   16 bytes   │   Variable length │
└─────────────┴──────────────┴───────────────────┘
     Random        Auth tag       Encrypted data
```

**Taille totale** : 12 + 16 + plaintext.length

### Implémentation (src/lib/crypto/health-data.ts)

```typescript
const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12         // Nonce length (NIST recommandation)
const TAG_LENGTH = 16        // Authentication tag length
const KEY_LENGTH = 32        // 256-bit key

function getEncryptionKey(): Buffer {
  const key = process.env.HEALTH_DATA_ENCRYPTION_KEY
  if (!key) throw new Error("HEALTH_DATA_ENCRYPTION_KEY is not set")

  const buf = Buffer.from(key, "hex")
  if (buf.length !== KEY_LENGTH) {
    throw new Error(`HEALTH_DATA_ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes)`)
  }
  return buf
}

export function encrypt(plaintext: string): Uint8Array {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)  // IV aléatoire chaque fois
  const cipher = createCipheriv(ALGORITHM, key, iv)

  // Chiffrer le plaintext
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ])

  // Récupérer le tag d'authentification
  const tag = cipher.getAuthTag()

  // Format final : IV + TAG + CIPHERTEXT
  return new Uint8Array(Buffer.concat([iv, tag, encrypted]))
}

export function decrypt(data: Uint8Array): string {
  const key = getEncryptionKey()
  const buf = Buffer.from(data)

  // Vérifier taille minimale
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new HealthDataDecryptionError("Encrypted data is too short")
  }

  // Extraire composants
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH)

  try {
    // Créer déchiffrer avec le tag pour vérifier l'authentification
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)

    return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8")
  } catch (error) {
    throw new HealthDataDecryptionError(
      "Failed to decrypt — data may be corrupted or key mismatch"
    )
  }
}
```

### Storage en base de données

**Problème** : Uint8Array ne peut pas être stockée directement en PostgreSQL String column.

**Solution** : Base64 encoding

```typescript
// Chiffrement
const plaintext = "Dupont"
const encrypted: Uint8Array = encrypt(plaintext)
const base64: string = Buffer.from(encrypted).toString("base64")

// Stockage en DB
await prisma.user.create({
  data: {
    firstname: base64,  // "YWJjZGVmZ2hpams..." (53 caractères pour "Dupont")
    ...
  }
})

// Déchiffrement lors de la lecture
const encrypted = new Uint8Array(Buffer.from(base64, "base64"))
const plaintext = decrypt(encrypted)  // "Dupont"
```

**Pattern helper** (patient.service.ts) :
```typescript
function encryptField(value: string): string {
  return Buffer.from(encrypt(value)).toString("base64")
}

function decryptField(value: string): string {
  return decrypt(new Uint8Array(Buffer.from(value, "base64")))
}
```

### Avantages de GCM

| Propriété | Bénéfice |
|-----------|----------|
| **Confidentialité** | AES-256 → Impossible à déchiffrer sans clé |
| **Authentification** | TAG détecte tampering (modification des données) |
| **IV aléatoire** | Même plaintext → ciphertext différent à chaque fois |
| **Norme NIST** | Approuvé pour données sensibles (HIPAA, GDPR) |

---

## 2. HMAC-SHA256 pour lookups

### Problème

```sql
-- ❌ JAMAIS: Index unique sur email chiffré
SELECT * FROM users WHERE email = 'john@example.com'
-- Impossible : email est chiffré, clé de recherche est le hash chiffré
-- Pas d'index possible sans déchiffrer tous les enregistrements
```

### Solution : HMAC-SHA256

```typescript
import { createHmac } from "crypto"

const HMAC_SECRET = process.env.HMAC_SECRET  // 32+ bytes en hex

function hmacEmail(email: string): string {
  return createHmac("sha256", HMAC_SECRET)
    .update(email)
    .digest("hex")
}

// Création utilisateur
const emailHmac = hmacEmail(email)
await prisma.user.create({
  data: {
    email: encryptField(email),      // Chiffré AES-256-GCM
    emailHmac,                        // Hash HMAC — index UNIQUE
    passwordHash,
  }
})

// Lookup sans déchiffrer
const user = await prisma.user.findUnique({
  where: { emailHmac: hmacEmail("john@example.com") }  // O(1) lookup
})
```

**Sécurité** :
- HMAC est un **one-way hash** — impossible de récupérer email original
- Secret HMAC ≠ clé de chiffrement
- Index UNIQUE sur emailHmac permet les lookups rapides

---

## 3. Audit Trail HDS (Audit Logs)

### Table AuditLog

```typescript
{
  id: BIGINT (PK)
  userId: INT                        // Qui a fait l'action
  action: STRING                     // LOGIN, READ, CREATE, UPDATE, DELETE, etc.
  resource: STRING                   // PATIENT, CGM_ENTRY, BOLUS_LOG, etc.
  resourceId: STRING                 // ID de la ressource
  oldValue: JSON                     // Valeur avant (NULL si CREATE/READ)
  newValue: JSON                     // Valeur après (NULL si DELETE)
  ipAddress: STRING                  // X-Forwarded-For / X-Real-IP
  userAgent: STRING                  // User-Agent header
  metadata: JSON                     // Contexte (filters, counts, etc.)
  createdAt: TIMESTAMPTZ             // AUTO
}
```

**Index** :
- `(userId, createdAt)` — Historique par utilisateur
- `(resource, resourceId, createdAt)` — Historique par ressource

### Immuabilité (DB Trigger)

**Fichier** : `prisma/sql/audit_immutability.sql`

```sql
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable: % operation is forbidden (HDS compliance)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
```

**Effet** : Aucun UPDATE/DELETE possible, même via raw SQL ou console. PostgreSQL lève une exception.

### Logging Pattern

**Service** : `src/lib/services/audit.service.ts`

```typescript
export const auditService = {
  async log(entry: AuditLogEntry) {
    return prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        metadata: entry.metadata ?? {},
      },
    })
  },

  async logWithTx(tx: TransactionClient, entry: AuditLogEntry) {
    // Même log, mais dans une transaction existante (pour atomicité)
    return tx.auditLog.create({
      data: { ... }
    })
  }
}
```

**Extraction IP/User-Agent** :
```typescript
export function extractRequestContext(req: Request): {
  ipAddress: string
  userAgent: string
} {
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  const userAgent = req.headers.get("user-agent") ?? "unknown"
  return { ipAddress, userAgent }
}
```

**Usage dans API routes** :
```typescript
export async function GET(req: NextRequest) {
  const session = await auth()
  const ctx = extractRequestContext(req)

  await auditService.log({
    userId: Number(session.user.id),
    action: "READ",
    resource: "PATIENT",
    resourceId: String(patientId),
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { filters: { ... } }
  })
}
```

### Contenu audit — JAMAIS de données sensibles

```typescript
// ❌ JAMAIS
await auditService.log({
  action: "READ",
  metadata: {
    firstName: "Jean",      // ❌ PII
    email: "jean@mail.com"  // ❌ PII
  }
})

// ✅ TOUJOURS
await auditService.log({
  action: "READ",
  metadata: {
    patientId: 42,          // ✅ ID uniquement
    resultCount: 5,         // ✅ Métrique
  }
})
```

### Retention et archivage

**Conforme HDS** : Retention minimale 10 ans (modifiable en configuration).

```typescript
// Archive strategy (Phase 2+)
async function archiveOldAuditLogs(daysToKeep: number = 3650) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

  // Exporter vers cold storage (ex: OVH Glacier)
  const oldLogs = await prisma.auditLog.findMany({
    where: { createdAt: { lt: cutoffDate } }
  })

  // Archive oldLogs to S3/Glacier
  // Puis supprimer de la DB active (optionnel pour perf)
}
```

---

## 4. RGPD et Soft Delete

### Suppression (Delete Patient)

**Pattern** : Soft delete (marquage) — pas de DELETE physique.

```typescript
// src/lib/services/patient.service.ts
async delete(id: number, auditUserId: number) {
  return prisma.$transaction(async (tx) => {
    // Vérifier non déjà supprimé
    const existing = await tx.patient.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      throw new Error("Patient not found or already deleted")
    }

    // Marquer comme supprimé
    const patient = await tx.patient.update({
      where: { id },
      data: { deletedAt: new Date() }
    })

    // Anonymiser les données utilisateur
    await tx.user.update({
      where: { id: patient.userId },
      data: {
        firstname: "SUPPRIME",
        lastname: "SUPPRIME",
        email: `deleted-${patient.userId}@anonymized.local`,
        emailHmac: `deleted-${patient.userId}`,
        phone: null,
        address1: null,
        address2: null,
        cp: null,
        city: null,
        nirpp: null,
        ins: null,
      }
    })

    // Logger la suppression
    await auditService.logWithTx(tx, {
      userId: auditUserId,
      action: "DELETE",
      resource: "PATIENT",
      resourceId: String(id),
    })

    return { id: patient.id, deletedAt: patient.deletedAt }
  })
}
```

**Queryables** : Les patients supprimés restent en DB :
```typescript
// Lister patients actifs uniquement
await prisma.patient.findMany({
  where: { deletedAt: null }
})

// Lister patients supprimés
await prisma.patient.findMany({
  where: { deletedAt: { not: null } }
})
```

**Avantages** :
- ✅ Récupération possible en cas d'erreur
- ✅ Audit trail complet
- ✅ Conformité RGPD (suppression vérifiable)
- ✅ Pas de pertes de données accidentelles

### Consentement RGPD

**Table** : `UserPrivacySettings`

```typescript
{
  userId: INT (FK, UNIQUE)
  shareWithResearchers: BOOLEAN
  shareWithProviders: BOOLEAN        // Équipe soignante
  analyticsEnabled: BOOLEAN
  gdprConsent: BOOLEAN               // ✅ Consentement explicite
  consentDate: DATETIME              // Horodatage
}
```

**Workflow** :
1. Patient accepte CGU → `hasSignedTerms = true`
2. Patient accepte RGPD → `gdprConsent = true`, `consentDate = NOW()`
3. Audit log : `action: "CREATE", resource: "USER", metadata: { consentType: "GDPR" }`

---

## 5. NextAuth v5 — Authentification

### Configuration (src/lib/auth.ts)

```typescript
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [],  // TODO(Phase 1): Credentials + OAuth

  session: {
    strategy: "jwt",  // TODO(Phase 1): Changer en "database" (ADR #3)
  },

  callbacks: {
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub
      }
      if (token.role) {
        session.user.role = token.role as typeof session.user.role
      }
      return session
    },

    jwt({ token, user }) {
      if (user) {
        token.role = user.role
      }
      return token
    },
  },
})
```

### Module Augmentation (src/types/next-auth.d.ts)

```typescript
declare module "next-auth" {
  interface User {
    id: string
    role: Role
  }

  interface Session {
    user: {
      id: string
      role: Role
    } & DefaultSession["user"]
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    role?: Role
    sub: string
  }
}
```

### Vérification authentification dans API routes

```typescript
export async function GET(req: NextRequest) {
  // ✅ Vérifier authentification
  const session = await auth()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ✅ Vérifier autorisation (RBAC)
  if (session.user.role !== "ADMIN") {
    // ❌ Log tentative non-autorisée
    await auditService.log({
      userId: Number(session.user.id),
      action: "UNAUTHORIZED",
      resource: "SESSION",
      resourceId: "audit-logs",
    })
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // ✅ Logique métier
  // ...
}
```

---

## 6. RBAC (Role-Based Access Control)

### Rôles et permissions

| Rôle | Patients | Validation | Audit | Documents | Admin |
|------|----------|-----------|-------|-----------|-------|
| **ADMIN** | Tous | N/A | Oui | Oui | Oui |
| **DOCTOR** | Portfolio | Oui | Oui | Oui | Non |
| **NURSE** | Portfolio | Non | Oui | Oui | Non |
| **VIEWER** | Portfolio | Non | Non | Consultation | Non |

### Vérification rôle

```typescript
// Pattern 1 : Endpoint admin uniquement
if (session.user.role !== "ADMIN") {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

// Pattern 2 : Endpoint doctor + nurse
const allowedRoles = ["DOCTOR", "NURSE"]
if (!allowedRoles.includes(session.user.role)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

// Pattern 3 : Doctor uniquement (pour validation)
if (session.user.role !== "DOCTOR") {
  return NextResponse.json(
    { error: "Only doctors can validate insulin settings" },
    { status: 403 }
  )
}
```

### Data access control

```typescript
// NURSE/DOCTOR : accès seulement aux patients de leur portfolio
async listByDoctor(doctorUserId: number) {
  return prisma.patientReferent.findMany({
    where: {
      pro: { userId: doctorUserId }  // Vérifie la relation
    },
    include: {
      patient: { ... }
    }
  })
}

// Utilisation dans API route
const patients = await patientService.listByDoctor(Number(session.user.id))
```

---

## 7. Validation des inputs avec Zod

### Problème

```typescript
// ❌ Danger : injection SQL, type confusion, etc.
const userId = req.query.userId
const glycemiaValue = req.body.glucoseValue
```

### Solution : Zod schema

```typescript
import { z } from "zod"

const querySchema = z.object({
  userId: z.coerce.number().int().positive(),
  resource: z.enum(["USER", "PATIENT", "CGM_ENTRY"]),
  action: z.enum(["READ", "CREATE", "UPDATE", "DELETE"]),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

// Validation runtime
const parsed = querySchema.safeParse({
  userId: "42",         // Coerced to number
  resource: "PATIENT",  // Validé contre enum
  from: "2026-03-01",   // Coerced to Date
})

if (!parsed.success) {
  return NextResponse.json(
    {
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors
      // {
      //   "userId": ["Expected integer"],
      //   "resource": ["Invalid enum value"]
      // }
    },
    { status: 400 }
  )
}

// parsed.data est typé et sûr
const filters = parsed.data
```

---

## 8. Error Handling & Logging

### Problème

```typescript
// ❌ JAMAIS : expose stack trace
catch (error) {
  console.error(error)  // Log interne OK
  return NextResponse.json(
    { error: error.message, stack: error.stack },
    { status: 500 }
  )
}
```

### Solution

```typescript
// ✅ TOUJOURS : message générique en production
catch (error) {
  console.error("[audit-logs GET]", error)  // Log interne pour debug

  // Audit log de l'erreur
  await auditService.log({
    userId: Number(session?.user.id ?? 0),
    action: "ERROR",
    resource: "SESSION",
    metadata: {
      errorType: error instanceof Error ? error.constructor.name : "Unknown",
      message: error instanceof Error ? error.message : "Internal server error"
    }
  })

  return NextResponse.json(
    { error: "Internal server error" },  // ✅ Générique
    { status: 500 }
  )
}
```

---

## 9. Scripts SQL de sécurité

### audit_immutability.sql

**Applique** : Trigger DB pour immuabilité AuditLog

```bash
psql $DATABASE_URL < prisma/sql/audit_immutability.sql
```

**Effet** :
```sql
-- ❌ Toujours rejeté
UPDATE audit_logs SET action = 'DELETED' WHERE id = 1
-- ERROR: audit_logs is immutable: UPDATE operation is forbidden
```

### cgm_partitioning.sql

**Applique** : Partitioning table CGM par trimestre

```bash
psql $DATABASE_URL < prisma/sql/cgm_partitioning.sql
```

**Bénéfices** :
- Maintenance rapide (drop partition = purge 3 mois)
- Index plus petits et rapides
- Queries time-bound optimisées

### basal_config_check.sql

**Applique** : Constraint basal configuration type/fields

```bash
psql $DATABASE_URL < prisma/sql/basal_config_check.sql
```

**Effet** :
```sql
-- ❌ Rejeté : pump avec dailyDose (incompatible)
INSERT INTO basal_configurations VALUES (1, ..., 'pump', NULL, 22.0, ...)
-- ERROR: new row violates check constraint "chk_basal_config_type_fields"
```

---

## 10. Variables d'environnement sensibles

### Configuration requise

```bash
# Chiffrement
HEALTH_DATA_ENCRYPTION_KEY=...   # 64 hex chars (32 bytes)
HMAC_SECRET=...                   # 32+ bytes

# NextAuth (Phase 1)
AUTH_SECRET=...                   # Clé session JWT (min 32 chars)
AUTH_URL=...                      # URL backoffice (ex: https://app.diabeo.fr)

# Base de données
DATABASE_URL=postgresql://user:pass@host:5432/diabeo

# OVH Object Storage (Phase 2)
OVH_S3_ENDPOINT=...
OVH_S3_ACCESS_KEY=...
OVH_S3_SECRET_KEY=...
OVH_S3_BUCKET=...

# Redis Upstash (optionnel)
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

### Gestion en production

**JAMAIS** en `.env` committé. Utiliser :
- `.env.local` (gitignored)
- Secret manager (OVH AppEngine, Vault, etc.)
- Variables d'environnement système

---

## 11. Conformité HDS

### Checklist de conformité

| Critère | Implémenté | Notes |
|---------|-----------|-------|
| Authentification | ✅ NextAuth v5 | MFA Phase 1 |
| Chiffrement données | ✅ AES-256-GCM | Avant insertion DB |
| Audit immutable | ✅ Trigger DB | Aucun UPDATE/DELETE |
| RBAC | ✅ Role-based | 4 rôles + vérification |
| Soft delete | ✅ RGPD | Anonymisation |
| Consentement | ✅ Privacy settings | GDPR consent tracking |
| Lookups sécurisés | ✅ HMAC emailHmac | Pas de clés chiffrement exposées |
| Error handling | ✅ Messages génériques | Pas de stack traces |
| Logging sensible | ✅ Pas de PII | Métadonnées uniquement |

### Audits externes

**À planifier** : Audit HDS indépendant Phase 3.

---

## 12. Décisions de sécurité (ADRs)

| ADR | Décision | Raison |
|-----|----------|--------|
| 2 | AES-256-GCM applicatif | Protection même si DB compromise |
| 3 | Sessions NextAuth DB (Phase 1) | App stateless = scalable |
| 4 | Soft delete RGPD | Auditabilité + conformité |
| 6 | emailHmac HMAC-SHA256 | Lookups sans exposer email |
| 9 | Trigger DB pour audit | Plus robuste qu'ORM middleware |

---

## 13. Roadmap sécurité

### Phase 1
- [ ] Credentials provider + OAuth
- [ ] MFA (TOTP) support
- [ ] Sessions DB strategy
- [ ] Password reset flow
- [ ] Email verification

### Phase 2
- [ ] API rate limiting (Redis)
- [ ] Document encryption (S3)
- [ ] TLS mutual (certificate pinning)
- [ ] WAF rules (OVH)

### Phase 3
- [ ] Audit HDS externe
- [ ] Penetration testing
- [ ] SOC 2 certification
- [ ] Zero-trust networking

---

Dernière mise à jour : 2026-03-31 (Phase 0)
