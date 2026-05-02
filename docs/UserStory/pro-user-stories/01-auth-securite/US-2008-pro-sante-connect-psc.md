# US-2008 — Pro Santé Connect (PSC)

> 📌 **1. Auth & Sécurité** · Priorité **V1** · Pays **FR**
> 
> 💬 **Note inventaire** : Auth officielle PS France


---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2008` |
| **Référence inventaire** | `FN-008` |
| **Domaine** | 1. Auth & Sécurité |
| **Priorité** | **V1** |
| **Pays cible** | FR |
| **Intégration externe** | Oui |
| **Service / Standard** | ANS — Pro Santé Connect |
| **Modèle économique** | Gratuit + homologation |
| **Coût estimé** | Audit ~5-15 k€ |
| **Statut** | 🆕 À démarrer |
| **Story points** | **8** (Fibonacci) |
| **Dépendances** | Aucune |
| **Sprint cible** | À définir lors du planning |
| **Owner** | À assigner |

---

## 📋 Contexte métier

### Pourquoi cette fonctionnalité ?

SSO médecin France via ANS

Cette fonctionnalité s'inscrit dans le domaine **1. Auth & Sécurité** de Diabeo BackOffice, plateforme de gestion de l'insulinothérapie certifiée HDS pour professionnels de santé. Elle contribue directement à la valeur clinique et opérationnelle livrée aux médecins, infirmières et administrateurs qui utilisent quotidiennement la plateforme pour suivre leurs patients diabétiques (Type 1, Type 2, gestationnel).

### Personas concernés

Tous les utilisateurs (ADMIN, DOCTOR, NURSE, VIEWER) + administrateurs systèmes

### Valeur produit

- **Pour le soignant** : gain de temps, fiabilité accrue, meilleure visibilité clinique
- **Pour le patient** : sécurité renforcée, qualité de soin améliorée, continuité du suivi
- **Pour le cabinet** : conformité réglementaire, productivité, traçabilité HDS

### 🌐 Intégration externe — ANS — Pro Santé Connect

| Aspect | Détail |
|---|---|
| **Service / standard** | ANS — Pro Santé Connect |
| **Modèle économique** | Gratuit + homologation |
| **Coût estimé** | Audit ~5-15 k€ |
| **Type d'intégration** | Oui (API REST / SDK / webhook selon fournisseur) |
| **Auth fournisseur** | OAuth2 / API Key / Mutual TLS — à confirmer en design |
| **Quota / rate limits** | À vérifier dans la doc fournisseur |
| **SLA fournisseur** | À cadrer contractuellement |
| **Fallback en cas d'indisponibilité** | Queue de retry + alerte ops + dégradation gracieuse |

**Prérequis légaux & contractuels** :
- Contrat / NDA signé avec le fournisseur
- Si fournisseur traite des données de santé : DPA (Data Processing Agreement) RGPD obligatoire
- Vérification certification HDS du sous-traitant si données patient transitent
- Inscription dans le registre des sous-traitants (RGPD Art. 28)


---

## ✅ Critères d'acceptation

### AC-1 — Accès autorisé respecté

```gherkin
Étant donné Un utilisateur authentifié avec le rôle requis
Quand il accède à la fonctionnalité « Pro Santé Connect (PSC) »
Alors l'action est autorisée et l'AuditLog enregistre l'accès
```

### AC-2 — Accès non autorisé bloqué

```gherkin
Étant donné Un utilisateur sans le rôle requis (ou non authentifié)
Quand il tente d'accéder à « Pro Santé Connect (PSC) »
Alors la requête est rejetée avec HTTP 401/403, et la tentative est journalisée
```

### AC-3 — Rate limiting actif

```gherkin
Étant donné Un client envoie plus de 5 tentatives en 1 minute
Quand les requêtes suivantes sont bloquées
Alors le système renvoie HTTP 429 avec un Retry-After et journalise l'IP
```

### AC-4 — Tolérance aux pannes externes

```gherkin
Étant donné Le service externe « ANS — Pro Santé Connect » est indisponible
Quand une opération nécessitant ce service est tentée
Alors le système renvoie une erreur explicite, ne perd pas de données et retry automatique configuré
```


---

## 📐 Règles métier

- **RM-1 : Tous les accès à cette fonctionnalité sont journalisés dans AuditLog (action, resource, resourceId, userId, ipAddress, userAgent).**
- **RM-2 : RBAC strict — seuls les rôles autorisés (voir AC-1) peuvent invoquer cette fonctionnalité.**
- **RM-3 : Les requêtes sont validées par un schéma Zod avant tout traitement métier.**
- **RM-7 : Aucun secret du fournisseur « ANS — Pro Santé Connect » n'est exposé côté client. Tous les appels passent par le backend.**
- **RM-8 : Les erreurs du fournisseur sont mappées en erreurs applicatives génériques (pas de fuite d'info).**

---

## 🗄️ Modèle de données

### Schéma Prisma indicatif

```prisma
model AuthAttempt {
  id          String   @id @default(cuid())
  userId      String?
  emailHmac   String   // HMAC pour lookup sans exposer email
  ipAddress   String
  userAgent   String
  success     Boolean
  failureCode String?
  createdAt   DateTime @default(now())

  @@index([emailHmac, createdAt])
  @@index([ipAddress, createdAt])
}

// Réutilise les modèles existants : User, Session, Account
// Voir prisma/schema.prisma — domaine "Utilisateurs & Auth" 
```

### Notes de migration

- Créer une migration Prisma dédiée : `pnpm prisma migrate dev --name pro-sante-connect-psc`
- Si nouveaux index : vérifier l'impact sur les performances avec `EXPLAIN ANALYZE`
- Si données existantes à migrer : prévoir un script de backfill idempotent dans `prisma/migrations/sql/`
- Mise à jour du seed si pertinent (`prisma/seed.ts`)

---

## 🔌 API & contrats

### Routes exposées

```
/api/auth
```

| Méthode | Endpoint | Auth | Rôles autorisés | Description |
|---------|----------|------|-----------------|-------------|
| GET     | `/api/auth` | JWT | Selon AC-1 | Liste / lecture |
| POST    | `/api/auth` | JWT | Selon AC-1 | Création |
| PUT     | `/api/auth/[id]` | JWT | Selon AC-1 | Modification |
| DELETE  | `/api/auth/[id]` | JWT | ADMIN/DOCTOR (selon RBAC) | Soft delete (RGPD) |

> ⚠️ Les méthodes ci-dessus sont indicatives. À ajuster lors de la conception détaillée selon la nature exacte de la fonctionnalité.

### Validation des entrées (Zod)

```typescript
import { z } from "zod"

export const pro_sante_connect_pscSchema = z.object({
  // À compléter selon la fonctionnalité
  // Exemples : id: z.string().cuid(), value: z.number().positive(), ...
})

export type ProsanteconnectpscInput = z.infer<typeof pro_sante_connect_pscSchema>
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
- [ ] Service métier lève l'exception attendue en cas de violation de règle (RM-1 à RM-5)

```bash
pnpm test src/lib/services/pro-sante-connect-psc.test.ts
```

### Tests d'intégration (Vitest + Prisma + supertest)

- [ ] `/api/auth` renvoie 200 + payload conforme pour un cas nominal
- [ ] `/api/auth` renvoie 401 sans JWT valide
- [ ] `/api/auth` renvoie 403 avec un rôle insuffisant
- [ ] `/api/auth` renvoie 422 avec un payload invalide (schéma Zod)
- [ ] L'AuditLog contient bien une entrée correspondant à l'opération
- [ ] La transaction Prisma est atomique (rollback en cas d'erreur)
- [ ] Un appel à « ANS — Pro Santé Connect » avec mock retourne le résultat attendu
- [ ] Une indisponibilité (mock 5xx) déclenche le retry avec backoff exponentiel
- [ ] Un timeout est géré sans crash et est journalisé avec context

```bash
pnpm test:integration tests/integration/pro-sante-connect-psc.test.ts
```

### Tests E2E (Playwright)

- [ ] Un utilisateur connecté avec le rôle requis peut accomplir le scénario nominal de bout en bout
- [ ] Un utilisateur sans permission voit un message d'erreur clair (pas d'erreur 500)
- [ ] Le scénario fonctionne en français ET en arabe (RTL) si UI
- [ ] Le scénario fonctionne sur Chromium, Firefox, et WebKit

```bash
pnpm test:e2e tests/e2e/pro-sante-connect-psc.spec.ts
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

- [JWT RS256 — jose library](https://github.com/panva/jose)
- [OWASP ASVS — Authentication](https://owasp.org/www-project-application-security-verification-standard/)
- [CNIL — RGPD santé](https://www.cnil.fr/fr/sante)
- Documentation officielle de **ANS — Pro Santé Connect** (à vérifier au démarrage)

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

- Référence inventaire : `FN-008`
- Voir l'inventaire complet : `docs/Diabeo_Inventaire_Fonctionnalites.xlsx`

---

*Auto-généré depuis l'inventaire fonctionnel — affiner manuellement les sections selon la conception détaillée du sprint.*
