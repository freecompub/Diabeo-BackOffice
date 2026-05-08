# CLAUDE.md — Diabeo Backoffice

Fichier de contexte persistant pour Claude Code.
Mis à jour à chaque décision architecturale majeure.

---
@.claude/TEAM.md
@.claude/Documentation.md
---
## 🏥 Projet

**Diabeo** est une application de gestion de l'insulinothérapie pour les patients diabétiques.
Ce dépôt contient le **backoffice web** (Next.js) destiné aux médecins, infirmières et administrateurs.

L'application iOS Diabeo (Swift) est dans un dépôt séparé. Les modèles de données doivent rester
alignés entre les deux dépôts.

---

## 🏗️ Stack technique

| Couche         | Technologie                        | Version  |
|----------------|------------------------------------|----------|
| Framework      | Next.js (App Router)               | 16.x     |
| Langage        | TypeScript                         | strict   |
| UI             | shadcn/ui + Tailwind CSS           | latest   |
| ORM            | Prisma                             | 5.x      |
| Base de données| PostgreSQL                         | 16       |
| Auth           | JWT RS256 custom (jose + bcryptjs) | —        |
| Chiffrement    | AES-256-GCM (Node.js crypto natif) | —        |
| Cache          | Upstash Redis                      | POC      |
| Fichiers       | OVH Object Storage (S3-compatible) | —        |
| Infra          | Docker Compose + OVHcloud GRA      | —        |

---

## 📁 Structure du projet

```
diabeo-backoffice/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── (auth)/                 # Layout auth (pages — login, reset, MFA)
│   │   │   ├── login/
│   │   │   │   └── page.tsx        # LoginForm (email/password, rate-limit visual)
│   │   │   └── layout.tsx          # Centré, pas de sidebar
│   │   ├── (dashboard)/            # Layout protégé (sidebar + main content)
│   │   │   ├── page.tsx            # Dashboard principal (KPI, alertes, TIR)
│   │   │   ├── patients/
│   │   │   │   ├── page.tsx        # Patient list (search, filter pathology)
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx    # Patient detail (4 tabs: overview, glycemia, traitements, docs)
│   │   │   ├── users/              # Module utilisateurs (Phase 3+)
│   │   │   ├── audit/              # Module audit HDS (Phase 3+)
│   │   │   └── layout.tsx          # Sidebar + DashboardHeader
│   │   └── api/                    # API Routes Next.js
│   │       ├── auth/               # Auth routes (JWT RS256)
│   │       │   ├── login/          # POST — connexion
│   │       │   ├── logout/         # POST — déconnexion
│   │       │   ├── refresh/        # POST — renouvellement JWT
│   │       │   └── reset-password/ # POST — reset MDP
│   │       ├── account/            # Gestion compte utilisateur
│   │       │   ├── route.ts        # GET/PUT/DELETE profil
│   │       │   ├── photo/          # PUT — upload avatar S3 (jpeg/png/webp, 5MB, ClamAV)
│   │       │   ├── terms/          # PUT — acceptation CGU
│   │       │   ├── data-policy/    # PUT — politique données
│   │       │   ├── day-moments/    # GET/PUT — périodes journalières
│   │       │   ├── units/          # GET/PUT — préférences unités
│   │       │   ├── privacy/        # GET/PUT — confidentialité RGPD
│   │       │   ├── notifications/  # GET/PUT — préférences notifs
│   │       │   └── export/         # GET — export RGPD
│   │       ├── units/              # GET — référentiel unités
│   │       ├── documents/           # Documents médicaux
│   │       │   ├── route.ts        # GET/POST — liste & création metadata
│   │       │   ├── upload/         # POST — multipart upload S3 (NURSE+, ClamAV, 50MB)
│   │       │   └── [id]/download/  # GET — stream fichier S3 (RBAC + audit)
│   │       ├── push/                # Notifications push
│   │       │   ├── register/       # GET/POST/DELETE — device registration
│   │       │   ├── send/           # POST — envoi FCM (NURSE+, RBAC target, rate limit)
│   │       │   ├── templates/      # GET — templates notification
│   │       │   └── scheduled/      # GET/POST — notifications programmées
│   │       ├── admin/              # Admin-only endpoints (audit-logs)
│   │       └── patients/           # CRUD patients (Phase 2)
│   ├── lib/
│   │   ├── db/
│   │   │   └── client.ts           # Singleton Prisma (Prisma 7+)
│   │   ├── crypto/
│   │   │   ├── health-data.ts      # Chiffrement AES-256-GCM (IV+TAG+CIPHERTEXT)
│   │   │   └── hmac.ts             # HMAC-SHA256 pour email lookup
│   │   ├── auth/                   # Authentification JWT RS256
│   │   │   ├── index.ts            # Exports: getAuthUser, requireAuth, requireRole
│   │   │   ├── jwt.ts              # Sign/verify JWT RS256 (jose)
│   │   │   ├── rbac.ts             # Hiérarchie rôles ADMIN>DOCTOR>NURSE>VIEWER
│   │   │   ├── rate-limit.ts       # Backoff exponentiel login (in-memory)
│   │   │   └── session.ts          # CRUD sessions en base
│   │   ├── storage/
│   │   │   └── s3.ts               # Client S3 OVH/MinIO (upload/download/delete, SSE-S3)
│   │   ├── firebase/
│   │   │   └── admin.ts            # Singleton Firebase Admin SDK (FCM)
│   │   ├── conversions.ts          # Helpers conversion glucose g/L↔mg/dL↔mmol/L
│   │   ├── gdpr.ts                 # Vérification consentement RGPD
│   │   └── services/               # Logique métier (découplée du framework)
│   │       ├── patient.service.ts  # CRUD patients + encrypt/decrypt base64
│   │       ├── insulin.service.ts  # Bolus calc (transaction), ISF/ICR par slot horaire
│   │       ├── audit.service.ts    # AuditLog + IP/UA tracking + query filters
│   │       ├── user.service.ts     # Profil utilisateur + chiffrement champs
│   │       ├── export.service.ts   # Export RGPD complet (Art. 20)
│   │       ├── deletion.service.ts # Suppression cascade RGPD (Art. 17)
│   │       ├── document.service.ts # Upload/download S3 + antivirus + audit
│   │       ├── antivirus.service.ts # ClamAV scan (scanFile + scanBuffer helper)
│   │       ├── fcm.service.ts     # Envoi FCM (sendToUser, sendFromTemplate, batch)
│   │       ├── push.service.ts    # Registration devices, templates, scheduled
│   │       ├── email.service.ts   # Email transactionnel (Resend: reset pwd, welcome, proposals)
│   │       └── retention.service.ts # Rétention 6 ans audit logs (SQL SECURITY DEFINER)
│   ├── types/
│   │   └── next-auth.d.ts          # Module augmentation NextAuth (User.role, JWT.role)
│   ├── hooks/                      # Hooks React (Phase 8)
│   │   └── useAuth.ts              # useAuth() — login/logout via httpOnly cookie
│   └── components/                 # Composants React réutilisables
│       ├── ui/                     # shadcn/ui (NE PAS MODIFIER)
│       └── diabeo/                 # Composants métier Diabeo (Phase 8)
│           ├── Sidebar.tsx         # Navigation sidebar (5 items + logout)
│           ├── DashboardHeader.tsx # Page title + notifications + settings
│           └── CgmChart.tsx        # Graphique CGM (recharts, target range, sr-only data)
├── prisma/
│   ├── schema.prisma               # 48 tables × 11 domaines, 21 enums
│   ├── migrations/                 # Migrations versionnées
│   ├── prisma.config.ts            # Config Prisma 7 (connection URL, extensions)
│   ├── seed.ts                     # 5 users, 2 patients (DT1/DT2), 30j données CGM
│   └── sql/                        # Scripts SQL de référence
│       ├── cgm_partitioning.sql    # Partitioning table CGM par mois
│       ├── audit_immutability.sql  # DB trigger — immuabilité AuditLog
│       └── basal_config_check.sql  # Check constraint — validations basales
├── docker-compose.yml
├── .env.example
└── CLAUDE.md                       # CE FICHIER
```

---

## 🎨 Design system

### Palette de couleurs — "Sérénité Active"

```
Primaire (teal)    : #0D9488  → Actions principales, liens, titres
Secondaire (corail): #F97316  → Alertes, actions secondaires
Fond principal     : #FAFAFA
Fond secondaire    : #F3F4F6
Texte principal    : #1F2937
Texte secondaire   : #6B7280

Glycémie normale   : #10B981  (vert émeraude)
Glycémie haute     : #F59E0B  (orange ambre)
Glycémie critique  : #EF4444  (rouge)
```

### Composants UI

- Toujours utiliser **shadcn/ui** comme base (jamais réinventer des composants de base)
- Les composants métier Diabeo sont dans `components/diabeo/`
- Accessibilité obligatoire : ARIA labels sur tous les éléments interactifs
- Responsive : mobile-first, mais le backoffice est principalement desktop

---

## 🔐 Règles de sécurité — NON NÉGOCIABLES

### Chiffrement des données de santé (AES-256-GCM)

```typescript
// ✅ TOUJOURS chiffrer avant insertion en base
import { encrypt, decrypt } from "@/lib/crypto/health-data"

// Chiffrement — retourne Uint8Array avec format : IV (12 bytes) + TAG (16 bytes) + CIPHERTEXT
const plaintext = "Dupont"
const encrypted = encrypt(plaintext)  // Uint8Array

// Conversion en base64 pour stockage en String columns (ex: User.firstname)
const encryptField = (value: string): string =>
  Buffer.from(encrypt(value)).toString("base64")

// Déchiffrement — accepte base64 et reconvertit en Uint8Array
const decryptField = (value: string): string =>
  decrypt(new Uint8Array(Buffer.from(value, "base64")))

// JAMAIS logger plaintext après encrypt — vérifier le format Uint8Array

// ❌ JAMAIS : Buffer.from(encrypt(value)).toString("utf8") — corrompt les données
// ✅ TOUJOURS : Buffer.from(encrypt(value)).toString("base64") — safe pour String columns
```

### Audit & Traçabilité HDS

```typescript
// ✅ TOUJOURS auditer chaque accès (READ, CREATE, UPDATE) à une donnée de santé
await auditService.log({
  userId,
  action: "READ",
  resource: "PATIENT",
  resourceId: String(patientId),
  ipAddress,  // Extraction auto via extractRequestContext(req)
  userAgent,
  metadata: { ... }
})

// ❌ JAMAIS logger les valeurs décryptées dans audit_logs
// ❌ JAMAIS stocker plaintext de santé en clair
// ❌ JAMAIS exposer le Buffer/base64 chiffré dans les API responses
```

### Soft delete patients (RGPD)

```typescript
// Soft delete UNIQUEMENT — jamais de DELETE physique sur les patients
// PostgreSQL trigger (audit_immutability.sql) anonymise les données chiffrées
// Voir patient.service.ts → deletePatient()

// Pattern : UPDATE patient SET deletedAt = NOW() WHERE id = ?
// Le patient reste queryable avec WHERE deletedAt IS NULL
```

### Validation médicale (Insulin Therapy)

```typescript
// InsulinTherapySettings et configurations associées (GlucoseTarget, ISF, ICR, BasalConfiguration)
// Bornes cliniques appliquées — voir insulin.service.ts CLINICAL_BOUNDS

// Avant ajout à production : validatedBy = DOCTOR.id
// Bolus suggestions : JAMAIS injectées sans acceptation explicite du patient
// Pattern : BolusCalculationLog → AdjustmentProposal (status=pending) → review DOCTOR → accept/reject
```

### API Routes (JWT RS256 + RBAC)

```typescript
// ✅ Toute route doit vérifier auth + rôle via helpers
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  try {
    // Le middleware JWT injecte x-user-id et x-user-role dans les headers
    const user = requireRole(req, "ADMIN") // throws AuthError si non autorisé

    // user.id et user.role sont disponibles
    // ...
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Helpers disponibles :
// getAuthUser(req)    → AuthUser | null  (lecture sans throw)
// requireAuth(req)    → AuthUser         (throw 401)
// requireRole(req, R) → AuthUser         (throw 401 ou 403)
```

### Validation des inputs avec Zod

```typescript
// TOUJOURS valider avant d'appeler un service
import { z } from "zod"
import { NextResponse } from "next/server"

const schema = z.object({
  patientId: z.number().int().positive(),
  glucoseValue: z.number().min(40).max(600),
  timestamp: z.coerce.date(),
})

export async function POST(req: Request) {
  const body = await req.json()
  const result = schema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  // result.data est typé et sûr
}
```

### HMAC pour lookup unique (emailHmac)

```typescript
// ❌ JAMAIS : SELECT * FROM users WHERE email = ?  (email chiffré = lookup impossible)
// ✅ TOUJOURS : SELECT * FROM users WHERE emailHmac = HMAC-SHA256(email, secret)

import { createHmac } from "crypto"

function hmacEmail(email: string): string {
  const key = process.env.HMAC_SECRET  // 32+ bytes, stable en production
  return createHmac("sha256", key).update(email).digest("hex")
}

// Index UNIQUE sur emailHmac permet lookups rapides sans sacrifier la confidentialité
```

---

## 👥 Rôles utilisateurs (RBAC)

| Rôle    | Permissions |
|---------|-------------|
| ADMIN   | Tout — gestion users, audit, config système |
| DOCTOR  | Patients de son portefeuille, validation InsulinConfig |
| NURSE   | Consultation patients, création InsulinConfig (sans validation) |
| VIEWER  | Lecture seule sur son périmètre autorisé |

---

## 🗄️ Architecture des données — 48 tables × 11 domaines

### Domaine 1 : Utilisateur & Authentification (7 tables)
**User, Account, Session, VerificationToken, UserUnitPreferences, UserNotifPreferences, UserPrivacySettings**

- **User** : `emailHmac` (HMAC-SHA256) remplace l'index unique sur `email` chiffré
  - Champs sensibles chiffrés en production : `email`, `firstname`, `lastname`, `phone`, `address*`, `cp`, `city`, `nirpp`, `ins`
  - `mfaSecret`, `mfaEnabled`, `hasSignedTerms`, `profileComplete`
  - `role` ∈ {ADMIN, DOCTOR, NURSE, VIEWER}

- **Account, Session, VerificationToken** : Standard NextAuth v5

### Domaine 2 : Patient & Données Médicales (8 tables)
**Patient, PatientMedicalData, PatientAdministrative, PatientPregnancy, GlycemiaObjective, CgmObjective, AnnexObjective, Treatment**

- **Patient** :
  - `pathology` ∈ {DT1, DT2, GD} (Diabète Type 1, Type 2, Gestationnel)
  - `userId` (1:1) — lien vers User
  - Soft delete via PostgreSQL trigger si `deletedAt` set

- **PatientMedicalData** : antécédents, comorbidités, allergies (chiffrées)

- **Treatment** : déclaration multi-traitements (FGM, pompe, GLP-1, etc.)

### Domaine 3 : Configuration Insulinothérapie (8 tables)
**InsulinTherapySettings, GlucoseTarget, IobSettings, ExtendedBolusSettings, InsulinSensitivityFactor, CarbRatio, BasalConfiguration, PumpBasalSlot**

- **InsulinTherapySettings** : config racine par patient
- **InsulinSensitivityFactor (ISF)** : facteur de sensibilité insuline par slot horaire
  - `startHour` ∈ [0–23], `sensitivityFactorGl` (g/L/U), `sensitivityFactorMgdl` (mg/dL/U)
  - `insulinActionMin/Max` (Insulin On Board duration)

- **CarbRatio (ICR)** : ratio insuline-glucides par slot horaire
  - `startHour` ∈ [0–23], `gramsPerUnit` (g/U)

- **BasalConfiguration** : profil basal (type pompe, injections simples ou fractionnées)
- **PumpBasalSlot** : slot basal par Time (heure du jour, pas timestamp)
  - Validation DB : `pump_basal_slot_check.sql`

- **GlucoseTarget** : cibles glycémiques horaires (preset ou custom)
  - `targetGlucose`, `targetMin`, `targetMax`, `isActive`

### Domaine 4 : Données de Glycémie & CGM (5 tables)
**CgmEntry, GlycemiaEntry, AverageData, CgmObjective, BolusCalculationLog**

- **CgmEntry** : entrées capteur continu (CGM)
  - `glucoseValue` (mg/dL), `timestamp`, `source` (FreeStyle, Dexcom, etc.)
  - Table partitionnée par mois — voir `cgm_partitioning.sql`

- **GlycemiaEntry** : mesures ponctuelles
  - `glucoseValue`, `measurementType` (capillaire, etc.)

- **BolusCalculationLog** : journal des bolus calculés (JAMAIS injecté sans validation)
  - `mealBolus`, `correctionDose`, `recommendedDose`, `deliveryMethod`
  - Immuable après création

### Domaine 5 : Événements & Activités (3 tables)
**DiabetesEvent, InsulinFlowEntry, PumpEvent**

- **DiabetesEvent** : événements saisis par le patient
  - `eventType` ∈ {glycemia, insulinMeal, physicalActivity, context, occasional}
  - IMPORTANT : `eventType` est un ARRAY d'énums (Prisma 5+)

- **InsulinFlowEntry, PumpEvent** : données d'administration insuline

### Domaine 6 : Propositions d'Ajustement (1 table)
**AdjustmentProposal**

- Suggestions d'ajustement automatique (basales, ISF, ICR)
- `parameter` ∈ {basalRate, insulinSensitivityFactor, insulinToCarbRatio}
- `reason` ∈ {basalTooLow, basalTooHigh, isfTooLow, ...}
- `status` ∈ {pending, accepted, rejected, expired}
- `reviewedBy` : User.id (DOCTOR uniquement)

### Domaine 7 : Appareils & Synchronisation (4 tables)
**PatientDevice, DeviceDataSync, InsulinFlowDeviceData**

- **PatientDevice** : appareils associés au patient (pompe, CGM, glucomètre)
- **DeviceDataSync** : historique des syncs (source, dernière sync, erreurs)

### Domaine 8 : Équipe Médicale (4 tables)
**HealthcareService, HealthcareMember, PatientService, PatientReferent**

- **HealthcareService** : structure de santé (CHU, cabinet privé, etc.)
- **HealthcareMember** : membre de l'équipe (lien User → Service)
- **PatientService** : adhésion patient à une structure
- **PatientReferent** : médecin référent (1:N par patient)

### Domaine 9 : Documents & Rendez-vous (3 tables)
**MedicalDocument, Appointment, Announcement**

- **MedicalDocument** : ordonnances, résultats labo, attestations
  - `category` ∈ {general, forDoctor, personal, prescription, labResults, other}
  - Fichiers sur OVH Object Storage (jamais disque local)

- **Appointment** : consultations planifiées
- **Announcement** : communications auprès des patients

### Domaine 10 : Notifications Push (4 tables)
**PushDeviceRegistration, PushNotificationTemplate, PushNotificationLog, PushScheduledNotification**

- **PushDeviceRegistration** : FCM tokens (iOS, Android, web)
- **PushNotificationTemplate** : modèles avec variables
- **PushNotificationLog** : trace de chaque notification envoyée
- **PushScheduledNotification** : notifications programmées (cron)

### Domaine 11 : Configuration & UI (3 tables)
**DashboardConfiguration, DashboardWidget, UnitDefinition, UserDayMoment, UiStateSave**

- **UnitDefinition** : unités de mesure (mg/dL vs g/L, etc.)
- **UserDayMoment** : moments du jour personnalisés (petit-déj, déj, goûter, etc.)
- **DashboardConfiguration** : layout personnel du dashboard

### AuditLog (1 table — spéciale)
- Immuable par trigger PostgreSQL (voir `audit_immutability.sql`)
- Contient : `action`, `resource`, `resourceId`, `oldValue`, `newValue`, `ipAddress`, `userAgent`, `metadata`
- Ne contient JAMAIS de données de santé en clair
- Indexés sur `(userId, createdAt)`, `(resource, resourceId, createdAt)`

---

## 💊 Logique métier Diabeo

### Calcul de bolus (insulin.service.ts)

```typescript
/**
 * Bolus = suggestion JAMAIS automatique
 * Format : BolusCalculationLog (immuable) → AdjustmentProposal (status=pending)
 * Patient accepte explicitement avant injection
 */

// CLINICAL_BOUNDS (bornes de sécurité) :
const CLINICAL_BOUNDS = {
  ISF_GL_MIN: 0.20,    ISF_GL_MAX: 1.00,    // g/L/U
  ISF_MGDL_MIN: 20,    ISF_MGDL_MAX: 100,  // mg/dL/U
  ICR_MIN: 5.0,        ICR_MAX: 20.0,       // g/U
  BASAL_MIN: 0.05,     BASAL_MAX: 10.0,    // U/h
  TARGET_MIN_MGDL: 60, TARGET_MAX_MGDL: 250,
  MAX_SINGLE_BOLUS: 25.0,  // U — jamais dépasser
}

// Formule : findSlotForHour(settings.sensitivityFactors, hour)
// Les slots ISF/ICR sont triés par startHour ascendant
// Sélection : premier slot où startHour <= heure actuelle
// Fallback : dernier slot du tableau

// Calcul final :
// Bolus repas     = carbsGrams / icr.gramsPerUnit
// Correction      = max(0, (currentMgdl - targetMgdl) / isf.sensitivityFactorMgdl)
// IOB ajustment   = appliquer insulinActionDuration + insulinActionPeakTime
// Total recommandé = mealBolus + correctionDose - iobAdjustment
// Cappage = min(recommendedDose, CLINICAL_BOUNDS.MAX_SINGLE_BOLUS)
```

### Transaction Prisma 7 (insulin.service.ts)

```typescript
// Prisma 7 supprime $use() middleware — audit immutabilité via DB trigger
// Bolus calculation + log tout dans une transaction

async calculateBolus(input: BolusInput, auditUserId: number): Promise<BolusResult> {
  return prisma.$transaction(async (tx) => {
    const log = await tx.bolusCalculationLog.create({ data: { ... } })
    await auditService.logWithTx(tx, { action: "BOLUS_CALCULATED", ... })
    return { ...log, warnings: [...] }
  })
}
```

### Sélection du ratio horaire (time-of-day slots)

```typescript
// InsulinSensitivityFactor, CarbRatio, PumpBasalSlot utilisent Time (pas Timestamp)
// Time = "HH:MM:SS" pour heure du jour — stockage léger, pas timezone

const findSlotForHour = (
  slots: { startHour: number; value: number }[],
  hour: number
): { value: number } | null => {
  // Slots triés par startHour DESC (24h → 0h)
  // On prend le premier slot où startHour <= hour
  const slot = slots
    .sort((a, b) => b.startHour - a.startHour)
    .find(s => s.startHour <= hour)
  return slot ?? slots[slots.length - 1]  // Fallback : 00:00
}
```

### Services avec transactions Prisma 7

```typescript
// patient.service.ts  : create, getById, listByDoctor, deletePatient
// insulin.service.ts  : getSettings, calculateBolus
// audit.service.ts    : log, logWithTx, query
// user.service.ts     : getProfile, updateProfile, acceptTerms, acceptDataPolicy, dayMoments
// export.service.ts   : generateUserExport (RGPD Art. 20)
// deletion.service.ts : deleteUserAccount (RGPD Art. 17, cascade 48 tables)

// Chaque service découplé de Next.js — réutilisable dans API routes ou edge functions
// Types Prisma importés depuis @prisma/client
```

---

## 🛠️ Commandes utiles

```bash
# Développement local
pnpm dev                               # Next.js sur localhost:3000
docker compose --profile local up      # PostgreSQL 16 local uniquement

# Prisma 7+ (générateur client, extensions PostgreSQL)
pnpm prisma migrate dev --name name    # Créer et appliquer migration localement
pnpm prisma migrate deploy             # Appliquer migrations en prod
pnpm prisma studio                     # Interface graphique BDD (localhost:5555)
pnpm prisma db seed                    # Injecter données de test (5 users, 2 patients, 30j CGM)
pnpm prisma generate                   # Régénérer client @prisma/client (auto avec migrate)

# Chiffrement & Auth — configuration requise
export HEALTH_DATA_ENCRYPTION_KEY="..."  # 32 bytes en hex (64 caractères)
export HMAC_SECRET="..."                 # 32+ bytes pour emailHmac
export JWT_PRIVATE_KEY="..."             # RSA privée PEM (RS256)
export JWT_PUBLIC_KEY="..."              # RSA publique PEM (RS256)

# Tests
pnpm test                              # Jest sur src/lib/services
pnpm test:e2e                          # Playwright sur pages et API routes

# Audit SQL (référence — à appliquer manuellement après migration)
# psql $DATABASE_URL < prisma/sql/audit_immutability.sql
# psql $DATABASE_URL < prisma/sql/cgm_partitioning.sql
# psql $DATABASE_URL < prisma/sql/basal_config_check.sql
# psql $DATABASE_URL < prisma/sql/patient_insulin_constraints.sql

# Déploiement OVHcloud
./deploy.sh update                     # Pull + migrate + restart services
./deploy.sh status                     # Statut PostgreSQL, Redis, API
./deploy.sh backup                     # Backup manuel PostgreSQL
```

---

## 🚫 Ce que Claude Code ne doit JAMAIS faire

- Modifier les fichiers dans `components/ui/` (shadcn/ui auto-généré)
- Créer des DELETE physiques sur la table `patients`
- Stocker quoi que ce soit dans `localStorage` ou les cookies non-httpOnly
- Uploader des fichiers sur le disque du VPS (toujours OVH Object Storage)
- Commiter des secrets, clés ou mots de passe
- Créer des migrations destructives (DROP COLUMN, DROP TABLE) sans confirmation explicite
- Désactiver les middlewares d'authentification pour "tester plus vite"
- Exposer des stack traces ou messages d'erreur internes dans les API responses
- Merger une pull request sans le consentement explicite de l'utilisateur
- Merger une pull request si la CI (pipeline) a des erreurs
- supprimer une feature sans le consentement explicite de l'utilisateur
- on ne developpe pas les applications android et ios

---

## ✅ Checklist avant chaque PR

- [ ] Authentification + autorisation par rôle sur toutes les nouvelles API Routes
- [ ] Données patients chiffrées avant insertion, déchiffrées uniquement à la lecture
- [ ] `auditService.log()` appelé pour chaque accès à une donnée de santé
- [ ] Validation Zod sur tous les inputs des API Routes
- [ ] Pas de `console.log` avec des données patients
- [ ] Tests unitaires pour la logique métier ajoutée (couverture ≥ 80%)
- [ ] Types TypeScript stricts (pas de `any`)
- [ ] Composants accessibles (ARIA labels)

---

## 📋 Décisions architecturales (ADR)

| # | Décision | Raison |
|---|----------|--------|
| 1 | Monolithe Next.js (pas microservices) | POC 50k patients — complexité inutile |
| 2 | Chiffrement applicatif AES-256-GCM | Données sensibles protégées même si la BDD est compromise |
| 3 | JWT RS256 + Sessions en PostgreSQL | Auth stateless avec invalidation server-side |
| 4 | Soft delete patients | Conformité RGPD + auditabilité |
| 5 | OVH Object Storage dès le POC | Évite de bloquer le scaling futur |
| 6 | Upstash Redis pour le cache | Serverless = zéro config pour le POC |
| 7 | Docker Compose → K8s plus tard | Simplicité opérationnelle du POC |
| 8 | pgcrypto + AES-256-GCM Node natif | Chiffrement at-rest + applicatif en double couche |
| 9 | emailHmac (HMAC-SHA256) pour lookups | Permet index UNIQUE sans exposer email chiffré |
| 10 | Prisma 7 sans middleware $use() | Trigger PostgreSQL pour audit immutabilité (plus robuste) |
| 11 | Time (pas Timestamptz) pour slots | Ratios horaires = heure du jour indépendante de timezone |
| 12 | DiabetesEventType comme Array d'énums | Événement multi-catégorie (ex: "insulinMeal + physicalActivity") |
| 13 | BolusCalculationLog + AdjustmentProposal | Suggestion explicite jamais exécutée sans acceptation patient |
| 14 | 48 tables × 11 domaines | Modèle riche HDS : utilisateurs, patients, insuline, appareils, équipe, audit |
| 15 | Transaction Prisma pour bolus | Calcul + log atomique — consistance garantie |
| 16 | JWT RS256 custom (pas NextAuth) | Compatibilité API iOS existante, contrôle total payload/session |

---

## ✅ Phase 0 implémentée (US-000 + US-001)

### Schéma Prisma complet
- ✅ 48 tables organisées par 11 domaines métier
- ✅ 21 énums (Role, Pathology, DiabetesEventType[], etc.)
- ✅ Relations 1:1, 1:N, M:N
- ✅ Index sur clés critiques (emailHmac unique, createdAt, userId+createdAt)
- ✅ Soft delete RGPD

### Chiffrement & Sécurité
- ✅ AES-256-GCM IV+TAG+CIPHERTEXT pour encrypt/decrypt
- ✅ Base64 encoding pour stockage en String columns
- ✅ HMAC-SHA256 pour lookup unique (emailHmac)
- ✅ NextAuth v5 avec module augmentation (User.role, JWT.role)

### Services métier
- ✅ patient.service.ts : create, getById, listByDoctor, encrypt/decrypt base64
- ✅ insulin.service.ts : getSettings, calculateBolus avec clinical bounds + transaction
- ✅ audit.service.ts : log, logWithTx, query avec IP/UA tracking

### API Routes
- ✅ /api/auth/[...nextauth] : NextAuth v5 endpoints
- ✅ /api/admin/audit-logs : GET avec filtres (userId, resource, action, from, to), Zod validation, admin-only

### Seeds & Tests
- ✅ 5 users (admin, doctor, nurse, 2 patients)
- ✅ 2 patients (DT1, DT2) avec insulin settings complets
- ✅ 30 jours de données CGM déterministes
- ✅ ISF/ICR/basal slots pour 24h

### SQL scripts
- ✅ audit_immutability.sql : trigger DB pour immuabilité AuditLog
- ✅ cgm_partitioning.sql : partitioning CgmEntry par mois
- ✅ basal_config_check.sql : constraints validations basales

### Code Review (22 findings fixed)
- ✅ 8 critiques (sécurité, encryption, auth)
- ✅ 14 majeurs (types, naming, refactoring)

---

## ✅ Phase 1 implémentée (US-100 à US-104)

### US-100 — Authentification JWT RS256
- ✅ `POST /api/auth/login` — bcrypt + JWT RS256 + Session DB
- ✅ `POST /api/auth/logout` — invalidation session par sid
- ✅ `POST /api/auth/refresh` — renouvellement JWT si session valide
- ✅ `POST /api/auth/reset-password` — placeholder (anti-enumération)
- ✅ Middleware JWT global (`src/middleware.ts`) — vérifie JWT sur `/api/**` sauf `/api/auth/*`
- ✅ RBAC hiérarchique : ADMIN > DOCTOR > NURSE > VIEWER
- ✅ Rate limiting applicatif (3 échecs → lockout 5/15/60min)
- ✅ HMAC-SHA256 pour lookup email sécurisé

### US-101 — Gestion du compte utilisateur
- ✅ `GET /api/account` — profil déchiffré (sans champs internes)
- ✅ `PUT /api/account` — mise à jour partielle avec chiffrement auto
- ✅ `PUT /api/account/photo` — upload avatar via OVH S3 (jpeg/png/webp, 5MB, antivirus ClamAV, SSE-S3)
- ✅ `PUT /api/account/terms` — acceptation CGU
- ✅ `PUT /api/account/data-policy` — acceptation politique données
- ✅ `GET/PUT /api/account/day-moments` — périodes journalières
- ✅ userService avec chiffrement AES-256-GCM + base64

### US-102 — Préférences d'unités de mesure
- ✅ `GET/PUT /api/account/units` — préférences d'unités (codes 1-15)
- ✅ `GET /api/units` — référentiel des 15 unités
- ✅ Helpers de conversion glucose (g/L ↔ mg/dL ↔ mmol/L)
- ✅ Règle : données toujours stockées en g/L, converties à l'affichage

### US-103 — Paramètres de confidentialité & RGPD
- ✅ `GET/PUT /api/account/privacy` — consentement GDPR, partage soignants/chercheurs
- ✅ `GET/PUT /api/account/notifications` — préférences email, rappels glycémie/insuline
- ✅ Auto-set `consentDate` quand `gdprConsent = true`
- ✅ Helper `requireGdprConsent()` pour routes données médicales

### US-104 — Export & suppression RGPD
- ✅ `GET /api/account/export` — export JSON complet (profil + patient + CGM + événements)
- ✅ `DELETE /api/account` — suppression cascade (confirmation par mot de passe)
- ✅ Anonymisation user après suppression (FK audit log préservée)
- ✅ Ordre de suppression respectant les FK (48 tables)

### Infrastructure Phase 1
- ✅ 142 tests Vitest (auth, RBAC, rate-limit, HMAC, conversions, audit-logs)
- ✅ ADR #16 : JWT RS256 custom au lieu de NextAuth (compatibilité iOS)

---

## ✅ Phase 2 implémentée (US-200 à US-203)

### US-200 — Profil patient + contrôle d'accès
- ✅ `GET /api/patient` — propre profil patient (déchiffré)
- ✅ `PUT /api/patient` — mise à jour pathologie
- ✅ `GET /api/patients/:id` — accès pro (NURSE+) avec contrôle service
- ✅ `PUT /api/patients/:id` — mise à jour pro avec contrôle service
- ✅ `canAccessPatient()` — ADMIN: tout, VIEWER: propre, DOCTOR/NURSE: via PatientService
- ✅ `getOwnPatientId()` — résolution userId → patientId

### US-201 — Données médicales & antécédents
- ✅ `GET /api/patient/medical-data` — données déchiffrées
- ✅ `PUT /api/patient/medical-data` — mise à jour avec chiffrement history_*
- ✅ Champs chiffrés : historyMedical, historyChirurgical, historyFamily, historyAllergy, historyVaccine, historyLife
- ✅ Validation yearDiag : [1900, année courante]

### US-202 — Objectifs glycémiques & CGM
- ✅ `GET /api/patient/objectives` — 3 types (glycemia, cgm, annex)
- ✅ `PUT /api/patient/objectives` — CGM update (DOCTOR only)
- ✅ Validation : veryLow < low < ok < high, titrLow < titrHigh
- ✅ Defaults ADA : 54/70/180/250 mg/dL
- ✅ objectivesService avec transactions

### US-203 — Suivi de grossesse
- ✅ `GET /api/patient/pregnancy` — grossesse active
- ✅ `POST /api/patient/pregnancy` — nouvelle grossesse (désactive la précédente)
- ✅ `PUT /api/patient/pregnancy/:id` — mise à jour DPA, âge gestationnel
- ✅ Validation gestationalAge : [0, 45] semaines

### Infrastructure Phase 2
- ✅ 149 tests Vitest (+ access control, CGM thresholds)
- ✅ patientService étendu (getByUserId, getMedicalData, updateMedicalData)

---

## ✅ Phase 8 implémentée (Full UI — Pages & Composants)

### Pages implémentées
- ✅ `(auth)/login/page.tsx` — LoginForm (email/password, rate limiting visible, MFA prep, password toggle)
- ✅ `(dashboard)/page.tsx` — Dashboard (4 KPI cards: patients total, actifs 24h, alerte grave, TIR moyen; alertes récentes, TIR donut, patients récents)
- ✅ `(dashboard)/patients/page.tsx` — Patient list (search bar, filter by pathology DT1/DT2/GD, table avec glycemia color-coded verte/orange/rouge)
- ✅ `(dashboard)/patients/[id]/page.tsx` — Patient detail (4 tabs: overview, glycémie CGM, traitements, documents médicaux)

### Layouts & Navigation
- ✅ `(auth)/layout.tsx` — Layout auth (centré, pas de sidebar, fond principal)
- ✅ `(dashboard)/layout.tsx` — Layout protégé (Sidebar à gauche, DashboardHeader, main content responsive)
- ✅ `Sidebar.tsx` — Navigation sidebar (5 items: Dashboard, Patients, Users, Audit, Logout) avec collapse mobile
- ✅ `DashboardHeader.tsx` — Page header (title + notification bell + settings icon)

### Composants métier (Phase 8)
- ✅ `CgmChart.tsx` — Graphique CGM recharts (line chart, target range bande verte, seuils hypo/hyper, sr-only data table)
- ✅ `GlycemiaValue.tsx` — Affichage glycémie (valeur + unité, couleur dynamique: green/orange/red)
- ✅ `TirDonut.tsx` — Donut chart TIR (% en range / hypo / hyper, couleurs métier)
- ✅ `ClinicalBadge.tsx` — Badge alerte (hypo, hyper, info, etc.)
- ✅ `PatientRow.tsx` — Ligne table patients (pathology icon, glycemia, last CGM update)

### Hooks (Phase 8)
- ✅ `useAuth.ts` — Login/logout via httpOnly cookie (pas sessionStorage), redirect si token expiré
- ✅ Cookie-based auth pour navigateur + Bearer header pour API
- ✅ Token JWT stocké en httpOnly, secure, sameSite=Strict (XSS prevention)

### Sécurité & Auth (Phase 8)
- ✅ Middleware étendu — protège `/api/**` AND pages `/dashboard/**` (redirect /login si non auth)
- ✅ httpOnly cookie JWT — XSS prevention, accès interdit au JavaScript client
- ✅ Démo data synthétique (Patient DT1-001, etc.) — jamais de PII réelle
- ✅ Rate limiting visible login — feedback utilisateur après 3 tentatives

### UI Components (shadcn/ui installés)
- ✅ Button, Card, Table, Input, Select, Badge, Dialog, DropdownMenu, AlertDialog, Tabs, Avatar, Tooltip (14 composants)
- ✅ Design system "Sérénité Active" appliqué (teal #0D9488, corail #F97316, glycemia colors)
- ✅ Tailwind CSS dark mode disabled (backoffice medical = light mode obligatoire)
- ✅ Responsive mobile-first (priorité desktop pour backoffice médical)

### Infrastructure Phase 8
- ✅ 29 tests composants (GlycemiaValue, TirDonut, ClinicalBadge, Sidebar, CgmChart)
- ✅ 7 tests E2E (Playwright) login flow
- ✅ 412 tests au total (143 Phase 0 + 142 Phase 1 + 149 Phase 2 + 29 Phase 8)
- ✅ recharts installed pour graphiques
- ✅ @testing-library/react + jsdom pour tests composants

---

---

## 📊 Roadmap User Stories intégrées

> Détail complet : [`docs/ROADMAP.md`](docs/ROADMAP.md)
> Source : `docs/UserStory/pro-user-stories/` (217 US) + `docs/UserStory/user-stories-patient-management/` (51 US)

### Taux de réalisation (2026-05-08)

| Priorité | Total | DONE | PARTIAL | NOT STARTED | % Done |
|----------|-------|------|---------|-------------|--------|
| **MVP**  | 65    | 49   | 6       | 10          | **75%** |
| **V1**   | 122   | 0    | 7       | 115         | **0%**  |
| **V2**   | 58    | 0    | 0       | 58          | **0%**  |
| **V3**   | 8     | 0    | 0       | 8           | **0%**  |
| **V4**   | 15    | 0    | 0       | 15          | **0%**  |
| **TOTAL**| **268** | **49** | **13**  | **206**     | **23%** |

> MVP : **49/65 = 75%** (49/63 = 78% sur scope original). US-2267 reclassée **V1 + blocker-pre-prod** (Diabeo pas en prod, `db push` reste sûr en dev/recette ; à livrer avant 1er go-live).

### MVP — Effort restant (~34 SP)

**Batch A — Compléter les PARTIAL (6 US)**
- US-2047 (UI validation médecin), US-2089 (UI pairing device),
  US-2112/US-2115 (i18n next-intl), US-2117 (modèle cabinet), US-2118 (praticien libéral)

**Batch B — Nouvelles US backoffice (7 US)**
- US-2025 (QR invite mobile), US-2148 (admin users UI), US-2151 (backup management)

**Batch C — Mirror MVP (9 US) — ✅ DONE PR #343**
- US-2214–2217 (config seuils glycémiques/cétones/resucrage),
  US-2224–2226/2230 (urgences inbox + timeline + workflow + push),
  US-2232 (mode grossesse toggle)
- 1093 tests verts · branch coverage 78% · CI green
- 5 critical + 10 high fixés en re-review (5 agents)

**Batch D — Follow-ups Mirror MVP (4 US — Batch D1 MVP livré ; reste V1)**
- ✅ **US-2265** — Événements `ACCESS_DENIED` audit (2 SP, MVP, PR #349) · Issue #344
- ✅ **US-2266** — Email médecin sur alerte critique (3 SP, MVP, PR #349) · Issue #345
- 🚨 **US-2267** — Migrations Prisma versionnées (5 SP, **V1 + blocker-pre-prod**) · Issue #346
- 🔜 **US-2268** — Convention `auditLog.resourceId` normalisée (8 SP, V1) · Issue #347

### Décisions architecturales

| Sujet | Décision |
|-------|----------|
| CGM Ingestion MVP | MyDiabby seul (Dexcom/Abbott en V1) |
| Push Notifications | Firebase FCM |
| Prescriptions (45 US) | Reportées en V2+ (seul US-2171 BDPM en MVP, déjà POC) |
| Upload Documents | OVH S3 immédiat |

### Fusions (redondances détectées)

- US-2132 → alias US-2011 (audit log, DONE)
- US-2026 ↔ US-2126 (INS : modèle patient / API INSi, liés)
- US-2077 ↔ US-2125 (MSSanté : UX / backend, liés)
- US-2008 ↔ US-2127 (PSC : login / intégration, liés)
- US-2148 ↔ US-2012 (RBAC : backend DONE / UI admin restante)
- US-2024 ↔ US-2011 (historique = UI consultation audit log)

---

## 📋 Backlog technique (items historiques mappés)

### Items résolus (mappés vers US)
- [x] US-SEC-001 → US-2012 + US-2048 (RBAC + bornes cliniques)
- [x] US-SEC-002 → US-2020 (soft-delete service layer)
- [x] Unifier CLINICAL_BOUNDS → US-2048
- [x] Slot overlap ISF/ICR → US-2044 + US-2045
- [x] IOB implémentation → US-2049
- [x] Session revocation Redis → US-2001
- [x] JWT 15min + refresh → US-2001
- [x] Rate limiting analytics/export → US-2005
- [x] Routes Phase 3 accès pro → US-2016 + US-2018
- [x] Number(Decimal) → .toNumber() → US-2042
- [x] deliveryMethod typing → US-2042
- [x] upsertBasalConfig input type → US-2046
- [x] Tests write paths Phase 4 → US-2044/2045
- [x] Tests requiresHypoTreatmentFirst → US-2037
- [x] Tests division-by-zero ISF/ICR → US-2048
- [x] Structured logger → transversal
- [x] requireGdprConsent cache → US-2013
- [x] periodType enum → US-2033
- [x] MFA flow TOTP → US-2002

### Items restants
- [ ] **Audit `resourceId` convention** — reporté V2, faible valeur (67 call sites, helper `auditResourceId` à concevoir)
- [ ] **Photo upload OVH** → **US-2140 MVP** (OVH S3, priorité immédiate)

### Design System (transversal, hors US)
- [x] Tokens (couleurs, typo, espacements, ombres) — `src/styles/tokens.css` (258 lignes)
- [x] Composants métier — 44 composants dans `src/components/diabeo/`
- [x] Logo Diabeo — `public/logo.svg` + `src/components/diabeo/brand/Logo.tsx`
- [x] Loaders médicaux — `src/components/diabeo/loaders/` (chart/page/upload)
- [ ] Storybook — stories par composant
- [ ] Accessibilité WCAG 2.1 — audit contrastes + clavier
- [ ] Responsive — validation mobile

### Documentation (transversal, hors US)
- [x] Roadmap US intégrées — `docs/ROADMAP.md`
- [ ] Documentation API Swagger/OpenAPI
- [ ] Runbook opérationnel
- [ ] Guide développeur
- [ ] Documentation HDS/RGPD
- [ ] Changelog

---

*Dernière mise à jour : 2026-05-08 — Mirror MVP livré (PR #343), Batch D1 livré (PR #349 : US-2265 + US-2266), US-2267 reclassée V1 + blocker-pre-prod (Diabeo pas en prod). Total 268 US. MVP 49/65 = 75% (78% sur scope original 63).*
