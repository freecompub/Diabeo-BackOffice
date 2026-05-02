# US-2118 — Médecins libéraux

> 📌 **14. Entités orga** · Priorité **MVP** · Pays **Universel**
> 

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2118` |
| **Référence inventaire** | `FN-118` |
| **Domaine** | 14. Entités orga |
| **Priorité** | **MVP** |
| **Pays cible** | Universel |
| **Intégration externe** | Non |
| **Service / Standard** | Interne |
| **Modèle économique** | Interne |
| **Coût estimé** | — |
| **Statut** | 🆕 À démarrer |
| **Story points** | **1** (Fibonacci) |
| **Dépendances** | Aucune |
| **Sprint cible** | À définir lors du planning |
| **Owner** | À assigner |

---

## 📋 Contexte métier

### Pourquoi cette fonctionnalité ?

Indépendants

Cette fonctionnalité s'inscrit dans le domaine **14. Entités orga** de Diabeo BackOffice, plateforme de gestion de l'insulinothérapie certifiée HDS pour professionnels de santé. Elle contribue directement à la valeur clinique et opérationnelle livrée aux médecins, infirmières et administrateurs qui utilisent quotidiennement la plateforme pour suivre leurs patients diabétiques (Type 1, Type 2, gestationnel).

### Personas concernés

ADMIN multi-entités, direction réseaux de soins

### Valeur produit

- **Pour le soignant** : gain de temps, fiabilité accrue, meilleure visibilité clinique
- **Pour le patient** : sécurité renforcée, qualité de soin améliorée, continuité du suivi
- **Pour le cabinet** : conformité réglementaire, productivité, traçabilité HDS


---

## ✅ Critères d'acceptation

### AC-1 — Accès autorisé respecté

```gherkin
Étant donné Un utilisateur authentifié avec le rôle requis
Quand il accède à la fonctionnalité « Médecins libéraux »
Alors l'action est autorisée et l'AuditLog enregistre l'accès
```

### AC-2 — Accès non autorisé bloqué

```gherkin
Étant donné Un utilisateur sans le rôle requis (ou non authentifié)
Quand il tente d'accéder à « Médecins libéraux »
Alors la requête est rejetée avec HTTP 401/403, et la tentative est journalisée
```


---

## 📐 Règles métier

- **RM-1 : Tous les accès à cette fonctionnalité sont journalisés dans AuditLog (action, resource, resourceId, userId, ipAddress, userAgent).**
- **RM-2 : RBAC strict — seuls les rôles autorisés (voir AC-1) peuvent invoquer cette fonctionnalité.**
- **RM-3 : Les requêtes sont validées par un schéma Zod avant tout traitement métier.**

---

## 🗄️ Modèle de données

### Schéma Prisma indicatif

```prisma
// À définir lors de la conception détaillée
// Réutiliser au maximum les modèles existants du schema.prisma (48 tables)
// Voir docs/architecture/data-model.md
```

### Notes de migration

- Créer une migration Prisma dédiée : `pnpm prisma migrate dev --name medecins-liberaux`
- Si nouveaux index : vérifier l'impact sur les performances avec `EXPLAIN ANALYZE`
- Si données existantes à migrer : prévoir un script de backfill idempotent dans `prisma/migrations/sql/`
- Mise à jour du seed si pertinent (`prisma/seed.ts`)

---

## 🔌 API & contrats

### Routes exposées

```
/api/feature
```

| Méthode | Endpoint | Auth | Rôles autorisés | Description |
|---------|----------|------|-----------------|-------------|
| GET     | `/api/feature` | JWT | Selon AC-1 | Liste / lecture |
| POST    | `/api/feature` | JWT | Selon AC-1 | Création |
| PUT     | `/api/feature/[id]` | JWT | Selon AC-1 | Modification |
| DELETE  | `/api/feature/[id]` | JWT | ADMIN/DOCTOR (selon RBAC) | Soft delete (RGPD) |

> ⚠️ Les méthodes ci-dessus sont indicatives. À ajuster lors de la conception détaillée selon la nature exacte de la fonctionnalité.

### Validation des entrées (Zod)

```typescript
import { z } from "zod"

export const medecins_liberauxSchema = z.object({
  // À compléter selon la fonctionnalité
  // Exemples : id: z.string().cuid(), value: z.number().positive(), ...
})

export type MedecinsliberauxInput = z.infer<typeof medecins_liberauxSchema>
```

### Format de réponse standard

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "auditLogId": "clxxxxx",
    "timestamp": "2026-01-15T10:30:00Z"
  }
}
```

### Pagination (si applicable)

```typescript
{
  data: T[],
  pagination: {
    page: number,
    pageSize: number,
    total: number,
    hasMore: boolean
  }
}
```

---

## ⚠️ Scénarios d'erreur

| HTTP | Code applicatif | Message utilisateur | Comportement |
|------|-----------------|---------------------|--------------|
| 400 | `VALIDATION_ERROR` | Le format de la requête est invalide | Renvoie les détails des champs invalides |
| 401 | `UNAUTHENTICATED` | Veuillez vous connecter | Redirection vers login |
| 403 | `FORBIDDEN` | Vous n'avez pas les permissions requises | Pas de détails sur les permissions par sécurité |
| 404 | `NOT_FOUND` | Ressource introuvable | Message générique (pas d'info sur l'existence) |
| 409 | `CONFLICT` | État incompatible avec l'opération | Détail métier si non sensible |
| 422 | `UNPROCESSABLE` | Règle métier non respectée | Détail de la règle violée |
| 429 | `RATE_LIMITED` | Trop de requêtes, réessayez plus tard | Retry-After header |
| 500 | `INTERNAL_ERROR` | Erreur interne, l'équipe a été notifiée | Sentry / log + ID corrélation |
| 503 | `SERVICE_UNAVAILABLE` | Service externe indisponible | Si fournisseur tiers KO, retry auto |

---

## 🔒 Sécurité & conformité HDS

### Authentification
- JWT RS256 obligatoire (jose) — voir `src/lib/auth/jwt.ts`
- Access token : 15 min, refresh token : 7 jours
- Vérification de la signature ET de l'expiration à chaque requête

### RBAC
- Middleware `requireAuth(role)` ou `requireRole(['ADMIN', 'DOCTOR'])`
- Voir `src/lib/auth/rbac.ts` pour la hiérarchie : ADMIN > DOCTOR > NURSE > VIEWER

### Chiffrement
- AES-256-GCM via Node.js `crypto` natif (voir `src/lib/crypto/health-data.ts`)
- Clé `HEALTH_DATA_ENCRYPTION_KEY` (32 bytes hex) en env, jamais en code
- Format : IV (12 bytes) || TAG (16 bytes) || ciphertext, encodé base64 en colonne `Bytes`

### HMAC (lookup)
- HMAC-SHA256 pour les colonnes recherchables (email, INS, n° prescripteur)
- Clé `HMAC_SECRET` distincte de la clé de chiffrement

### Audit log
- `auditService.log({ userId, action, resource, resourceId, ipAddress, userAgent, metadata })` à chaque opération
- Trigger PostgreSQL empêche UPDATE/DELETE sur AuditLog (immuabilité)
- Aucune valeur déchiffrée dans `metadata`

### RGPD
- Si données personnelles : mention dans la doc consentement
- Inclus dans l'export Article 15 (`/api/account/export`)
- Inclus dans la suppression Article 17 (`/api/account` DELETE)

---

## 🧪 Plan de test 3 niveaux

### Tests unitaires (Vitest)

- [ ] Schéma Zod valide les payloads conformes
- [ ] Schéma Zod rejette les payloads malformés (champs manquants, types incorrects, longueurs hors limites)
- [ ] Service métier lève l'exception attendue en cas de violation de règle (RM-1 à RM-3)

```bash
pnpm test src/lib/services/medecins-liberaux.test.ts
```

### Tests d'intégration (Vitest + Prisma + supertest)

- [ ] `/api/feature` renvoie 200 + payload conforme pour un cas nominal
- [ ] `/api/feature` renvoie 401 sans JWT valide
- [ ] `/api/feature` renvoie 403 avec un rôle insuffisant
- [ ] `/api/feature` renvoie 422 avec un payload invalide (schéma Zod)
- [ ] L'AuditLog contient bien une entrée correspondant à l'opération
- [ ] La transaction Prisma est atomique (rollback en cas d'erreur)

```bash
pnpm test:integration tests/integration/medecins-liberaux.test.ts
```

### Tests E2E (Playwright)

- [ ] Un utilisateur connecté avec le rôle requis peut accomplir le scénario nominal de bout en bout
- [ ] Un utilisateur sans permission voit un message d'erreur clair (pas d'erreur 500)
- [ ] Le scénario fonctionne en français ET en arabe (RTL) si UI
- [ ] Le scénario fonctionne sur Chromium, Firefox, et WebKit

```bash
pnpm test:e2e tests/e2e/medecins-liberaux.spec.ts
```

### Tests de sécurité

- [ ] Aucun secret n'est exposé dans les réponses API ni dans les logs
- [ ] Tentative d'injection SQL via les paramètres : aucune leak (ORM Prisma protège)
- [ ] Tentative XSS dans les champs textuels : encodage automatique React + sanitization
- [ ] CSRF : tokens vérifiés sur opérations mutantes (POST/PUT/DELETE)
- [ ] Headers de sécurité présents (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)

### Tests de conformité réglementaire

- [ ] L'AuditLog respecte la structure HDS (action, resource, IP, UA, timestamp ISO 8601)
- [ ] L'export RGPD Article 15 inclut bien les données de cette fonctionnalité
- [ ] L'effacement RGPD Article 17 supprime/anonymise correctement

### Couverture cible

| Niveau | Cible |
|---|---|
| Unitaires | ≥ 85% lignes |
| Intégration | 100% des routes API définies |
| E2E | 100% des AC énumérés ci-dessus |

---

## 📦 Définition de Done (DoD)

### Code & qualité
- [ ] Code review approuvée par 2 reviewers (dont 1 senior)
- [ ] Aucun `any` TypeScript (sauf cas exceptionnels documentés)
- [ ] Lint ESLint vert (`pnpm lint`)
- [ ] Tous les tests unitaires verts (`pnpm test`) avec couverture ≥ 85%
- [ ] Tous les tests d'intégration verts
- [ ] Tous les tests E2E verts (Chromium + Firefox + WebKit)
- [ ] Aucune régression sur les autres modules (CI green)

### Sécurité & conformité
- [ ] AuditLog enregistré pour toutes les actions sensibles
- [ ] Données de santé chiffrées AES-256-GCM si applicable
- [ ] Validation Zod sur tous les inputs API
- [ ] Headers de sécurité présents (CSP, HSTS, etc.)
- [ ] Pas de secret dans le code ni dans les commits (vérifié par `gitleaks`)
- [ ] Validation **healthcare-security-auditor** passée si HDS

### Documentation
- [ ] Documentation API à jour (OpenAPI/Swagger)
- [ ] CHANGELOG.md mis à jour
- [ ] `docs/architecture/` mis à jour si modèle de données impacté
- [ ] Captures d'écran ou GIF si UI nouvelle

### UX & accessibilité (si UI)
- [ ] WCAG 2.1 AA respecté (lint axe-core)
- [ ] Mobile-first (testé responsive)
- [ ] Support FR + AR (RTL) via next-intl
- [ ] Loading states + error states définis
- [ ] Empty states pédagogiques

### Performance
- [ ] p95 < 500ms sur les endpoints critiques (mesuré avec k6)
- [ ] Pas de N+1 query (vérifié via Prisma logs)
- [ ] Bundle size impact < 5kb gzipped si UI

### Validation métier
- [ ] Pas de validation médicale spécifique requise
- [ ] Acceptation produit / PO

### Pré-déploiement
- [ ] Migration Prisma testée sur dump de prod (staging)
- [ ] Plan de rollback documenté si feature flag impossible
- [ ] Variables d'environnement ajoutées dans `.env.example` et secrets manager
- [ ] Monitoring / alerting configuré (Sentry, métriques business)

---

## 📚 Ressources & références

- Documentation interne projet : `docs/architecture/`

### Fichiers projet probablement impactés
- `prisma/schema.prisma`
- `src/app/api/...`
- `src/lib/services/...`
- `src/lib/auth/...`
- `src/components/diabeo/...`
- `tests/...`
- `docs/architecture/...`

---

## 🔗 US liées

- Référence inventaire : `FN-118`
- Voir l'inventaire complet : `docs/Diabeo_Inventaire_Fonctionnalites.xlsx`

---

*Auto-généré depuis l'inventaire fonctionnel — affiner manuellement les sections selon la conception détaillée du sprint.*
