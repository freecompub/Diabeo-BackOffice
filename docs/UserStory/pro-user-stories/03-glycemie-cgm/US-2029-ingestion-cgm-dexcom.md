# US-2029 — Ingestion CGM Dexcom

> 📌 **3. Glycémie & CGM** · Priorité **MVP** · Pays **FR+DZ**
> 
> 💬 **Note inventaire** : Tables prêtes, integration à faire


---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2029` |
| **Référence inventaire** | `FN-029` |
| **Domaine** | 3. Glycémie & CGM |
| **Priorité** | **MVP** |
| **Pays cible** | FR+DZ |
| **Intégration externe** | Oui |
| **Service / Standard** | Dexcom API (developer partner) |
| **Modèle économique** | Gratuit (partenariat) |
| **Coût estimé** | Accord NDA Dexcom |
| **Statut** | 🆕 À démarrer |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | US-2018 (Fiche patient) |
| **Sprint cible** | À définir lors du planning |
| **Owner** | À assigner |

---

## 📋 Contexte métier

### Pourquoi cette fonctionnalité ?

Sync avec Dexcom Share/Clarity

Cette fonctionnalité s'inscrit dans le domaine **3. Glycémie & CGM** de Diabeo BackOffice, plateforme de gestion de l'insulinothérapie certifiée HDS pour professionnels de santé. Elle contribue directement à la valeur clinique et opérationnelle livrée aux médecins, infirmières et administrateurs qui utilisent quotidiennement la plateforme pour suivre leurs patients diabétiques (Type 1, Type 2, gestationnel).

### Personas concernés

DOCTOR et NURSE pour interprétation clinique, patient via app iOS pour saisie

### Valeur produit

- **Pour le soignant** : gain de temps, fiabilité accrue, meilleure visibilité clinique
- **Pour le patient** : sécurité renforcée, qualité de soin améliorée, continuité du suivi
- **Pour le cabinet** : conformité réglementaire, productivité, traçabilité HDS

### 🌐 Intégration externe — Dexcom API (developer partner)

| Aspect | Détail |
|---|---|
| **Service / standard** | Dexcom API (developer partner) |
| **Modèle économique** | Gratuit (partenariat) |
| **Coût estimé** | Accord NDA Dexcom |
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
Quand il accède à la fonctionnalité « Ingestion CGM Dexcom »
Alors l'action est autorisée et l'AuditLog enregistre l'accès
```

### AC-2 — Accès non autorisé bloqué

```gherkin
Étant donné Un utilisateur sans le rôle requis (ou non authentifié)
Quand il tente d'accéder à « Ingestion CGM Dexcom »
Alors la requête est rejetée avec HTTP 401/403, et la tentative est journalisée
```

### AC-3 — Ingestion CGM idempotente

```gherkin
Étant donné Le même point CGM est envoyé deux fois
Quand le système le reçoit
Alors un seul enregistrement est créé (déduplication par patientId+timestamp+device)
```

### AC-4 — Conversion d'unités cohérente

```gherkin
Étant donné Une donnée glycémique en mg/dL est reçue
Quand elle est affichée dans une UI configurée en g/L
Alors la conversion est exacte au centième et clairement labelée
```

### AC-5 — Tolérance aux pannes externes

```gherkin
Étant donné Le service externe « Dexcom API (developer partner) » est indisponible
Quand une opération nécessitant ce service est tentée
Alors le système renvoie une erreur explicite, ne perd pas de données et retry automatique configuré
```


---

## 📐 Règles métier

- **RM-1 : Tous les accès à cette fonctionnalité sont journalisés dans AuditLog (action, resource, resourceId, userId, ipAddress, userAgent).**
- **RM-2 : RBAC strict — seuls les rôles autorisés (voir AC-1) peuvent invoquer cette fonctionnalité.**
- **RM-3 : Les requêtes sont validées par un schéma Zod avant tout traitement métier.**
- **RM-4 : Toute donnée de santé en base est chiffrée AES-256-GCM (IV + TAG + ciphertext).**
- **RM-5 : Aucune valeur déchiffrée n'est journalisée ni renvoyée en réponse API non autorisée.**
- **RM-7 : Aucun secret du fournisseur « Dexcom API (developer partner) » n'est exposé côté client. Tous les appels passent par le backend.**
- **RM-8 : Les erreurs du fournisseur sont mappées en erreurs applicatives génériques (pas de fuite d'info).**

---

## 🗄️ Modèle de données

### Schéma Prisma indicatif

```prisma
model CgmEntry {
  id            String   @id @default(cuid())
  patientId     String
  timestamp     DateTime
  glucoseMgdl   Float
  trend         GlucoseTrend?
  deviceId      String
  rawDataEnc    Bytes?  // Données brutes chiffrées
  createdAt     DateTime @default(now())

  patient       Patient  @relation(fields: [patientId], references: [id])
  device        PatientDevice @relation(fields: [deviceId], references: [id])

  @@index([patientId, timestamp])
  @@index([deviceId, timestamp])
}

// CGM entries sont partitionnées par mois — voir prisma/sql/cgm_partitioning.sql
```

### Notes de migration

- Créer une migration Prisma dédiée : `pnpm prisma migrate dev --name ingestion-cgm-dexcom`
- Si nouveaux index : vérifier l'impact sur les performances avec `EXPLAIN ANALYZE`
- Si données existantes à migrer : prévoir un script de backfill idempotent dans `prisma/migrations/sql/`
- Mise à jour du seed si pertinent (`prisma/seed.ts`)

---

## 🔌 API & contrats

### Routes exposées

```
/api/patients/[id]/cgm
```

| Méthode | Endpoint | Auth | Rôles autorisés | Description |
|---------|----------|------|-----------------|-------------|
| GET     | `/api/patients/[id]/cgm` | JWT | Selon AC-1 | Liste / lecture |
| POST    | `/api/patients/[id]/cgm` | JWT | Selon AC-1 | Création |
| PUT     | `/api/patients/[id]/cgm/[id]` | JWT | Selon AC-1 | Modification |
| DELETE  | `/api/patients/[id]/cgm/[id]` | JWT | ADMIN/DOCTOR (selon RBAC) | Soft delete (RGPD) |

> ⚠️ Les méthodes ci-dessus sont indicatives. À ajuster lors de la conception détaillée selon la nature exacte de la fonctionnalité.

### Validation des entrées (Zod)

```typescript
import { z } from "zod"

export const ingestion_cgm_dexcomSchema = z.object({
  // À compléter selon la fonctionnalité
  // Exemples : id: z.string().cuid(), value: z.number().positive(), ...
})

export type IngestioncgmdexcomInput = z.infer<typeof ingestion_cgm_dexcomSchema>
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
- [ ] Service métier lève l'exception attendue en cas de violation de règle (RM-1 à RM-7)
- [ ] Le chiffrement AES-256-GCM produit un cipher différent à chaque appel (IV aléatoire)
- [ ] Le déchiffrement restitue exactement le plaintext d'origine
- [ ] Une tentative de déchiffrement avec un TAG modifié lève une AuthenticationError

```bash
pnpm test src/lib/services/ingestion-cgm-dexcom.test.ts
```

### Tests d'intégration (Vitest + Prisma + supertest)

- [ ] `/api/patients/[id]/cgm` renvoie 200 + payload conforme pour un cas nominal
- [ ] `/api/patients/[id]/cgm` renvoie 401 sans JWT valide
- [ ] `/api/patients/[id]/cgm` renvoie 403 avec un rôle insuffisant
- [ ] `/api/patients/[id]/cgm` renvoie 422 avec un payload invalide (schéma Zod)
- [ ] L'AuditLog contient bien une entrée correspondant à l'opération
- [ ] La transaction Prisma est atomique (rollback en cas d'erreur)
- [ ] Un appel à « Dexcom API (developer partner) » avec mock retourne le résultat attendu
- [ ] Une indisponibilité (mock 5xx) déclenche le retry avec backoff exponentiel
- [ ] Un timeout est géré sans crash et est journalisé avec context

```bash
pnpm test:integration tests/integration/ingestion-cgm-dexcom.test.ts
```

### Tests E2E (Playwright)

- [ ] Un utilisateur connecté avec le rôle requis peut accomplir le scénario nominal de bout en bout
- [ ] Un utilisateur sans permission voit un message d'erreur clair (pas d'erreur 500)
- [ ] Le scénario fonctionne en français ET en arabe (RTL) si UI
- [ ] Le scénario fonctionne sur Chromium, Firefox, et WebKit

```bash
pnpm test:e2e tests/e2e/ingestion-cgm-dexcom.spec.ts
```

### Tests de sécurité

- [ ] Aucun secret n'est exposé dans les réponses API ni dans les logs
- [ ] Tentative d'injection SQL via les paramètres : aucune leak (ORM Prisma protège)
- [ ] Tentative XSS dans les champs textuels : encodage automatique React + sanitization
- [ ] CSRF : tokens vérifiés sur opérations mutantes (POST/PUT/DELETE)
- [ ] Headers de sécurité présents (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- [ ] Test de fuite données : aucune donnée déchiffrée n'apparaît dans les logs applicatifs

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
- [ ] Validation **medical-domain-validator** si logique clinique
- [ ] Acceptation produit / PO

### Pré-déploiement
- [ ] Migration Prisma testée sur dump de prod (staging)
- [ ] Plan de rollback documenté si feature flag impossible
- [ ] Variables d'environnement ajoutées dans `.env.example` et secrets manager
- [ ] Monitoring / alerting configuré (Sentry, métriques business)

---

## 📚 Ressources & références

- [Référentiel HDS ANS](https://esante.gouv.fr/produits-services/hds)
- [Node.js Crypto — AES-256-GCM](https://nodejs.org/api/crypto.html)
- [CNIL — RGPD santé](https://www.cnil.fr/fr/sante)
- Documentation officielle de **Dexcom API (developer partner)** (à vérifier au démarrage)

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

- Référence inventaire : `FN-029`
- Voir l'inventaire complet : `docs/Diabeo_Inventaire_Fonctionnalites.xlsx`

---

*Auto-généré depuis l'inventaire fonctionnel — affiner manuellement les sections selon la conception détaillée du sprint.*
