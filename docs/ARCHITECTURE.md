# Architecture technique — Diabeo Backoffice

Documentation de l'architecture réelle du backoffice Diabeo après Phase 0.

---

## 1. Stack technique

### Versions réelles (package.json)

| Couche | Technologie | Version | Notes |
|--------|-------------|---------|-------|
| **Framework** | Next.js App Router | 16.2.1 | SSR, Edge Functions |
| **Langage** | TypeScript | 5.x | strict mode |
| **UI Framework** | shadcn/ui + Tailwind CSS | latest | Composants réutilisables |
| **ORM** | Prisma | 7.6.0 | Client JS + migrations |
| **Base de données** | PostgreSQL | 16 | pgcrypto extension |
| **Auth** | NextAuth.js | 5.0.0-beta.30 | JWT + sessions DB (Phase 1) |
| **Chiffrement** | Node.js crypto natif | natif | AES-256-GCM |
| **Validation** | Zod | 4.3.6 | Runtime schema validation |
| **Cache** | Upstash Redis | 1.37.0 | Serverless (POC) |
| **UI Icons** | lucide-react | 1.7.0 | Icons SVG |
| **Testing** | Jest + Playwright | - | (Phase 1+) |

---

## 2. Architecture logicielle

### Diagramme des couches

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Layer (React 19)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Pages UI    │  │  Components  │  │  Hooks       │      │
│  │  (App Router)│  │  (shadcn/ui) │  │  (useState)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTPS
┌─────────────────────────────────────────────────────────────┐
│              API Layer (Next.js API Routes)                 │
│  ┌──────────────────────────────────────────────────────────┤
│  │  GET/POST /api/*/
│  │  ├─ NextAuth v5 context: await auth()
│  │  ├─ Zod validation: schema.safeParse()
│  │  ├─ extractRequestContext(req) → IP, User-Agent
│  │  └─ JSON response
│  └──────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              Service Layer (découplé)                        │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ patient.service│  │ insulin.service│  │audit.service │  │
│  │ - create       │  │ - getSettings  │  │ - log        │  │
│  │ - getById      │  │ - calculateBol │  │ - query      │  │
│  │ - listByDoctor │  │ - validate     │  │ - logWithTx  │  │
│  │ - delete       │  │   Settings     │  │              │  │
│  └────────────────┘  └────────────────┘  └──────────────┘  │
│       + Crypto & HMAC (encrypt/decrypt)                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│         Data Access Layer (Prisma 7 Client)                 │
│  ┌──────────────────────────────────────────────────────────┤
│  │  Singleton: prisma (from lib/db/client.ts)
│  │  ├─ prisma.$transaction()  (atomic operations)
│  │  ├─ prisma.<model>.findMany()
│  │  ├─ prisma.<model>.create()
│  │  └─ prisma.<model>.update()
│  └──────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│            Database Layer (PostgreSQL 16)                    │
│  ┌──────────────────────────────────────────────────────────┤
│  │  48 tables × 11 domaines
│  │  ├─ Utilisateurs & Auth (7 tables)
│  │  ├─ Patients & Données médicales (8 tables)
│  │  ├─ Insulinothérapie (8 tables)
│  │  ├─ Glycémie & CGM (5 tables)
│  │  ├─ Événements (3 tables)
│  │  ├─ Ajustements (1 table)
│  │  ├─ Appareils (4 tables)
│  │  ├─ Équipe médicale (4 tables)
│  │  ├─ Documents (3 tables)
│  │  ├─ Notifications (4 tables)
│  │  └─ Configuration UI (3 tables) + Audit (1 table)
│  └──────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Patterns architecturaux implémentés

### 3.1 Singleton Prisma Client

**Fichier** : `src/lib/db/client.ts`

```typescript
import { PrismaClient } from "@prisma/client"

// Singleton pattern — réutilise une seule instance en dev/prod
const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["info"] : [],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
```

**Avantages** :
- Pas de création multiple de connexions PostgreSQL
- Gestion automatique du pool de connexions
- Compatible avec la recherche à chaud Next.js

### 3.2 Service Layer (découplé du framework)

**Pattern** : Logique métier isolée des routes API → Réutilisable en edge functions, cron jobs, etc.

```typescript
// src/lib/services/patient.service.ts
export const patientService = {
  async create(input: CreatePatientInput, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      // Logique métier : chiffrement, création, audit
    })
  },
  async getById(id: number, auditUserId: number) {
    // Logique métier : déchiffrement, audit
  }
}

// src/app/api/patients/route.ts
export async function POST(req: Request) {
  const body = await req.json()
  const input = schema.parse(body)  // Zod validation
  return patientService.create(input, session.user.id)
}
```

**Avantages** :
- Logique testable (pas de dépendances Next.js)
- Réutilisable dans API routes, cron, workers
- Séparation des responsabilités

### 3.3 Transactions Prisma 7

**Pattern** : Atomicité garantie pour bolus calculation + audit logging

```typescript
async calculateBolus(input: BolusInput, auditUserId: number) {
  return prisma.$transaction(async (tx) => {
    // 1. Créer le log de bolus
    const log = await tx.bolusCalculationLog.create({ data: { ... } })

    // 2. Logger l'action dans AuditLog
    await auditService.logWithTx(tx, {
      userId: auditUserId,
      action: "BOLUS_CALCULATED",
      resource: "BOLUS_LOG",
    })

    // Tout est committé ou rien
  })
}
```

**Avantage** : Garantit la consistance — audit et data sont toujours synchronisés.

### 3.4 Chiffrement encrypt/decrypt (AES-256-GCM)

**Fichier** : `src/lib/crypto/health-data.ts`

**Format binaire** : `IV (12 bytes) + TAG (16 bytes) + CIPHERTEXT`

```typescript
// Chiffrement
const plaintext = "Dupont"
const encrypted: Uint8Array = encrypt(plaintext)
const base64 = Buffer.from(encrypted).toString("base64")  // Pour stockage en String columns

// Déchiffrement
const decrypted: string = decrypt(new Uint8Array(Buffer.from(base64, "base64")))
```

**Avantages** :
- Authentification + confidentialité (mode GCM)
- IV aléatoire par chiffrement (pas de pattern)
- Tag détecte la tampering

### 3.5 HMAC-SHA256 pour lookup unique

**Pattern** : Permet l'indexation sans exposer la clé primaire sensible

```typescript
// Création utilisateur
const emailHmac = createHmac("sha256", HMAC_SECRET)
  .update(email)
  .digest("hex")

await prisma.user.create({
  data: {
    email: encryptField(email),      // Chiffré
    emailHmac,                         // Hash — indexé, pas chiffré
    passwordHash,
  }
})

// Lookup par email
const user = await prisma.user.findUnique({
  where: { emailHmac: hmacEmail(email) }  // Pas d'accès à email clair
})
```

**Avantage** : Index UNIQUE sur emailHmac permet les lookups rapides sans leak email.

### 3.6 RBAC (Role-Based Access Control)

**Rôles** : ADMIN, DOCTOR, NURSE, VIEWER

**Implémentation** : Vérification dans les API Routes

```typescript
export async function GET(req: Request) {
  const session = await auth()

  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (session.user.role !== "ADMIN") {
    await auditService.log({
      userId: Number(session.user.id),
      action: "UNAUTHORIZED",
      resource: "SESSION",
    })
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Logique admin
}
```

---

## 4. Flux de données clés

### 4.1 Authentification (NextAuth v5)

```
Utilisateur
    ↓ Email + mot de passe
API /api/auth/signin
    ↓ NextAuth provider (TODO Phase 1)
Database (User lookup par emailHmac)
    ↓ Password hash verification (bcrypt)
Session (JWT token stocké en DB ou JWT)
    ↓ Callback session({ session, token })
Client reçoit { user: { id, role, email } }
```

**État actuel** : Configuration de base NextAuth v5 en place. Providers à implémenter en Phase 1.

### 4.2 Calcul de bolus

```
Patient
    ↓ Glucémie actuelle + glucides estimés
POST /api/insulins/bolus (TODO Phase 2)
    ↓ Zod validation
insulinService.calculateBolus()
    ↓ Prisma $transaction
    ├─ Lookup ISF/ICR pour l'heure actuelle
    ├─ Calcul : meal_bolus + correction_dose
    ├─ Aplicación des bornes cliniques
    ├─ Créer BolusCalculationLog (immuable)
    └─ Logger dans AuditLog
Response
    ↓ { recommendedDose, warnings, ... }
Patient
    ↓ Accepte/refuse la suggestion
```

**Sécurité médecale** : Jamais de bolus auto-injecté — validation explicite du patient.

### 4.3 Audit HDS

```
Toute action sensible
    ↓
auditService.log({
  userId: Number(session.user.id),
  action: "READ|CREATE|UPDATE|DELETE|BOLUS_CALCULATED",
  resource: "PATIENT|CGM_ENTRY|BOLUS_LOG|...",
  resourceId: String(patientId),
  ipAddress,       // Extraction auto de X-Forwarded-For / X-Real-IP
  userAgent,       // User-Agent header
  metadata: { ... }
})
    ↓ INSERT INTO audit_logs (...)
PostgreSQL trigger
    ↓ prevent_audit_log_mutation()
AuditLog immuable
    ↓ Aucun UPDATE/DELETE possible
```

**Conformité** : Retention 10 ans (configurable), indexée sur (userId, createdAt) et (resource, resourceId, createdAt).

---

## 5. Configuration Prisma 7

### Connection Pool

```typescript
// prisma/prisma.config.ts (TODO Phase 1)
const prismaClientSingletonKey = Symbol.for("prisma.client")

const globalForPrisma = globalThis as any
globalForPrisma[prismaClientSingletonKey] ??=
  new PrismaClient({
    errorFormat: "pretty",
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  })
```

### Extensions PostgreSQL

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  extensions = [pgcrypto]  // Pour random UUIDs
}
```

---

## 6. Sécurité de l'architecture

### Defense-in-depth

| Couche | Mécanisme | Implémentation |
|--------|-----------|-----------------|
| **API Routes** | Auth + role check | `await auth()` + RBAC |
| **Validation** | Input sanitization | Zod schemas |
| **Base de données** | Données chiffrées | AES-256-GCM (base64) |
| **Database layer** | Audit trail immuable | PostgreSQL trigger |
| **Error handling** | Pas de stack traces | Try/catch → error 500 |
| **Audit logging** | Traçabilité HDS | auditService.log() |

### Secrets management

Tous les secrets en variables d'environnement :

```bash
HEALTH_DATA_ENCRYPTION_KEY=...   # 32 bytes hex
HMAC_SECRET=...                   # 32+ bytes
AUTH_SECRET=...                   # NextAuth (Phase 1)
DATABASE_URL=...                  # PostgreSQL
```

**JAMAIS** committer de vraies clés → `.env.local` exclu de git.

---

## 7. Évolutivité (roadmap)

### Phase 1 : Authentification complète
- Implémenter NextAuth v5 providers (Credentials, OAuth)
- Sessions en PostgreSQL (ADR #3)
- MFA support
- Reset password flow

### Phase 2 : API Routes patients
- GET /api/patients (list par doctor)
- POST /api/patients (create)
- GET /api/patients/:id
- PUT /api/patients/:id
- DELETE /api/patients/:id (soft delete)

### Phase 3 : Insulin therapy
- GET /api/insulins/:patientId/settings
- POST /api/insulins/:patientId/bolus (avec AdjustmentProposal)
- PUT /api/insulins/:patientId/validate (doctor only)

### Phase 4 : Dashboard & analytics
- GET /api/patients/:patientId/cgm (30j, avec partitioning)
- GET /api/analytics/tir (time-in-range)
- Dashboard configuration (DashboardWidget)

### Phase 5 : Teams & permissions
- Healthcare service management
- Patient-provider relationships
- Document management (OVH Object Storage)

---

## 8. Considérations opérationnelles

### Docker Compose local

```yaml
version: "3.8"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: diabeo
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"
```

### Déploiement OVHcloud

```bash
./deploy.sh update    # Pull + migrate + restart
./deploy.sh backup    # Backup PostgreSQL
./deploy.sh status    # Health check
```

### Monitoring (Phase 1+)

- Application logs → Cloud logs
- Database slow queries → Metrics
- Audit log queries → Analytics
- API response times → APM

---

## 9. Décisions architecturales (ADRs)

| ADR | Décision | Raison |
|-----|----------|--------|
| 1 | Monolithe Next.js | POC 50k patients — complexité microservices inutile |
| 2 | Chiffrement applicatif AES-256-GCM | Protection même si DB compromise |
| 3 | Sessions NextAuth en PostgreSQL | App stateless = scalable |
| 4 | Soft delete RGPD | Conformité + auditabilité |
| 5 | OVH Object Storage dès le POC | Scalabilité fichiers |
| 6 | Prisma 7 sans middleware $use() | Trigger DB plus robuste |
| 7 | BolusCalculationLog + AdjustmentProposal | Suggestion jamais auto-exécutée |
| 8 | Partitioning CGM par trimestre | ~105k rows/patient/an |

---

## 10. Performance targets

| Métrique | Cible |
|----------|-------|
| Page load | < 2s |
| API response (p95) | < 500ms |
| Search (audit logs) | < 1s |
| Database query (p99) | < 100ms |
| Build size | < 2MB (Next.js) |

---

*Dernière mise à jour : 2026-03-31 (Phase 0)*
