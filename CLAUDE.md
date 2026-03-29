# CLAUDE.md — Diabeo Backoffice

Fichier de contexte persistant pour Claude Code.
Mis à jour à chaque décision architecturale majeure.

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
│   │       ├── auth/               # NextAuth endpoints
│   │       ├── patients/           # CRUD patients
│   │       └── insulin-configs/    # Config insulinothérapie
│   ├── lib/
│   │   ├── db/
│   │   │   └── client.ts           # Singleton Prisma
│   │   ├── crypto/
│   │   │   └── health-data.ts      # Chiffrement AES-256-GCM
│   │   └── services/               # Logique métier (découplée du framework)
│   │       ├── patient.service.ts
│   │       ├── insulin.service.ts
│   │       └── audit.service.ts
│   └── components/                 # Composants React réutilisables
│       ├── ui/                     # shadcn/ui (NE PAS MODIFIER)
│       └── diabeo/                 # Composants métier Diabeo
├── prisma/
│   ├── schema.prisma           # Schéma de base de données
│   ├── migrations/             # Migrations versionnées
│   └── seed.ts                 # Données de test (jamais de vraies données)
├── docker-compose.yml
├── .env.example
└── CLAUDE.md                   # CE FICHIER
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

### Données de santé (HDS)

```typescript
// ✅ TOUJOURS chiffrer les données personnelles patients
import { encrypt, decrypt } from "@/lib/crypto/health-data"
const encryptedData = encrypt(personalData)  // Avant toute insertion en base

// ✅ TOUJOURS auditer chaque accès aux données de santé
await auditService.log({ action: "READ", resource: "PATIENT", ... })

// ❌ JAMAIS stocker de données personnelles en clair
// ❌ JAMAIS logger des données de santé dans les audit_logs
// ❌ JAMAIS exposer encryptedData dans les API responses
```

### Suppression patients (RGPD)

```typescript
// Soft delete UNIQUEMENT — jamais de DELETE physique sur les patients
// La suppression anonymise les données chiffrées
// Voir patient.service.ts → deletePatient()
```

### Validation médicale

```typescript
// Une InsulinConfig ne doit jamais être isActive = true sans validation médicale
// Chaque modification d'une config remet isActive = false et efface validatedById
// Seul un utilisateur avec rôle DOCTOR peut valider (insulin.service.ts → validateConfig())
```

### API Routes

```typescript
// Toute API Route doit vérifier l'authentification ET le rôle
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

const session = await getServerSession(authOptions)
if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
if (!["ADMIN", "DOCTOR"].includes(session.user.role)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}
```

### Validation des inputs

```typescript
// TOUJOURS valider avec Zod avant d'appeler un service
import { z } from "zod"
const schema = z.object({ ... })
const result = schema.safeParse(body)
if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })
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

## 🗄️ Modèles de données clés

### Patient
- `pseudonymId` : identifiant non-sensible (PAT-2025-XXXXXX)
- `encryptedData` : Buffer AES-256-GCM contenant `{ firstName, lastName, birthDate, email?, phone? }`
- `diabetesType` : TYPE1 | TYPE2 | GESTATIONAL | OTHER
- `deletedAt` : soft delete RGPD

### InsulinConfig
- `sensitivityRatios` : JSONB `[{ hour: 0, value: 50 }, ...]` — ratios sur 24h
- `carbRatios` : JSONB `[{ hour: 0, value: 10 }, ...]` — g de glucides par unité
- `basalRates` : JSONB `[{ hour: 0, value: 0.8 }, ...]` — unités/heure
- `targetGlucose` : JSONB `[{ hour: 0, min: 80, max: 120 }, ...]`
- `isActive` : false par défaut, passe à true après validation médicale

### AuditLog
- Immuable — jamais de UPDATE ni DELETE sur cette table
- Ne contient JAMAIS de données de santé en clair
- Indexé sur `(userId, createdAt)` et `(resource, resourceId, createdAt)`

---

## 💊 Logique métier Diabeo

### Calcul de bolus
```typescript
// Voir lib/services/insulin.service.ts → calculateBolus()
// Bolus repas     = glucides(g) / carbRatio(g/U) pour l'heure actuelle
// Bolus correction = max(0, (glycémie - cible) / sensitivityRatio)
// Total = bolus repas + bolus correction, arrondi à 0.1U
```

### Sélection du ratio horaire
```typescript
// Les ratios 24h sont triés par heure décroissante
// On prend le premier ratio dont l'heure <= heure actuelle
// Fallback : dernier ratio du tableau si aucun ne correspond
```

---

## 🛠️ Commandes utiles

```bash
# Développement local
pnpm dev                          # Next.js sur localhost:3000
docker compose --profile local up  # PostgreSQL local uniquement

# Prisma
pnpm prisma migrate dev           # Créer une migration
pnpm prisma migrate deploy         # Appliquer en prod
pnpm prisma studio                 # Interface graphique BDD
pnpm prisma db seed                # Injecter données de test

# Tests
pnpm test                          # Jest
pnpm test:e2e                      # Playwright

# Déploiement
./deploy.sh update                 # Déployer sur OVHcloud
./deploy.sh status                 # Statut des services
./deploy.sh backup                 # Backup manuel
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

---

*Dernière mise à jour : 2025 — Version POC*
