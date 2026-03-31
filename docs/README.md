# Documentation technique — Diabeo Backoffice

Cette documentation couvre l'implémentation réelle du backoffice Diabeo après la Phase 0.

## Fichiers de référence

### Architecture et conception
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Stack technique, patterns, couches applicatives, flux de données
- **[DATABASE.md](./DATABASE.md)** — Schéma complet (48 tables × 11 domaines), énums, indexes, stratégies de partitioning

### API et services métier
- **[API.md](./API.md)** — Routes implémentées, schémas Zod, exemples de requêtes/réponses
- **[MEDICAL.md](./MEDICAL.md)** — Logique médicale, calcul de bolus, ISF/ICR, constantes cliniques

### Sécurité et conformité
- **[SECURITY.md](./SECURITY.md)** — Chiffrement AES-256-GCM, RGPD, audit HDS, RBAC, SQL scripts

---

## Vue d'ensemble du projet

**Diabeo** est une application de gestion de l'insulinothérapie pour les patients diabétiques. Ce dépôt contient le **backoffice web** (Next.js) destiné aux médecins, infirmières et administrateurs.

### Stack technique

| Composant | Technologie | Version |
|-----------|-------------|---------|
| Framework | Next.js App Router | 16.2.1 |
| Langage | TypeScript | 5.x (strict) |
| UI | shadcn/ui + Tailwind CSS | latest |
| ORM | Prisma | 7.6.0 |
| Base de données | PostgreSQL | 16 |
| Authentification | NextAuth.js | 5.0.0-beta.30 |
| Chiffrement | Node.js crypto natif (AES-256-GCM) | natif |
| Validation | Zod | 4.3.6 |
| Cache | Upstash Redis | 1.37.0 |

### Structure du projet

```
src/
├── app/                           # Next.js App Router
│   ├── (auth)/                    # Pages non-authentifiées
│   ├── (dashboard)/               # Pages protégées
│   └── api/
│       ├── auth/[...nextauth]/    # NextAuth v5 endpoints
│       └── admin/audit-logs/      # Routes admin
├── lib/
│   ├── db/client.ts               # Singleton Prisma
│   ├── crypto/health-data.ts      # Chiffrement AES-256-GCM
│   ├── auth.ts                    # NextAuth configuration
│   └── services/
│       ├── patient.service.ts     # CRUD patients
│       ├── insulin.service.ts     # Calcul bolus
│       └── audit.service.ts       # Audit HDS
├── types/
│   └── next-auth.d.ts             # Augmentation NextAuth (role)
└── components/
    └── diabeo/                    # Composants métier
```

### Phase 0 implémentée

- ✅ Schéma Prisma complet (48 tables)
- ✅ Chiffrement AES-256-GCM (IV+TAG+CIPHERTEXT)
- ✅ Services métier découplés (patient, insulin, audit)
- ✅ API Route /api/admin/audit-logs
- ✅ NextAuth v5 avec configuration de base
- ✅ Seeds de test (5 users, 2 patients, 30j données CGM)
- ✅ Scripts SQL (audit_immutability, cgm_partitioning, basal_config_check)

---

## À lire en priorité

1. **Nouveaux contributeurs** → Commencez par [ARCHITECTURE.md](./ARCHITECTURE.md)
2. **Modifications de schéma** → Consultez [DATABASE.md](./DATABASE.md)
3. **Implémentation de nouvelles routes** → Voir [API.md](./API.md)
4. **Calculs médicaux** → [MEDICAL.md](./MEDICAL.md)
5. **Données sensibles** → [SECURITY.md](./SECURITY.md) (critique)

---

## Variables d'environnement requises

```bash
# Chiffrement
HEALTH_DATA_ENCRYPTION_KEY="..." # 32 bytes en hex (64 caractères)
HMAC_SECRET="..."                # 32+ bytes pour emailHmac

# NextAuth (Phase 1+)
AUTH_SECRET="..."                # Clé session JWT
AUTH_URL="http://localhost:3000"

# Base de données
DATABASE_URL="postgresql://user:pass@localhost:5432/diabeo"

# Cache (optionnel)
UPSTASH_REDIS_REST_URL="..."
UPSTASH_REDIS_REST_TOKEN="..."
```

---

## Commandes essentielles

```bash
# Développement
pnpm dev                         # Next.js sur localhost:3000
docker compose --profile local up # PostgreSQL local

# Prisma
pnpm prisma migrate dev          # Créer migration
pnpm prisma db seed              # Injecter données test
pnpm prisma studio               # Interface BDD (localhost:5555)

# Tests
pnpm test                        # Jest
pnpm test:e2e                    # Playwright

# SQL scripts (manuels après migration)
psql $DATABASE_URL < prisma/sql/audit_immutability.sql
psql $DATABASE_URL < prisma/sql/cgm_partitioning.sql
```

---

## Normes de code

- **TypeScript strict** — Pas de `any`
- **Zod validation** — Tous les inputs d'API Routes
- **Audit logging** — Chaque accès aux données de santé
- **Chiffrement** — Données patients en base64(AES-256-GCM)
- **RBAC** — Vérification rôle sur toutes les routes protégées
- **Accessibilité** — ARIA labels obligatoires

---

## Checklist avant PR

- [ ] Authentification + autorisation par rôle
- [ ] Données patients chiffrées en base de données
- [ ] `auditService.log()` appelé pour accès santé
- [ ] Validation Zod sur inputs API Routes
- [ ] Pas de `console.log` avec données patients
- [ ] Tests unitaires pour logique métier
- [ ] Types TypeScript stricts
- [ ] Composants accessibles (ARIA)

---

Dernière mise à jour : 2026-03-31 (Phase 0)
