# CLAUDE.md — Diabeo Backoffice

Fichier de contexte persistant pour Claude Code.
Mis à jour à chaque décision architecturale majeure.

---
@.claude/TEAM.md
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
| Auth           | NextAuth.js                        | v5       |
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
│   │   ├── (auth)/                 # Pages auth (login, MFA)
│   │   ├── (dashboard)/            # Pages protégées
│   │   │   ├── patients/           # Module patients
│   │   │   ├── users/              # Module utilisateurs
│   │   │   └── audit/              # Module audit HDS
│   │   └── api/                    # API Routes Next.js
│   │       ├── auth/[...nextauth]/ # NextAuth v5 endpoints
│   │       ├── admin/              # Admin-only endpoints (audit-logs)
│   │       └── patients/           # CRUD patients (à implémenter)
│   ├── lib/
│   │   ├── db/
│   │   │   └── client.ts           # Singleton Prisma (Prisma 7+)
│   │   ├── crypto/
│   │   │   └── health-data.ts      # Chiffrement AES-256-GCM (IV+TAG+CIPHERTEXT)
│   │   ├── auth.ts                 # NextAuth v5 configuration
│   │   └── services/               # Logique métier (découplée du framework)
│   │       ├── patient.service.ts  # CRUD patients + encrypt/decrypt base64
│   │       ├── insulin.service.ts  # Bolus calc (transaction), ISF/ICR par slot horaire
│   │       └── audit.service.ts    # AuditLog + IP/UA tracking + query filters
│   ├── types/
│   │   └── next-auth.d.ts          # Module augmentation NextAuth (User.role, JWT.role)
│   └── components/                 # Composants React réutilisables
│       ├── ui/                     # shadcn/ui (NE PAS MODIFIER)
│       └── diabeo/                 # Composants métier Diabeo
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

### API Routes (NextAuth v5)

```typescript
// ✅ Toute route doit vérifier auth + rôle
import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const session = await auth()

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // ...
}

// NextAuth v5 : await auth() instead of getServerSession()
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
// patient.service.ts : create, getById, listByDoctor, deletePatient
// insulin.service.ts : getSettings, calculateBolus
// audit.service.ts : log, logWithTx, query

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

# Chiffrement — configuration requise
export HEALTH_DATA_ENCRYPTION_KEY="..."  # 32 bytes en hex (64 caractères)
export HMAC_SECRET="..."                 # 32+ bytes pour emailHmac

# Tests
pnpm test                              # Jest sur src/lib/services
pnpm test:e2e                          # Playwright sur pages et API routes

# Audit SQL (référence — à appliquer manuellement après migration)
# psql $DATABASE_URL < prisma/sql/audit_immutability.sql
# psql $DATABASE_URL < prisma/sql/cgm_partitioning.sql
# psql $DATABASE_URL < prisma/sql/basal_config_check.sql

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

---

## ✅ Checklist avant chaque PR

- [ ] Authentification + autorisation par rôle sur toutes les nouvelles API Routes
- [ ] Données patients chiffrées avant insertion, déchiffrées uniquement à la lecture
- [ ] `auditService.log()` appelé pour chaque accès à une donnée de santé
- [ ] Validation Zod sur tous les inputs des API Routes
- [ ] Pas de `console.log` avec des données patients
- [ ] Tests unitaires pour la logique métier ajoutée
- [ ] Types TypeScript stricts (pas de `any`)
- [ ] Composants accessibles (ARIA labels)

---

## 📋 Décisions architecturales (ADR)

| # | Décision | Raison |
|---|----------|--------|
| 1 | Monolithe Next.js (pas microservices) | POC 50k patients — complexité inutile |
| 2 | Chiffrement applicatif AES-256-GCM | Données sensibles protégées même si la BDD est compromise |
| 3 | Sessions NextAuth en PostgreSQL | App stateless = scalable horizontalement |
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

*Dernière mise à jour : 2026-03-31 — Phase 0 implémentée — Branche feat/phase-0-schema-audit*
