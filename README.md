# Diabeo BackOffice

Application de gestion de l'insulinothérapie destinée aux médecins, infirmières et administrateurs pour le suivi des patients diabétiques.

## Vue d'ensemble

**Diabeo** est une plateforme web complète permettant :

- Gestion centralisée des patients (Type 1, Type 2, Gestationnel)
- Configuration et suivi de l'insulinothérapie
- Calcul de bolus avec suggestions automatiques
- Suivi continu du glucose (CGM)
- Audit HDS et traçabilité complète
- Export RGPD (Article 15) et suppression RGPD (Article 17)

Cette application est certifiée HDS (Hébergement de Données Santé) et conforme à RGPD Article 9.

### Architecture

- **Backoffice** : Next.js 16, TypeScript, Prisma 7, PostgreSQL 16 (ce dépôt)
- **Application iOS** : Swift (dépôt séparé, synchronisation modèles de données)

---

## Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| **Framework** | Next.js (App Router) | 16.x |
| **Langage** | TypeScript | strict |
| **UI** | shadcn/ui + Tailwind CSS | latest |
| **ORM** | Prisma | 7.x |
| **Base de données** | PostgreSQL | 16 |
| **Authentification** | JWT RS256 custom (jose + bcryptjs) | — |
| **Chiffrement données santé** | AES-256-GCM | Node.js natif |
| **Cache** | Upstash Redis | POC |
| **Stockage fichiers** | OVH Object Storage (S3-compatible) | — |
| **Infrastructure** | Docker Compose + OVHcloud GRA | — |
| **Tests** | Vitest + Playwright | — |

---

## Installation

### Prérequis

- Node.js 18+ avec pnpm
- PostgreSQL 16 local (via Docker Compose)
- Accès OVHcloud (production)

### Configuration locale

1. Cloner le dépôt

```bash
git clone https://github.com/diabeo-health/diabeo-backoffice.git
cd diabeo-backoffice
```

2. Installer les dépendances

```bash
pnpm install
```

3. Configurer les variables d'environnement

```bash
cp .env.example .env.local
```

Générer les clés manquantes :

```bash
# JWT RS256 (asymétrique)
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
# Copier le contenu en remplaçant \n par des sauts de ligne dans JWT_PRIVATE_KEY / JWT_PUBLIC_KEY

# HMAC pour lookup email
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copier dans HMAC_SECRET

# Clé de chiffrement AES-256-GCM
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copier dans HEALTH_DATA_ENCRYPTION_KEY
```

4. Lancer PostgreSQL local

```bash
docker compose --profile local up -d
```

Vérifier la connexion :

```bash
psql postgresql://diabeo:password@localhost:5432/diabeo
```

5. Initialiser la base de données

```bash
pnpm prisma migrate deploy   # Appliquer migrations
pnpm prisma db seed          # Injecter données de test (5 users, 2 patients, 30j CGM)
```

6. Démarrer le serveur de développement

```bash
pnpm dev
```

Accès : http://localhost:3000

### Seeds de test

Le seed crée automatiquement :

- **5 utilisateurs** : 1 admin, 1 doctor, 1 nurse, 2 patients
- **2 patients** : 1 Type 1 (DT1), 1 Type 2 (DT2)
- **Configurations insuline** : ISF, ICR, profils basaux pour 24h
- **30 jours de données CGM** : entrées déterministes pour tests

Accédez à Prisma Studio pour explorer :

```bash
pnpm prisma studio
```

---

## Architecture

### Structure du projet

```
diabeo-backoffice/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── (auth)/                 # Pages authentification (login, MFA)
│   │   ├── (dashboard)/            # Pages protégées (RBAC)
│   │   │   ├── patients/           # Module patients
│   │   │   ├── users/              # Module utilisateurs
│   │   │   └── audit/              # Module audit HDS
│   │   └── api/                    # API Routes Next.js
│   │       ├── auth/               # JWT RS256
│   │       │   ├── login           # POST — authentification
│   │       │   ├── logout          # POST — déconnexion
│   │       │   ├── refresh         # POST — renouvellement JWT
│   │       │   └── reset-password  # POST — réinitialisation
│   │       ├── account/            # Gestion profil
│   │       │   ├── route.ts        # GET/PUT/DELETE profil
│   │       │   ├── photo           # PUT — avatar
│   │       │   ├── terms           # PUT — CGU/CGV
│   │       │   ├── day-moments     # GET/PUT — périodes journalières
│   │       │   ├── units           # GET/PUT — unités (mg/dL vs g/L)
│   │       │   ├── privacy         # GET/PUT — paramètres RGPD
│   │       │   ├── notifications   # GET/PUT — préférences notifs
│   │       │   └── export          # GET — export RGPD Article 15
│   │       ├── units/              # GET — référentiel unités
│   │       ├── admin/              # Admin-only
│   │       │   └── audit-logs      # GET avec filtres
│   │       └── patients/           # CRUD patients (Phase 2+)
│   ├── lib/
│   │   ├── db/
│   │   │   └── client.ts           # Singleton Prisma
│   │   ├── crypto/
│   │   │   ├── health-data.ts      # AES-256-GCM encrypt/decrypt
│   │   │   └── hmac.ts             # HMAC-SHA256 pour email lookup
│   │   ├── auth/                   # Authentification JWT RS256
│   │   │   ├── index.ts            # getAuthUser, requireAuth, requireRole
│   │   │   ├── jwt.ts              # Sign/verify JWT (jose)
│   │   │   ├── rbac.ts             # RBAC : ADMIN > DOCTOR > NURSE > VIEWER
│   │   │   ├── rate-limit.ts       # Backoff exponentiel (in-memory)
│   │   │   └── session.ts          # CRUD sessions
│   │   ├── conversions.ts          # Glucose g/L <-> mg/dL <-> mmol/L
│   │   ├── gdpr.ts                 # Vérification consentement RGPD
│   │   └── services/               # Logique métier (découplée du framework)
│   │       ├── patient.service.ts  # CRUD patients + encrypt/decrypt
│   │       ├── insulin.service.ts  # Bolus (transaction), ISF/ICR slots
│   │       ├── audit.service.ts    # AuditLog + IP/UA + filtres
│   │       ├── user.service.ts     # Profil utilisateur
│   │       ├── export.service.ts   # Export RGPD Article 15
│   │       └── deletion.service.ts # Suppression cascade RGPD Article 17
│   ├── types/
│   │   └── next-auth.d.ts          # Module augmentation JWT
│   └── components/                 # Composants React
│       ├── ui/                     # shadcn/ui (auto-généré)
│       └── diabeo/                 # Composants métier
├── prisma/
│   ├── schema.prisma               # 48 tables × 11 domaines, 21 enums
│   ├── migrations/                 # Migrations versionnées
│   ├── seed.ts                     # Données de test
│   └── sql/                        # Scripts SQL de référence
│       ├── cgm_partitioning.sql    # Partitioning CgmEntry par mois
│       ├── audit_immutability.sql  # Trigger immuabilité AuditLog
│       └── basal_config_check.sql  # Validations basales
├── docker-compose.yml
├── .env.example
└── CLAUDE.md                       # Context persistant équipe
```

### Architecture des données

**48 tables organisées en 11 domaines métier** :

| Domaine | Tables | Description |
|---------|--------|-------------|
| **Utilisateurs & Auth** | User, Account, Session, VerificationToken, UserUnitPreferences, UserNotifPreferences, UserPrivacySettings | Authentification JWT, préférences utilisateur |
| **Patients** | Patient, PatientMedicalData, PatientAdministrative, PatientPregnancy, GlycemiaObjective, CgmObjective, AnnexObjective, Treatment | Données patients, antécédents, pathologies |
| **Insulinothérapie** | InsulinTherapySettings, GlucoseTarget, IobSettings, ExtendedBolusSettings, InsulinSensitivityFactor, CarbRatio, BasalConfiguration, PumpBasalSlot | Configuration insuline, ISF/ICR slots horaires |
| **Glycémie & CGM** | CgmEntry, GlycemiaEntry, AverageData, CgmObjective, BolusCalculationLog | Données capteur continu, mesures ponctuelles |
| **Événements** | DiabetesEvent, InsulinFlowEntry, PumpEvent | Événements patients (glycémie, repas, activité) |
| **Propositions d'ajustement** | AdjustmentProposal | Suggestions automatiques (status : pending/accepted/rejected) |
| **Appareils** | PatientDevice, DeviceDataSync, InsulinFlowDeviceData | Synchronisation CGM/pompe/glucomètre |
| **Équipe médicale** | HealthcareService, HealthcareMember, PatientService, PatientReferent | Structures de santé, équipes |
| **Documents & Rendez-vous** | MedicalDocument, Appointment, Announcement | Ordonnances, labo, consultations |
| **Notifications Push** | PushDeviceRegistration, PushNotificationTemplate, PushNotificationLog, PushScheduledNotification | FCM iOS/Android/web |
| **Configuration & UI** | DashboardConfiguration, DashboardWidget, UnitDefinition, UserDayMoment, UiStateSave | Personnalisation dashboards |
| **Audit HDS** | AuditLog (immuable) | Traçabilité complète : action, resource, IP, UA |

---

## Sécurité

### Chiffrement des données de santé (AES-256-GCM)

Toutes les données patients (nom, prénom, email, antécédents) sont chiffrées **avant insertion** en base de données.

**Format de chiffrement** : IV (12 bytes) + TAG (16 bytes) + CIPHERTEXT

**Stockage en base** : Encodage base64 pour les colonnes String (ex: `User.firstname`)

```typescript
import { encrypt, decrypt } from "@/lib/crypto/health-data"

// Chiffrement
const plaintext = "Jean Dupont"
const encryptedBytes = encrypt(plaintext)  // Uint8Array
const base64 = Buffer.from(encryptedBytes).toString("base64")

// Déchiffrement
const decryptedBytes = new Uint8Array(Buffer.from(base64, "base64"))
const plaintext = decrypt(decryptedBytes)
```

### Authentification (JWT RS256)

- **Asymétrique** : clés publique/privée (openssl genrsa)
- **Stateless** : idéal pour scalabilité horizontale
- **Durée de vie** : 15 min (access), 7 jours (refresh)
- **Révocation** : via table Session en base de données

### HMAC pour lookup unique (emailHmac)

Permet des requêtes SQL rapides sans exposer l'email chiffré :

```typescript
import { createHmac } from "crypto"

const emailHmac = createHmac("sha256", process.env.HMAC_SECRET)
  .update(email)
  .digest("hex")

// Index UNIQUE sur emailHmac
const user = await db.user.findUnique({ where: { emailHmac } })
```

### Contrôle d'accès (RBAC)

4 rôles hiérarchisés :

| Rôle | Permissions |
|------|-------------|
| **ADMIN** | Gestion utilisateurs, configuration système, audit logs, suppressions |
| **DOCTOR** | Portefeuille patients, validation configurations insuline, consultations |
| **NURSE** | Consultation patients, création configurations (sans validation), suivi CGM |
| **VIEWER** | Lecture seule, périmètre autorisé |

### Soft delete RGPD

Jamais de DELETE physique sur la table `patients`. Pattern :

```typescript
// Suppression logique
UPDATE patient SET deletedAt = NOW() WHERE id = ?

// Trigger PostgreSQL : anonymise les données chiffrées
// Voir prisma/sql/audit_immutability.sql
```

### Audit HDS (Table immuable)

Chaque accès à une donnée santé est enregistré dans `AuditLog` (immuable par trigger PostgreSQL) :

```typescript
await auditService.log({
  userId,
  action: "READ",          // READ, CREATE, UPDATE, DELETE
  resource: "PATIENT",     // PATIENT, INSULIN_CONFIG, CGM_ENTRY, etc.
  resourceId: "12345",
  ipAddress,              // Extraction automatique
  userAgent,
  metadata: { ... }       // Contexte supplémentaire
})

// JAMAIS logger les valeurs décryptées
// JAMAIS exposer le base64 chiffré en réponse API
```

---

## API Routes

### Authentification

```
POST   /api/auth/login            Connexion (email + password)
POST   /api/auth/logout           Déconnexion
POST   /api/auth/refresh          Renouvellement JWT
POST   /api/auth/reset-password   Réinitialisation mot de passe
```

### Gestion de compte

```
GET    /api/account                Profil utilisateur
PUT    /api/account                Modification profil
DELETE /api/account                Suppression compte (RGPD Article 17)

PUT    /api/account/photo          Upload avatar
PUT    /api/account/terms          Acceptation CGU/CGV
PUT    /api/account/data-policy    Politique de données

GET    /api/account/day-moments    Périodes journalières personnalisées
PUT    /api/account/day-moments    Modification périodes

GET    /api/account/units          Préférences unités (mg/dL vs g/L)
PUT    /api/account/units          Modification unités

GET    /api/account/privacy        Paramètres RGPD
PUT    /api/account/privacy        Modification paramètres

GET    /api/account/notifications  Préférences notifs push
PUT    /api/account/notifications  Modification préférences

GET    /api/account/export         Export RGPD Article 15 (ZIP)
```

### Patients (Phase 2+)

```
GET    /api/patients               Lister (filtrés par RBAC)
POST   /api/patients               Créer patient
GET    /api/patients/:id           Détails patient
PUT    /api/patients/:id           Modifier patient
DELETE /api/patients/:id           Soft delete (RGPD)

GET    /api/patients/:id/glucose   Glycémie (30j)
GET    /api/patients/:id/cgm       Entrées CGM (détaillées)
GET    /api/patients/:id/settings  Configuration insuline
```

### Admin

```
GET    /api/admin/audit-logs       Logs d'audit (filtres : userId, resource, action, from, to)
```

### Référentiels

```
GET    /api/units                  Définition unités (mg/dL, g/L, mmol/L, etc.)
```

Toutes les routes sont protégées par authentification JWT et validées avec Zod.

---

## Logique métier

### Calcul de bolus (Insulin Therapy)

**Pattern** : Suggestion JAMAIS automatique. Flux d'acceptation explicite patient requis.

```
1. BolusCalculationLog créé (journal immuable)
2. AdjustmentProposal créé avec status = "pending"
3. Patient accepte ou refuse
4. Après acceptation : injection réelle par patient/pompe
```

**Bornes cliniques** (voir `insulin.service.ts`) :

| Paramètre | Min | Max |
|-----------|-----|-----|
| ISF (g/L/U) | 0.20 | 1.00 |
| ISF (mg/dL/U) | 20 | 100 |
| ICR (g/U) | 5.0 | 20.0 |
| Basal (U/h) | 0.05 | 10.0 |
| Glycémie cible (mg/dL) | 60 | 250 |
| Bolus max (U) | — | 25.0 |

**Formule** :

```
Bolus repas       = carbsGrams / icr.gramsPerUnit
Correction        = max(0, (currentMgdL - targetMgdL) / isf.sensitivityFactorMgdl)
Ajustement IOB    = appliquer insulinActionDuration + peak
Total recommandé  = mealBolus + correctionDose - iobAdjustment
Cappage final     = min(recommendedDose, MAX_SINGLE_BOLUS)
```

### Sélection de ratios horaires

ISF, ICR, et profils basaux sont organisés par **slots horaires** (Time : "HH:MM:SS") :

```typescript
const findSlotForHour = (
  slots: { startHour: number; value: number }[],
  hour: number
): { value: number } => {
  // Slots triés DESC (24h -> 0h)
  // Sélectionner premier slot où startHour <= hour
  return slots
    .sort((a, b) => b.startHour - a.startHour)
    .find(s => s.startHour <= hour) ?? slots[slots.length - 1]
}
```

### Transactions Prisma 7

Bolus calculation atomique (calcul + log dans une transaction) :

```typescript
return prisma.$transaction(async (tx) => {
  const log = await tx.bolusCalculationLog.create({ ... })
  await auditService.logWithTx(tx, { action: "BOLUS_CALCULATED", ... })
  return { ...log, warnings: [...] }
})
```

---

## Conformité réglementaire

### HDS (Hébergement de Données Santé)

- Chiffrement AES-256-GCM des données patients
- Audit trail immuable (PostgreSQL trigger)
- Contrôle d'accès RBAC strict
- Chiffrement TLS en transit
- Sauvegarde chiffrée

### RGPD Article 9 (données sensibles)

- Consentement explicite requis (table `UserPrivacySettings`)
- Chiffrement applicatif double couche
- Audit des accès détaillé

### RGPD Article 15 (droit d'accès)

```
GET /api/account/export
```

Exporte ZIP contenant :
- Profil utilisateur
- Tous les patients associés
- Données glucose, CGM, bolus
- Logs audit
- Fichiers médicaux (PDF, images)

### RGPD Article 17 (droit à l'oubli)

```
DELETE /api/account
```

Suppression cascade atomique :
1. Soft delete tous les patients
2. Anonymisation des logs
3. Suppression fichiers OVH
4. Suppression données santé en base

---

## Tests

### Stratégie de test

| Niveau | Framework | Coverage | Commande |
|--------|-----------|----------|----------|
| Unitaires | Vitest | Services métier | `pnpm test` |
| Intégration | Vitest + Prisma | API routes | `pnpm test:watch` |
| E2E | Playwright | Workflows utilisateur | `pnpm test:e2e` |
| Coverage | vitest-coverage | 86%+ | `pnpm test:coverage` |

### Exécuter les tests

```bash
# Unitaires (watch mode)
pnpm test:watch

# Unitaires (une fois)
pnpm test

# E2E (mode UI interactif)
pnpm test:e2e:ui

# E2E (headless)
pnpm test:e2e

# Tous les tests
pnpm test:all

# Coverage report
pnpm test:coverage
```

### Setup E2E

```bash
pnpm test:e2e:setup
```

Crée une DB PostgreSQL de test, seed données, puis exécute Playwright.

---

## Déploiement

### Local (Docker Compose)

```bash
# Lancer tous les services
docker compose up -d

# Profil local (PostgreSQL uniquement)
docker compose --profile local up -d

# Logs
docker compose logs -f api

# Arrêter
docker compose down
```

### Production (OVHcloud)

```bash
# Via script deploy
./deploy.sh update       # Pull + migrate + restart
./deploy.sh status       # Vérifier santé services
./deploy.sh backup       # Backup manuel PostgreSQL
```

### Variables d'environnement (Secrets)

Stocker dans `.env.local` (JAMAIS commiter) :

- `JWT_PRIVATE_KEY` : Clé privée RSA (2048 bits)
- `JWT_PUBLIC_KEY` : Clé publique RSA
- `HMAC_SECRET` : Clé HMAC 256-bit
- `HEALTH_DATA_ENCRYPTION_KEY` : Clé AES-256 256-bit
- `UPSTASH_REDIS_REST_URL` : URL Redis (production)
- `UPSTASH_REDIS_REST_TOKEN` : Token Redis
- `OVH_S3_*` : Credentials OVH Object Storage

Jamais en git. Utiliser système de secrets (GitHub Actions, OVHcloud VPS env).

---

## Structure des composants

### Composants UI (shadcn/ui)

Situés dans `src/components/ui/`. JAMAIS modifier directement (auto-généré par `shadcn`).

Ajouter un composant :

```bash
npx shadcn-ui@latest add <component>
```

### Composants métier (Diabeo)

Situés dans `src/components/diabeo/`. Réutilisables, testés, accessibles (ARIA).

Exemples :
- `GlucoseChart.tsx` : Graphique glycémie 30j
- `BolusRecommendation.tsx` : Suggestion bolus avec acceptation
- `PatientCard.tsx` : Fiche patient (RBAC)
- `AuditTrail.tsx` : Logs audit

### Design system

**Palette "Sérénité Active"** :

```css
Primaire (teal)     : #0D9488  → Actions, liens, titres
Secondaire (corail) : #F97316  → Alertes, actions secondaires
Fond principal      : #FAFAFA
Fond secondaire     : #F3F4F6
Texte principal     : #1F2937
Texte secondaire    : #6B7280

Glycémie normale    : #10B981  (vert)
Glycémie haute      : #F59E0B  (orange)
Glycémie critique   : #EF4444  (rouge)
```

---

## Contributing

### Workflow

1. Créer une branche feature `feature/US-XXX-description`
2. Développer avec code review local
3. Valider avec tests unitaires + E2E
4. Créer PR vers `main`
5. Code review par `code-reviewer` + `healthcare-security-auditor`
6. Merge après approval

### Checklist PR

- [ ] Authentification + RBAC sur routes nouvelles
- [ ] Données patients chiffrées avant insertion
- [ ] `auditService.log()` appelé pour chaque accès santé
- [ ] Validation Zod sur inputs API
- [ ] Pas de `console.log` avec données patients
- [ ] Tests unitaires ajoutés
- [ ] Types TypeScript stricts (0 `any`)
- [ ] Composants accessibles (ARIA)
- [ ] Pas de secrets dans commits

### Équipe

Team de développement Diabeo :

- **nextjs-developer** : Développement pages/API routes
- **typescript-pro** : Type safety, Zod schemas
- **sql-pro** : PostgreSQL, indexation, optimisation
- **code-reviewer** : Gate sécurité PR
- **healthcare-security-auditor** : Audit HDS/RGPD
- **medical-domain-validator** : Validations médicales
- **prisma-specialist** : Migrations, transactions
- **devops-engineer** : Docker, infra, CI/CD

Voir `.claude/TEAM.md` pour détails.

---

## Troubleshooting

### PostgreSQL refuse connexion

```bash
# Vérifier service Docker
docker compose ps

# Logs PostgreSQL
docker compose logs postgres

# Redémarrer
docker compose restart postgres
```

### Prisma migrations échouées

```bash
# Reset BDD locale (danger !)
pnpm prisma migrate reset

# Vérifier état migrations
pnpm prisma migrate status

# Générer client
pnpm prisma generate
```

### JWT expiration

JWT access : 15 minutes. Renouveler via :

```
POST /api/auth/refresh
```

Envoyer `refreshToken` depuis localStorage (httpOnly en production).

### Erreurs chiffrement

Vérifier clés dans `.env.local` :

```bash
# Doit être 64 caractères hex (32 bytes)
echo ${HEALTH_DATA_ENCRYPTION_KEY} | wc -c
echo ${HMAC_SECRET} | wc -c
```

Régénérer si nécessaire :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Documentation

- **CLAUDE.md** : Context persistant équipe Claude Code
- **.claude/TEAM.md** : Rôles et responsabilités agents
- **prisma/sql/** : Scripts SQL de référence (triggers, partitioning)
- **API Routes** : Zod schemas dans chaque `route.ts`

---

## Ressources

- [Next.js App Router](https://nextjs.org/docs/app)
- [Prisma](https://www.prisma.io/docs/)
- [shadcn/ui](https://ui.shadcn.com/)
- [JWT RS256 (jose)](https://github.com/panva/jose)
- [Zod](https://zod.dev/)
- [Playwright](https://playwright.dev/)
- [PostgreSQL 16](https://www.postgresql.org/docs/16/)

---

## Support & Contact

Pour questions techniques ou sécurité :
- Issues GitHub (public)
- Discussion sécurité : security@diabeo-health.com
- Team Slack : #backoffice

---

**Dernière mise à jour** : 2026-04-01

**Phase en cours** : Phase 0 — Schéma Prisma 48 tables + auth JWT RS256 + services métier
