# Runbook — Tests E2E Messagerie (US-2076-UI + Issue #448)

> Procédure de lancement des tests E2E Playwright pour la messagerie + setup
> seed data fixtures requis.

## Contexte

L'iter 5 messagerie (PR #447) a livré la structure E2E `tests/e2e/messaging.spec.ts`
avec 6 tests actifs (routing + gating + sidebar + composer) + 4 tests
`test.fixme()` documentés pour activation post-seed enrichi.

L'Issue #448 (PR #453) résout les bloqueurs seed et active 3 des 4 fixmes :

| Test | Statut | Pré-requis seed |
|---|---|---|
| Send message → modal close + thread visible | ✅ Activé PR #453 | Patient consent + PatientReferent docteur (déjà seed) |
| Radiogroup keyboard nav ArrowDown/Up/Home/End/Space | ✅ Activé PR #453 | ≥ 2 contacts messageables docteur |
| Auto-mark on scroll IntersectionObserver dwell 1500ms | ✅ Activé PR #453 | Thread avec ≥ 1 message non-lu côté docteur |
| BroadcastChannel FCM consume → badge bump | ⏸ Fixme V2 | Mock service worker dans test fixture + simulate push event |

## Fixtures seed (PR #453)

Le seed (`prisma/seed.ts`) inclut désormais bloc `9.bis Messages messagerie` :

- **conversationKey** : `computeConversationKey(doctor.id, patientUserDT1.id)`
  (HMAC-SHA256 + pepper `CONVERSATION_KEY_PEPPER`)
- **5 messages alternés** docteur ↔ patientDT1 :
  - 3 messages lus (`readAt` set) — base 2026-05-25 10:00 UTC + 0/5/10 min
  - 2 messages non-lus (`readAt: null`) — base + 15/20 min, du patient vers docteur
- **Pivot patientId** : `patientDT1.id` (US-2268 forensique)
- **Chiffrement** : `bodyEncrypted = encrypt(text)` AES-256-GCM Buffer

Comportement attendu après seed :
- Sidebar docteur → unread badge **2** (les 2 messages non-lus)
- ThreadList docteur → 1 thread visible avec patientDT1
- NewThreadModal docteur → 5 patients messageables (DT1, DT2, DT1Extra, DT2Extra, GD)

## Pré-requis runtime

### Env variables obligatoires

```bash
# Identifiant DB + chiffrement
DATABASE_URL="postgresql://..."
HMAC_SECRET="<64 hex chars>"                          # 32 bytes
HEALTH_DATA_ENCRYPTION_KEY="<64 hex chars>"            # 32 bytes

# Pepper conversationKey (Issue #450 PR #449)
CONVERSATION_KEY_PEPPER="<64 hex chars>"               # 32 bytes ≥ 96 bits Shannon

# JWT auth (login E2E via /api/auth/login)
JWT_PRIVATE_KEY="<RSA PEM>"
JWT_PUBLIC_KEY="<RSA PEM>"
```

### CI configuration

`.github/workflows/ci.yml` configure déjà toutes ces variables pour les jobs
`e2e-tests` :

```yaml
env:
  CONVERSATION_KEY_PEPPER: "f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff00"
```

Pas de configuration additionnelle requise pour PR #453.

## Lancer les tests E2E localement

```bash
# 1. PostgreSQL local
docker compose --profile local up -d

# 2. Migrations + seed (idempotent)
pnpm prisma migrate deploy
pnpm prisma db seed

# 3. Build Next.js (E2E utilise build prod, pas dev)
pnpm build

# 4. Run E2E Playwright
pnpm test:e2e tests/e2e/messaging.spec.ts

# Avec UI debug
pnpm test:e2e --ui tests/e2e/messaging.spec.ts

# Single test
pnpm test:e2e tests/e2e/messaging.spec.ts -g "Auto-mark on scroll"
```

## Troubleshooting

### `CONVERSATION_KEY_PEPPER env var required (32+ bytes hex)`

Le seed bloc `9.bis Messages messagerie` appelle `computeConversationKey` qui
throw si le pepper est absent. Solution :

```bash
export CONVERSATION_KEY_PEPPER="$(openssl rand -hex 32)"
pnpm prisma db seed
```

### Test "Auto-mark on scroll" flaky

L'`IntersectionObserver` natif + dwell 1500ms peut être affecté par :
- Viewport height (chrome default 720px) — messages peuvent être hors viewport
- Page render lente CI (cold build)

**Stratégies** :
1. Augmenter `waitForTimeout(2500)` à `4000` dans le test si CI lent
2. Vérifier que le thread sélectionné contient bien les messages non-lus
   (le seed crée 1 seul thread docteur↔patientDT1 — premier de la liste)
3. Inspecter `/api/messaging/unread-count` directement via DevTools network

### Send message E2E : modal ne close pas

Si le button "Envoyer" ne déclenche pas le send :
- Vérifier que i18n strings sont chargés (FR/EN/AR) — `getByRole("button", { name: /envoyer|send|إرسال/i })`
- Vérifier que le body fait < MAX_BODY_BYTES_UTF8 (8164) — le seed test
  utilise un texte court, OK par défaut
- Inspecter `/api/messaging` POST dans network — devrait retourner 201

### Tests E2E hangent en CI

Vérifier `playwright.config.ts` :
- `webServer.timeout` : 120000 minimum pour cold build Next.js
- `use.actionTimeout` : 10000 (par défaut 5000, peut être court pour CI lent)

## Couverture unit complémentaire

Les tests E2E couvrent le flow browser réel ; pour les patterns interactifs
en isolation (mocking IntersectionObserver, BroadcastChannel, etc.) la
couverture unit est :

- `tests/unit/NewThreadModal.test.tsx` (~17 tests) — radiogroup keyboard,
  send hook mock, modal close pendant in-flight
- `tests/unit/ThreadViewer.test.tsx` — IntersectionObserver mock jsdom + dwell
- `tests/unit/useMessagingPush.test.tsx` — BroadcastChannel FCM consume
- `tests/unit/use-auth-broadcast.test.tsx` (Issue #450 PR #451) — cross-tab
  logout BroadcastChannel

## Bloqueurs résiduels

- **BroadcastChannel FCM E2E** (test 4 fixme) : requiert mock service worker
  + simulate push event Playwright fixture. Reporté V2 si Firebase activé en
  prod (Issue #445 self-host SDK).
- **Firebase config CI** : `NEXT_PUBLIC_FIREBASE_CONFIG` non set en CI → SW
  jamais registered → test "SW Firebase pas registered" toujours green trivial.
  Acceptable pour le scope actuel.

## Références

- PR #447 — Iter 5 messagerie (structure E2E + fixme post-seed)
- PR #453 — Issue #448 enrichi seed + activation 3 tests E2E
- Issue GH #448 — Enrichir seed E2E threads + canMessage
- Spec US-2076-UI `docs/UserStory/.../US-2076-UI-messagerie-inbox-pro.md`
- DPIA `docs/compliance/dpia-messaging-scope-a.md`
- Runbook `docs/runbook/messaging-logout.md` (cross-tab logout PR #451)
