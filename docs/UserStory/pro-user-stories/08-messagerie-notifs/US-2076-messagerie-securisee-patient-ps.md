# US-2076 — Messagerie sécurisée patient↔PS (et staff↔staff)

> 📌 **8. Messagerie & notifs** · Priorité **V1** · Pays **Universel**
>
> 🔄 **Mis à jour 2026-05-13** (session Samir, Q2 + Q9) :
>  - Étendu pour couvrir aussi la coordination staff↔staff (utilisé par US-2408).
>  - Architecture temps réel tranchée : **approche combinée A+B**
>    (WebSocket pendant l'écran chat + polling 60s badge + FCM push offline).

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2076` |
| **Référence inventaire** | `FN-076` |
| **Domaine** | 8. Messagerie & notifs |
| **Priorité** | **V1** |
| **Pays cible** | Universel |
| **Intégration externe** | Non |
| **Service / Standard** | Interne (WebSocket + polling + FCM + chiffrement AES-256-GCM) |
| **Modèle économique** | Interne |
| **Coût estimé** | — |
| **Statut** | 🆕 À démarrer |
| **Story points** | **13** (Fibonacci) — bumpé depuis 1 SP suite décision archi temps réel session Samir 2026-05-13 |
| **Dépendances** | US-2001 (Login JWT), US-2011 (Audit log immuable), **US-2073 (Push FCM, DONE PR #340)**, **US-2015 (Chiffrement AES-256-GCM, DONE)** |
| **Sprint cible** | À définir lors du planning |
| **Owner** | À assigner |

---

## 🏗️ Architecture temps réel (décision session Samir 2026-05-13)

**Approche combinée A+B** — pattern Slack/WhatsApp adapté HDS :

| Contexte utilisateur | Mécanisme | Latence |
|---|---|---|
| **Écran `/messages` ouvert (web)** | WebSocket — connexion ouverte au mount, fermée au unmount | < 100 ms |
| **Autres écrans web** (dashboard, fiche patient) | Polling `GET /api/messages/unread-count` toutes les 60s — badge sidebar | < 60s |
| **App iOS ouverte** | FCM data-only via US-2073 — MAJ badge tabbar | < 1s |
| **User offline** (téléphone éteint) | FCM lockscreen notif — réveille au reconnect | dépend du device |

### Détails d'implémentation

```typescript
// Côté server — quand Alice envoie un msg à Bob
async function sendMessage(from, to, encryptedText) {
  await prisma.message.create({ data: { from, to, encryptedText } })
  await auditService.log({ ... })

  // 1. Broadcast WS aux clients web de Bob (room = userId)
  wsHub.publishToUser(to.id, { type: "new-message", id, from, preview })

  // 2. Push FCM en parallèle (via US-2073) — couvre mobile + multi-device
  await fcmService.sendToUser(to.id, {
    title: from.name,
    body: "[message chiffré]",  // jamais de PHI lockscreen
    data: { messageId: id },
  })
}

// Côté client — écran /messages monté
useEffect(() => {
  const ws = new WebSocket("/api/ws/messages")
  ws.onmessage = (e) => addMessage(JSON.parse(e.data))
  return () => ws.close()  // ferme au unmount
}, [])

// Côté client — sidebar (badge unread, présent sur toutes les pages)
useEffect(() => {
  const id = setInterval(() => {
    fetch("/api/messages/unread-count").then(r => r.json()).then(setBadge)
  }, 60_000)
  return () => clearInterval(id)
}, [])
```

### Pourquoi pas WebSocket partout

Avoir N WS persistantes pour N utilisateurs connectés (même non-actifs sur le chat) consomme ~50 Ko RAM/user et 1 file descriptor. Pour 500 users connectés simultanément :
- WS partout : 500 × 50 Ko = **25 Mo RAM** + 500 FD + nginx config WS pour tous
- **WS chat-only** : ~50 WS actives (10% des connectés sur l'écran chat) = **2.5 Mo RAM** + 50 FD

Le badge unread mis à jour à 60s n'est pas critique — l'utilisateur ne fixe pas le sidebar en attendant.

### Pourquoi FCM en parallèle (B)

- **Multi-device** : un médecin peut avoir web ouvert ET app iOS sur son téléphone → FCM réveille les deux
- **Offline** : si l'utilisateur ferme le navigateur, FCM lockscreen le notifie
- **Coût** : FCM est déjà construit (US-2073 DONE PR #340), donc câblage ≈ 1 heure

### Risque doublon notification

Si Bob a web ouvert + app iOS → il voit la notif 2 fois.
**Mitigation** : marquer "vu" instantanément via WS → FCM mobile vérifie au receive si `metadata.readAt` est set → supprime silencieusement (pattern `data-only` FCM, US-2073 le supporte).

### Capacité serveur (sizing)

| Users connectés simultanément | RAM WS chat-only | Conn. WS | FD utilisés |
|---|---|---|---|
| 100 | 0.5 Mo | 10 | 10 / 1024 |
| 500 | 2.5 Mo | 50 | 50 / 1024 |
| 5 000 | 25 Mo | 500 | 500 / **8192** (bump ulimit) |
| 50 000 | 250 Mo | 5 000 | 5 000 / **65536** + **Redis pub/sub multi-server** |

Pour Diabeo (< 500 users actifs prévus à court terme), **1 seul VPS Next.js suffit**. Sticky session / Redis pub/sub à prévoir uniquement si > 5k.

---

## 🔐 Sécurité HDS

- Corps de message chiffré AES-256-GCM (US-2015) — clé stockée hors DB
- `requireRole(NURSE+)` pour staff↔staff (US-2408), `requireAuth` pour patient↔PS
- Audit log à chaque envoi/lecture (`resource: "MESSAGE"`, `metadata.patientId` pivot US-2268)
- FCM payload contient `[message chiffré]` placeholder — jamais de PHI lockscreen (vérifié par US-2073 audit)
- WS authentifié via cookie httpOnly (pas de JWT dans le query string)
- Rate-limit `wsHub.publishToUser` : max 100 msgs/min/userId pour éviter spam déni de service

---

## 🔗 US dépendantes

- **US-2408** — Coordination équipe (infirmier) : ré-utilise ce module messagerie pour staff↔staff
- **Futures** : annonces broadcast cabinet, messagerie groupe (V2+)

---

## 📋 Contexte métier

### Pourquoi cette fonctionnalité ?

Chat HDS-conforme

Cette fonctionnalité s'inscrit dans le domaine **8. Messagerie & notifs** de Diabeo BackOffice, plateforme de gestion de l'insulinothérapie certifiée HDS pour professionnels de santé. Elle contribue directement à la valeur clinique et opérationnelle livrée aux médecins, infirmières et administrateurs qui utilisent quotidiennement la plateforme pour suivre leurs patients diabétiques (Type 1, Type 2, gestationnel).

### Personas concernés

Tous les rôles + patients via app

### Valeur produit

- **Pour le soignant** : gain de temps, fiabilité accrue, meilleure visibilité clinique
- **Pour le patient** : sécurité renforcée, qualité de soin améliorée, continuité du suivi
- **Pour le cabinet** : conformité réglementaire, productivité, traçabilité HDS


---

## ✅ Critères d'acceptation

### AC-1 — Accès autorisé respecté

```gherkin
Étant donné Un utilisateur authentifié avec le rôle requis
Quand il accède à la fonctionnalité « Messagerie sécurisée patient↔PS »
Alors l'action est autorisée et l'AuditLog enregistre l'accès
```

### AC-2 — Accès non autorisé bloqué

```gherkin
Étant donné Un utilisateur sans le rôle requis (ou non authentifié)
Quand il tente d'accéder à « Messagerie sécurisée patient↔PS »
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

- Créer une migration Prisma dédiée : `pnpm prisma migrate dev --name messagerie-securisee-patient-ps`
- Si nouveaux index : vérifier l'impact sur les performances avec `EXPLAIN ANALYZE`
- Si données existantes à migrer : prévoir un script de backfill idempotent dans `prisma/migrations/sql/`
- Mise à jour du seed si pertinent (`prisma/seed.ts`)

---

## 🔌 API & contrats

### Routes exposées

```
/api/notifications
```

| Méthode | Endpoint | Auth | Rôles autorisés | Description |
|---------|----------|------|-----------------|-------------|
| GET     | `/api/notifications` | JWT | Selon AC-1 | Liste / lecture |
| POST    | `/api/notifications` | JWT | Selon AC-1 | Création |
| PUT     | `/api/notifications/[id]` | JWT | Selon AC-1 | Modification |
| DELETE  | `/api/notifications/[id]` | JWT | ADMIN/DOCTOR (selon RBAC) | Soft delete (RGPD) |

> ⚠️ Les méthodes ci-dessus sont indicatives. À ajuster lors de la conception détaillée selon la nature exacte de la fonctionnalité.

### Validation des entrées (Zod)

```typescript
import { z } from "zod"

export const messagerie_securisee_patient_psSchema = z.object({
  // À compléter selon la fonctionnalité
  // Exemples : id: z.string().cuid(), value: z.number().positive(), ...
})

export type MessageriesecuriseepatientpsInput = z.infer<typeof messagerie_securisee_patient_psSchema>
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
pnpm test src/lib/services/messagerie-securisee-patient-ps.test.ts
```

### Tests d'intégration (Vitest + Prisma + supertest)

- [ ] `/api/notifications` renvoie 200 + payload conforme pour un cas nominal
- [ ] `/api/notifications` renvoie 401 sans JWT valide
- [ ] `/api/notifications` renvoie 403 avec un rôle insuffisant
- [ ] `/api/notifications` renvoie 422 avec un payload invalide (schéma Zod)
- [ ] L'AuditLog contient bien une entrée correspondant à l'opération
- [ ] La transaction Prisma est atomique (rollback en cas d'erreur)

```bash
pnpm test:integration tests/integration/messagerie-securisee-patient-ps.test.ts
```

### Tests E2E (Playwright)

- [ ] Un utilisateur connecté avec le rôle requis peut accomplir le scénario nominal de bout en bout
- [ ] Un utilisateur sans permission voit un message d'erreur clair (pas d'erreur 500)
- [ ] Le scénario fonctionne en français ET en arabe (RTL) si UI
- [ ] Le scénario fonctionne sur Chromium, Firefox, et WebKit

```bash
pnpm test:e2e tests/e2e/messagerie-securisee-patient-ps.spec.ts
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

- Référence inventaire : `FN-076`
- Voir l'inventaire complet : `docs/Diabeo_Inventaire_Fonctionnalites.xlsx`

---

*Auto-généré depuis l'inventaire fonctionnel — affiner manuellement les sections selon la conception détaillée du sprint.*
