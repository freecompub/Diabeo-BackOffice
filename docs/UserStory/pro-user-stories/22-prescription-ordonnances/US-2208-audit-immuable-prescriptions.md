# US-2208 — Audit immuable prescriptions

> 📌 **22. Prescription & ordonnances** · Priorité **V1** · Pays **FR**
> 
> 💬 **Note inventaire** : Réglementaire


---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2208` |
| **Référence inventaire** | `FN-208` |
| **Domaine** | 22. Prescription & ordonnances |
| **Priorité** | **V1** |
| **Pays cible** | FR |
| **Intégration externe** | Non |
| **Service / Standard** | Interne (AuditLog) |
| **Modèle économique** | Interne |
| **Coût estimé** | — |
| **Statut** | 🆕 À démarrer |
| **Story points** | **1** (Fibonacci) |
| **Dépendances** | US-2001 (Login JWT), US-2011 (Audit log immuable), US-2169 (Éditeur ordonnance structurée) |
| **Sprint cible** | À définir lors du planning |
| **Owner** | À assigner |

---

## 📋 Contexte métier

### Pourquoi cette fonctionnalité ?

Conservation 10 ans / 30 ans mineurs

Cette fonctionnalité s'inscrit dans le domaine **22. Prescription & ordonnances** de Diabeo BackOffice, plateforme de gestion de l'insulinothérapie certifiée HDS pour professionnels de santé. Elle contribue directement à la valeur clinique et opérationnelle livrée aux médecins, infirmières et administrateurs qui utilisent quotidiennement la plateforme pour suivre leurs patients diabétiques (Type 1, Type 2, gestationnel).

### Personas concernés

DOCTOR (prescripteur), pharmacien (délivrance), patient

### Valeur produit

- **Pour le soignant** : gain de temps, fiabilité accrue, meilleure visibilité clinique
- **Pour le patient** : sécurité renforcée, qualité de soin améliorée, continuité du suivi
- **Pour le cabinet** : conformité réglementaire, productivité, traçabilité HDS


---

## ✅ Critères d'acceptation

### AC-1 — Accès autorisé respecté

```gherkin
Étant donné Un utilisateur authentifié avec le rôle requis
Quand il accède à la fonctionnalité « Audit immuable prescriptions »
Alors l'action est autorisée et l'AuditLog enregistre l'accès
```

### AC-2 — Accès non autorisé bloqué

```gherkin
Étant donné Un utilisateur sans le rôle requis (ou non authentifié)
Quand il tente d'accéder à « Audit immuable prescriptions »
Alors la requête est rejetée avec HTTP 401/403, et la tentative est journalisée
```

### AC-3 — Verrouillage post-signature

```gherkin
Étant donné Une ordonnance est signée électroniquement
Quand un utilisateur tente de la modifier
Alors la modification est refusée, seule l'annulation+nouvelle ordo est possible
```

### AC-4 — Mention non substituable avec motif

```gherkin
Étant donné Une ligne est marquée non substituable
Quand le médecin tente de signer
Alors la signature est refusée tant qu'aucun motif n'est saisi
```


---

## 📐 Règles métier

- **RM-1 : Tous les accès à cette fonctionnalité sont journalisés dans AuditLog (action, resource, resourceId, userId, ipAddress, userAgent).**
- **RM-2 : RBAC strict — seuls les rôles autorisés (voir AC-1) peuvent invoquer cette fonctionnalité.**
- **RM-3 : Les requêtes sont validées par un schéma Zod avant tout traitement métier.**
- **RM-4 : Toute donnée de santé en base est chiffrée AES-256-GCM (IV + TAG + ciphertext).**
- **RM-5 : Aucune valeur déchiffrée n'est journalisée ni renvoyée en réponse API non autorisée.**
- **RM-6 : Conservation conforme HDS (6 ans logs, 10/30 ans documents médicaux).**

---

## 🗄️ Modèle de données

### Schéma Prisma indicatif

```prisma
model Prescription {
  id                  String   @id @default(cuid())
  patientId           String
  prescriberId        String   // User.id, doit avoir RPPS
  cabinetId           String
  status              PrescriptionStatus @default(DRAFT)
  // DRAFT | SIGNED | TRANSMITTED | DISPENSED | CANCELLED | EXPIRED | RENEWED
  numberSequential    String   @unique  // FR-RX-2026-000001
  cerfaType           CerfaType?  // BIZONE_ALD | STANDARD | STUPEFIANT
  isAld               Boolean  @default(false)  // ALD 8 = diabète
  signedAt            DateTime?
  signatureType       SignatureType?  // CPS | E_CPS | EIDAS_QUALIFIED
  signatureHash       String?  // SHA-256 du document signé
  twoDDocPayload      String?  // 2D-Doc ANTS
  pdfUrl              String?
  pdfHash             String?
  expiresAt           DateTime?
  cancelledReason     String?

  bdmReference        String?  // Référence base médicamenteuse utilisée (Vidal/BCB/...)
  bdmVersion          String?  // Version BdM au moment de la prescription

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  patient             Patient  @relation(fields: [patientId], references: [id])
  prescriber          User     @relation(fields: [prescriberId], references: [id])
  lines               PrescriptionLine[]

  @@index([patientId, status])
  @@index([prescriberId, createdAt])
  @@index([cabinetId, status])
}

model PrescriptionLine {
  id              String   @id @default(cuid())
  prescriptionId  String
  drugCisCode     String   // Code CIS de la BdM
  drugName        String   // Nom commercial / DCI
  posology        String   // Texte structuré
  durationDays    Int
  quantity        Int
  isNonSubstitutable Boolean @default(false)
  nonSubstitutableReason String?

  prescription    Prescription @relation(fields: [prescriptionId], references: [id])
}
```

### Notes de migration

- Créer une migration Prisma dédiée : `pnpm prisma migrate dev --name audit-immuable-prescriptions`
- Si nouveaux index : vérifier l'impact sur les performances avec `EXPLAIN ANALYZE`
- Si données existantes à migrer : prévoir un script de backfill idempotent dans `prisma/migrations/sql/`
- Mise à jour du seed si pertinent (`prisma/seed.ts`)

---

## 🔌 API & contrats

### Routes exposées

```
/api/prescriptions
```

| Méthode | Endpoint | Auth | Rôles autorisés | Description |
|---------|----------|------|-----------------|-------------|
| GET     | `/api/prescriptions` | JWT | Selon AC-1 | Liste / lecture |
| POST    | `/api/prescriptions` | JWT | Selon AC-1 | Création |
| PUT     | `/api/prescriptions/[id]` | JWT | Selon AC-1 | Modification |
| DELETE  | `/api/prescriptions/[id]` | JWT | ADMIN/DOCTOR (selon RBAC) | Soft delete (RGPD) |

> ⚠️ Les méthodes ci-dessus sont indicatives. À ajuster lors de la conception détaillée selon la nature exacte de la fonctionnalité.

### Validation des entrées (Zod)

```typescript
import { z } from "zod"

export const audit_immuable_prescriptionsSchema = z.object({
  // À compléter selon la fonctionnalité
  // Exemples : id: z.string().cuid(), value: z.number().positive(), ...
})

export type AuditimmuableprescriptionsInput = z.infer<typeof audit_immuable_prescriptionsSchema>
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
- [ ] Service métier lève l'exception attendue en cas de violation de règle (RM-1 à RM-6)
- [ ] Le chiffrement AES-256-GCM produit un cipher différent à chaque appel (IV aléatoire)
- [ ] Le déchiffrement restitue exactement le plaintext d'origine
- [ ] Une tentative de déchiffrement avec un TAG modifié lève une AuthenticationError

```bash
pnpm test src/lib/services/audit-immuable-prescriptions.test.ts
```

### Tests d'intégration (Vitest + Prisma + supertest)

- [ ] `/api/prescriptions` renvoie 200 + payload conforme pour un cas nominal
- [ ] `/api/prescriptions` renvoie 401 sans JWT valide
- [ ] `/api/prescriptions` renvoie 403 avec un rôle insuffisant
- [ ] `/api/prescriptions` renvoie 422 avec un payload invalide (schéma Zod)
- [ ] L'AuditLog contient bien une entrée correspondant à l'opération
- [ ] La transaction Prisma est atomique (rollback en cas d'erreur)

```bash
pnpm test:integration tests/integration/audit-immuable-prescriptions.test.ts
```

### Tests E2E (Playwright)

- [ ] Un utilisateur connecté avec le rôle requis peut accomplir le scénario nominal de bout en bout
- [ ] Un utilisateur sans permission voit un message d'erreur clair (pas d'erreur 500)
- [ ] Le scénario fonctionne en français ET en arabe (RTL) si UI
- [ ] Le scénario fonctionne sur Chromium, Firefox, et WebKit

```bash
pnpm test:e2e tests/e2e/audit-immuable-prescriptions.spec.ts
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
- [ ] L'ordonnance générée est conforme au format CERFA bizone si ALD
- [ ] Le 2D-Doc ANTS est correctement encodé et vérifiable
- [ ] La numérotation séquentielle ne présente aucun trou

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

- [CNIL — RGPD santé](https://www.cnil.fr/fr/sante)
- [HAS — Certification LAP](https://www.has-sante.fr/)
- [ANS — Service e-Prescription](https://esante.gouv.fr/)
- [Décret 2019-856 — LAP](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000038919073)

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

- Référence inventaire : `FN-208`
- Voir l'inventaire complet : `docs/Diabeo_Inventaire_Fonctionnalites.xlsx`

---

*Auto-généré depuis l'inventaire fonctionnel — affiner manuellement les sections selon la conception détaillée du sprint.*
