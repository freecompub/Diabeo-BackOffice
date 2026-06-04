# US-2017 — Création / onboarding patient

> 📌 **2. Patients** · Priorité **MVP** · Pays **Universel**
> 

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2017` |
| **Référence inventaire** | `FN-017` |
| **Domaine** | 2. Patients |
| **Priorité** | **MVP** |
| **Pays cible** | Universel |
| **Intégration externe** | Non |
| **Service / Standard** | Interne |
| **Modèle économique** | Interne |
| **Coût estimé** | — |
| **Statut** | 🚧 PR ouverte ([#468](https://github.com/freecompub/Diabeo-BackOffice/pull/468)) — backend + UI livrés, en review |
| **Story points** | **1** (Fibonacci) |
| **Dépendances** | i18n `patients.*` ([#467](https://github.com/freecompub/Diabeo-BackOffice/pull/467)) · invitation mobile QR US-2025 (workflow complémentaire) |
| **Sprint cible** | Session dev 2026-06-03 |
| **Owner** | À assigner |

> ✅ **Implémenté (PR #468)** — la route `POST /api/patients` provisionne en une
> transaction atomique le **User backing** (compte VIEWER) ET le **Patient**.
> Le formulaire wizard 2 étapes `/patients/new` (déjà câblé) est désormais
> fonctionnel. Cette fiche, auto-générée depuis l'inventaire, est mise à jour
> ci-dessous pour refléter l'implémentation réelle (modèle, contrat API, erreurs,
> tests). Les sections génériques restantes valent recommandation.

---

## 📋 Contexte métier

### Pourquoi cette fonctionnalité ?

Formulaire structuré + validation

Cette fonctionnalité s'inscrit dans le domaine **2. Patients** de Diabeo BackOffice, plateforme de gestion de l'insulinothérapie certifiée HDS pour professionnels de santé. Elle contribue directement à la valeur clinique et opérationnelle livrée aux médecins, infirmières et administrateurs qui utilisent quotidiennement la plateforme pour suivre leurs patients diabétiques (Type 1, Type 2, gestationnel).

### Personas concernés

DOCTOR (création, modification), NURSE (consultation), ADMIN (audit), VIEWER (lecture seule)

### Valeur produit

- **Pour le soignant** : gain de temps, fiabilité accrue, meilleure visibilité clinique
- **Pour le patient** : sécurité renforcée, qualité de soin améliorée, continuité du suivi
- **Pour le cabinet** : conformité réglementaire, productivité, traçabilité HDS


---

## ✅ Critères d'acceptation

### AC-1 — Accès autorisé respecté

```gherkin
Étant donné Un utilisateur authentifié avec le rôle requis
Quand il accède à la fonctionnalité « Création / onboarding patient »
Alors l'action est autorisée et l'AuditLog enregistre l'accès
```

### AC-2 — Accès non autorisé bloqué

```gherkin
Étant donné Un utilisateur sans le rôle requis (ou non authentifié)
Quand il tente d'accéder à « Création / onboarding patient »
Alors la requête est rejetée avec HTTP 401/403, et la tentative est journalisée
```

### AC-3 — Données chiffrées en base

```gherkin
Étant donné Une opération « Création / onboarding patient » est effectuée
Quand les champs sensibles sont écrits en base
Alors ils sont chiffrés AES-256-GCM (jamais en clair)
```

### AC-4 — Soft delete RGPD respecté

```gherkin
Étant donné Une suppression est demandée
Quand elle est exécutée
Alors le record est anonymisé et marqué deletedAt (jamais DELETE physique)
```


---

## 📐 Règles métier

- **RM-1 : Tous les accès à cette fonctionnalité sont journalisés dans AuditLog (action, resource, resourceId, userId, ipAddress, userAgent).**
- **RM-2 : RBAC strict — seuls les rôles autorisés (voir AC-1) peuvent invoquer cette fonctionnalité.**
- **RM-3 : Les requêtes sont validées par un schéma Zod avant tout traitement métier.**
- **RM-4 : Toute donnée de santé en base est chiffrée AES-256-GCM (IV + TAG + ciphertext).**
- **RM-5 : Aucune valeur déchiffrée n'est journalisée ni renvoyée en réponse API non autorisée.**

---

## 🗄️ Modèle de données

### Schéma Prisma réel (aucune migration — modèles existants)

La création provisionne **un `User` + un `Patient`** liés 1:1. Les PII sont sur
`User` (chiffrées AES-256-GCM base64, lookup via `emailHmac`), la pathologie sur
`Patient`, l'année de diagnostic sur `PatientMedicalData`.

```prisma
model User {
  id               Int        @id @default(autoincrement())
  email            String     // chiffré AES-256-GCM (base64)
  emailHmac        String     @unique // HMAC-SHA256 → lookup unicité
  passwordHash     String     // bcrypt(12) — mot de passe temporaire random
  firstname        String?    // chiffré
  firstnameHmac    String?    // HMAC recherche
  lastname         String?    // chiffré
  lastnameHmac     String?
  sex              Sex?       // M | F | X
  birthday         DateTime?  @db.Date // stocké en clair (Date), pas chiffré
  role             Role       @default(VIEWER) // patient = VIEWER
  status           UserStatus @default(active)
  needPasswordUpdate Boolean  @default(false) // → true (invitation set-password)
  needOnboarding   Boolean    @default(false)  // → true
  patient          Patient?
}

model Patient {
  id        Int       @id @default(autoincrement())
  userId    Int       @unique
  pathology Pathology // DT1 | DT2 | GD
  deletedAt DateTime? // soft delete RGPD (trigger PG)
}

model PatientMedicalData {
  patientId Int  @unique
  yearDiag  Int? // année de diagnostic (optionnel)
}
```

### Notes de migration

- **Aucune migration** : la feature réutilise les modèles existants `User`,
  `Patient`, `PatientMedicalData`, `VerificationToken`.
- Invitation set-password : un `VerificationToken` (clé `emailHmac`, TTL 1h) est
  créé dans la même transaction — même mécanisme que `POST /api/auth/reset-password`.

---

## 🔌 API & contrats

### Routes exposées

```
/api/patients
```

| Méthode | Endpoint | Auth | Rôles autorisés | Description |
|---------|----------|------|-----------------|-------------|
| GET     | `/api/patients` | JWT | NURSE+ | Liste des patients du pro connecté |
| POST    | `/api/patients` | JWT | **NURSE+** | **Création User + Patient (PR #468)** |
| PUT     | `/api/patients/[id]` | JWT | NURSE+ (contrôle service) | Modification (US-2200, existant) |
| DELETE  | `/api/patients/[id]` | JWT | — | Soft delete RGPD (US-2020) — hors scope cette US |

**Réponse `POST` (201)** : `{ "id": number, "pathology": "DT1"|"DT2"|"GD" }`.
Le `resetToken` et le `userId` ne sont **jamais** renvoyés au client. Un email
d'invitation (lien set-password) est envoyé best-effort après commit (un échec
d'envoi ne rollback pas le patient). L'invitation mobile QR reste disponible via
`POST /api/patients/[id]/invite` (US-2025).

### Validation des entrées (Zod) — implémentée dans `src/app/api/patients/route.ts`

```typescript
import { z } from "zod"

const createPatientSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  sex: z.enum(["M", "F", "X"]).optional(),
  birthday: z.coerce.date()
    .refine((d) => d.getFullYear() >= 1900 && d <= new Date())
    .optional(),
  pathology: z.enum(["DT1", "DT2", "GD"]),
  yearDiag: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
})
```

Service : `patientService.createWithNewUser(input, auditUserId, ctx)`
(`src/lib/services/patient.service.ts`).

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

### Codes réels `POST /api/patients` (PR #468)

| HTTP | `error` | Déclencheur |
|------|---------|-------------|
| 400 | `validationFailed` | Body Zod invalide ou JSON malformé |
| 401 | `unauthorized` | JWT absent/invalide |
| 403 | `forbidden` | Rôle < NURSE |
| 409 | `emailExists` | Email déjà utilisé (pré-check + contrainte unique `emailHmac`, race P2002) |
| 413 | `payloadTooLarge` | `Content-Length` > 16KB |
| 415 | `unsupportedMediaType` | `Content-Type` ≠ `application/json` |
| 500 | `serverError` | Erreur inattendue (jamais de stack trace exposée) |

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

> **État (PR #468)** : 8 tests unit service (`tests/unit/patient-create-with-user.service.test.ts`)
> + 9 tests intégration route (`tests/integration/api-patients-create.test.ts`).
> Couvrent chiffrement email/noms, flags VIEWER/onboarding, token invitation,
> audit CREATE USER+PATIENT, P2002→emailExists, RBAC 401/403, 415/413/400/409,
> email best-effort et non-fuite du `resetToken`. `tsc` + `eslint` verts.
> E2E Playwright du wizard `/patients/new` : follow-up.

### Tests unitaires (Vitest)

- [ ] Schéma Zod valide les payloads conformes
- [ ] Schéma Zod rejette les payloads malformés (champs manquants, types incorrects, longueurs hors limites)
- [ ] Service métier lève l'exception attendue en cas de violation de règle (RM-1 à RM-5)
- [ ] Le chiffrement AES-256-GCM produit un cipher différent à chaque appel (IV aléatoire)
- [ ] Le déchiffrement restitue exactement le plaintext d'origine
- [ ] Une tentative de déchiffrement avec un TAG modifié lève une AuthenticationError

```bash
pnpm test src/lib/services/creation-onboarding-patient.test.ts
```

### Tests d'intégration (Vitest + Prisma + supertest)

- [ ] `/api/patients` renvoie 200 + payload conforme pour un cas nominal
- [ ] `/api/patients` renvoie 401 sans JWT valide
- [ ] `/api/patients` renvoie 403 avec un rôle insuffisant
- [ ] `/api/patients` renvoie 422 avec un payload invalide (schéma Zod)
- [ ] L'AuditLog contient bien une entrée correspondant à l'opération
- [ ] La transaction Prisma est atomique (rollback en cas d'erreur)

```bash
pnpm test:integration tests/integration/creation-onboarding-patient.test.ts
```

### Tests E2E (Playwright)

- [ ] Un utilisateur connecté avec le rôle requis peut accomplir le scénario nominal de bout en bout
- [ ] Un utilisateur sans permission voit un message d'erreur clair (pas d'erreur 500)
- [ ] Le scénario fonctionne en français ET en arabe (RTL) si UI
- [ ] Le scénario fonctionne sur Chromium, Firefox, et WebKit

```bash
pnpm test:e2e tests/e2e/creation-onboarding-patient.spec.ts
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
- [ ] Pas de validation médicale spécifique requise
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

- Référence inventaire : `FN-017`
- Voir l'inventaire complet : `docs/Diabeo_Inventaire_Fonctionnalites.xlsx`

---

*Auto-généré depuis l'inventaire fonctionnel — affiner manuellement les sections selon la conception détaillée du sprint.*
