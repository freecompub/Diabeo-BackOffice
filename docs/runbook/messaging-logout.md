# Runbook — Messaging logout FCM cleanup (Issue #446)

> Procédure de gestion fin de session pour cleanup des push FCM messagerie.
> HDS Art. L.1111-8 · RGPD Art. 32 · ANSSI RGS

## Contexte

L'iter 4 messagerie (PR #444) introduit FCM web push via service worker
`public/firebase-messaging-sw.js`. Sur **poste partagé cabinet de groupe**
(multi-PS shift), le logout doit nettoyer :

1. **Session backend** (cookie httpOnly invalidé + session DB révoquée)
2. **FCM tokens backend** (sinon backend peut encore envoyer push à ce device)
3. **Service Worker browser** (sinon push continue à arriver pour PS sortant)

Sans ce cleanup, PS B qui se connecte après PS A sur le même PC peut recevoir
les push messagerie PS A (si `Notification.show()` ajouté futur iter) —
violation HDS gestion fin de session.

## Implémentation (Issue #446 — PR #449)

Le hook `useAuth.logout()` (`src/hooks/use-auth.ts`) applique le pattern :

```typescript
async function logout() {
  if (isLoggingOutRef.current) return         // Guard double-click (Fix H3)
  isLoggingOutRef.current = true
  try {
    // Étape 1 — SÉQUENTIEL : POST EN PREMIER pour révoquer la session
    // backend (ferme le canal émetteur cron messagerie/RDV).
    await safeCleanupStep("logout.auth", () =>
      fetchWithTimeout("/api/auth/logout", { method: "POST", credentials: "include" }),
    )

    // Étapes 2 + 3 — PARALLÈLE : DELETE FCM tokens + SW unregister
    // (indépendants, latence ~50% réduite vs séquentiel).
    await Promise.allSettled([
      safeCleanupStep("logout.fcm.delete", () =>
        fetchWithTimeout("/api/push/register", {
          method: "DELETE", credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        }),
      ),
      safeCleanupStep("logout.sw.unregister", () =>
        unregisterMessagingServiceWorker(),
      ),
    ])
  } finally {
    sessionStorage.removeItem(LOGIN_TIMESTAMP_KEY)
    router.replace("/login")                  // replace pas push (Fix H6)
    isLoggingOutRef.current = false
  }
}
```

### Décisions architecturales clés (reviews round 1)

| Fix | Décision | Pourquoi |
|---|---|---|
| **HSA H1** | POST auth/logout EN PREMIER (séquentiel) | Révoque session → ferme canal cron messagerie/RDV émetteur AVANT cleanup tokens. Sinon fenêtre push résiduelle. |
| **CR H2 + FE L1** | DELETE + SW unregister en parallèle (`Promise.allSettled`) | Indépendants, latence cumulée ~50% réduite. |
| **CRITICAL C1** | `safeCleanupStep` + `logHookError({alwaysLog: true})` | Sans observabilité prod, silent fail = violation HDS Art. L.1111-8 démonstrabilité (impossible de prouver à un auditeur ANS que le cleanup fonctionne en prod). |
| **CR H3 + FE M4** | Guard double-click via `useRef` | useRef (pas useState) — pas de re-render inutile, aligné HSA-3 inFlightRef iter 2. |
| **FE H5** | `fetchWithTimeout(url, init, 5000)` | Sans timeout, fetch hang 30s+ si backend down → user bloqué sur "Logout..." |
| **FE H6** | `router.replace("/login")` (pas `push`) | Push conserve history → back button → flash PHI dashboard cached avant re-redirect middleware. Sur cabinet partagé = leak visuel. |
| **FE M3** | Clear + redirect dans `finally` global | Même si bug React 19 compiler edge case fait throw sur un await imprévu. |
| **HSA H4** | `unregisterMessagingServiceWorker` extrait dans `@/lib/messaging/sw-lifecycle` | Module pur (pas de React). Évite couplage cross-domain `useAuth` ↔ composants messaging + bundle bloat sur pages non-messaging (login). |
| **HSA H2** | DELETE `/api/push/register` passe `ctx` + service émet `metadata.count` + `resourceId` plat US-2268 | Sans `ctx` (IP/UA), forensique HDS "depuis quelle IP le PS X s'est-il déconnecté" impossible. Sans `count`, on ne sait pas combien de tokens étaient actifs. Sans resourceId plat, GIN `metadata.userId` ne fonctionne pas. |

## Pattern fire-and-forget

Si une étape de cleanup ÉCHOUE, le logout DOIT TOUJOURS continuer (clear
cookie + redirect login). On ne bloque jamais la sortie de session sur
cleanup tierce — sinon user "coincé" dans une session zombie en cas de
défaillance réseau / backend.

**Mais** chaque erreur est désormais loggée via `logHookError(label, err,
{alwaysLog: true})` (Fix C1) — visible en console navigateur + capturable
via OVH Logs / DataDog si instrumenté côté infra. PII scrub appliqué via
`sanitizeError` (email/phone/NIRPP → `[REDACTED-*]`).

## Limites connues (documenter pour ops)

### M1 — Cookie httpOnly non clearable côté client si POST `/api/auth/logout` fail

Si POST fail (offline, 500, timeout), le `Set-Cookie max-age=0` n'arrive
jamais. Cookie `diabeo_token` reste dans le navigateur jusqu'à expiration
JWT (15min — refresh window). Tentatives `document.cookie = "..."` côté
client sont **inopérantes** sur cookies httpOnly (par design).

**Mitigation** : le middleware `src/middleware.ts` re-vérifie le JWT à
chaque requête → si la session DB a été révoquée par un autre canal (ex:
admin force-logout), le cookie résiduel est rejeté au prochain refresh.

### M2 — Multi-tab : sync cross-tab via BroadcastChannel ✅ RÉSOLU (PR #451)

**Statut V1** : implémenté via `BroadcastChannel("diabeo:auth")` (Issue #450
PR #451). Si PS A logout dans tab 1, tous les autres tabs ouverts sur la
même origin Diabeo reçoivent un message `{type: "logout", from, at}` et
cleanup local (sessionStorage clear + `router.replace("/login")`) SANS
ré-émettre (anti-loop : seul l'initiateur broadcast).

**Pattern** :

```typescript
// useAuth — channel ref persistant + listener au mount.
// Fix H1 round 2 PR #451 — channel ref REUSE (vs éphémère post+close à chaque
// logout) élimine race postMessage async / close sync immédiat.
const channelRef = useRef<BroadcastChannel | null>(null)

// Fix H3 + L1 round 2 — useState lazy + crypto.randomUUID() collision-proof
// (vs Math.random + Date.now + useRef mutation render).
const [tabId] = useState(() => crypto.randomUUID())

// Fix H4 round 2 — routerRef stable + deps [tabId] (vs [router] qui re-mount
// le channel à chaque navigation, fenêtre microscopique sans listener actif).
const routerRef = useRef(router)
useEffect(() => { routerRef.current = router }, [router])

useEffect(() => {
  if (typeof BroadcastChannel === "undefined") return  // fallback IE/vieux Safari
  const channel = new BroadcastChannel("diabeo:auth")
  channelRef.current = channel
  channel.onmessage = (event) => {
    const data = event.data
    if (data?.type !== "logout") return
    // Fix M1 round 2 — guard runtime sur from typeof string (anti malformed msg).
    if (typeof data.from !== "string") return
    // Anti-loop : ignorer ses propres broadcasts.
    if (data.from === tabId) return
    applyLogoutLocalCleanup((path) => routerRef.current.replace(path))
  }
  return () => {
    channel.close()
    channelRef.current = null
  }
}, [tabId])

// logout() — broadcast via ref persistant dans le finally.
const channel = channelRef.current
if (channel) {
  try {
    channel.postMessage({ type: "logout", from: tabId, at: Date.now() })
  } catch (err) {
    logHookError("logout.broadcast", err, { alwaysLog: true })
  }
}
```

**Filtre `from === ownTabId`** : spec browser dit que sender ne reçoit pas,
mais Node `worker_threads.BroadcastChannel` (jsdom + Edge runtime futur)
renvoie au sender. Filtre défensif requis pour portabilité.

**Limite résiduelle** : BroadcastChannel ne fonctionne que SAME-ORIGIN dans
des tabs DU MÊME profil/contexte navigateur. PS qui a ouvert tab 1 dans
Chrome profil A et tab 2 dans Chrome profil B → pas de sync (sessions
isolées de toute façon, pas un cas réel sur poste cabinet).

### Modèle Session + cookie httpOnly tab 2 (résolution HSA H1 round 2 PR #451)

**Investigation** : `src/lib/auth/session.ts` + `prisma/schema.prisma:478`
montrent que le modèle Session est **1 row par login event** (createSession
génère un sessionToken random à chaque appel). Cependant :

- **Cookie httpOnly est unique par origin** : 2 tabs ouverts par PS A après
  son login unique partagent le **même cookie** → **même session DB**.
- Tab 1 POST `/api/auth/logout` invalide cette session (cookie Set-Cookie
  max-age=0) → tab 2 hérite du cookie clear via storage event natif au
  prochain navigateur reload.
- Middleware Edge re-vérifie le JWT à chaque requête → si la session DB est
  révoquée, refuse même si tab 2 garde encore le cookie en mémoire (≤15min
  refresh).

**Conséquence pour cross-tab sync** : tab 2 n'a PAS besoin d'émettre son
propre POST `/api/auth/logout` (la session backend est déjà révoquée par
tab 1). Le listener cross-tab fait uniquement le cleanup UI immédiat
(replace `/login` + clear sessionStorage) pour **fermer la vue PHI sans
attendre le prochain middleware refresh**.

**Forensique HDS Art. L.1111-8** : la révocation backend tab 1 fait foi
pour démontrer "PS X a fini sa session à T". Aucun audit cross-tab
additionnel requis (cf. DPIA §11 décision documentée).

### HSA H6 round 2 — Pas de filtre `userId` dans message (V1.5 follow-up)

**Statut V1** : message broadcast contient uniquement `{type, from, at}`,
pas d'`userId`. Acceptable car le modèle cookie unique par origin garantit
"1 user actif par contexte navigateur" — pas de scénario multi-account
same-origin en V1.

**Risque V2 (multi-account UX)** : si à l'avenir le backoffice supporte
plusieurs comptes simultanés dans le même navigateur (account switcher),
un logout d'un compte cleanup actuellement TOUS les tabs (cross-user DOS).
Issue GH #452 trackée V2 — ajouter `userId` au payload + filtrage listener.

### M4 — Race async cleanup window (~100-500ms)

Entre le moment où `unregisterMessagingServiceWorker()` retourne et le SW
est complètement désinstallé browser-side, un push FCM en flight peut être
livré et silencieusement droppé. **Acceptable iter 4** car push data-only
(pas de notification visible lockscreen). À re-évaluer iter 6+ si
`Notification.show()` est ajouté.

### L4 — Asymétrie CSRF X-Requested-With

- `DELETE /api/push/register` envoie `X-Requested-With: XMLHttpRequest`
  (requis par middleware CSRF pour state-changing requests non-auth)
- `POST /api/auth/logout` n'envoie PAS ce header — la route est exemptée
  via `/api/auth/*` du middleware CSRF (cohérent avec login/refresh/reset).
  L'exemption se justifie car la route est rate-limitée + invalide une
  session déjà associée au cookie httpOnly (pas d'effet cross-site
  attaquant possible).

## Tests de validation

### Test unit (CI)

```bash
pnpm test tests/unit/use-auth-logout.test.tsx
```

9 tests couvrent :
- Ordre POST → [DELETE, SW] parallèle (Fix HSA H1)
- CSRF header X-Requested-With sur DELETE
- Redirect via `router.replace` (Fix FE H6 — pas push)
- Fire-and-forget : 4 scenarios fail (SW, DELETE, POST, all-3) → logout continue
- Observabilité C1 : `logHookError` appelé avec `alwaysLog: true` sur chaque fail
- Double-click guard (Fix CR H3) : 2e appel ignoré pendant in-flight
- Idempotence : chaque endpoint appelé exactement 1 fois

```bash
pnpm test tests/unit/push.service.test.ts
```

Inclut la régression HSA H2 : `unregisterAll` propage `ctx` + `metadata.count`
+ `resourceId` plat US-2268.

### Test manuel cabinet multi-PS (post-déploiement)

> **Accès DB direct** : break-glass uniquement. Justifier via ticket
> changement. Sortie psql NE doit JAMAIS être copiée hors environnement
> sécurisé (cf. `docs/runbook/db-access-prod.md` — accès via bastion OVH,
> rôle `readonly`, audit DBA). Alternative privilégiée = UI admin
> US-2148 quand exposera tokens count par user.

1. PS A login sur PC partagé (browser non-incognito)
2. Activer Firebase config (`NEXT_PUBLIC_FIREBASE_CONFIG`)
3. DevTools → Application → Service Workers : `firebase-messaging-sw.js`
   ENREGISTRÉ ✓
4. PS A logout
5. DevTools → Application → Service Workers : `firebase-messaging-sw.js`
   ABSENT ✓
6. DevTools → Application → Cookies : `diabeo_token` ABSENT (clearé par
   Set-Cookie max-age=0 côté POST `/api/auth/logout`) ✓
7. Backend DB (via bastion + readonly) :
   ```sql
   SELECT COUNT(*) FROM "PushDeviceRegistration"
   WHERE "userId" = <PS_A_id> AND "isActive" = true;
   ```
   → 0 ✓
8. Audit forensique :
   ```sql
   SELECT action, resource, "resourceId", metadata, "ipAddress"
   FROM audit_logs
   WHERE "userId" = <PS_A_id>
     AND metadata->>'kind' = 'push.unregister.all'
   ORDER BY "createdAt" DESC LIMIT 1;
   ```
   → ligne avec `metadata = {"kind":"push.unregister.all","count":N,"reason":"logout"}`
   + IP + UA ✓
9. PS B login sur même PC
10. Envoyer un push test à PS A (via cron / script seed)
11. PS B ne reçoit RIEN ✓

### Test E2E (post-seed enrichi — Issue #448)

À ajouter dans `tests/e2e/messaging.spec.ts` :
1. Login PS A via `loginAs(context, request, "doctor")`
2. Visite `/messages` + activate SW (si Firebase config CI)
3. Trigger logout
4. Login PS B (autre seed user)
5. `expect(swRegs.filter(s => s.includes('firebase'))).toHaveLength(0)`

## Bloqueurs résiduels

- **Firebase config CI** : `NEXT_PUBLIC_FIREBASE_CONFIG` non set en CI →
  SW jamais registered → test "SW unregistered" toujours trivial green.
  Documenté Issue #445 (self-host SDK Firebase).
- **`Notification.show()` futur** : si iter 6+ ajoute notifications visibles
  tray, vérifier que `getRegistrations()` cleanup au logout couvre TOUS les
  workers (pas juste `firebase-messaging-sw.js`).
- ~~**Cross-tab logout sync** : Issue follow-up V1.5 (BroadcastChannel("auth")).~~
  ✅ **Résolu** PR #451 (Issue #450) — cf. section "Limites connues — M2"
  ci-dessus.
- **Cookie httpOnly clear** : non clearable côté JS — fallback middleware
  re-check JWT à chaque requête (cf. limite M1 ci-dessus).

## Références

- Issue GH #446 — Logout flow unregister SW + DELETE FCM token
- PR #449 — Implémentation (reviews round 1 : 17 findings résolus)
- Issue GH #450 — Cross-tab logout sync (follow-up HSA M2)
- PR #451 — Implémentation cross-tab sync via `BroadcastChannel("diabeo:auth")`
- US-2076-UI iter 4 PR #444 — `unregisterMessagingServiceWorker()` helper
- US-2073 PR #340 — Backend `/api/push/register` DELETE endpoint
- US-2268 — Convention `auditLog.resourceId` plat + `metadata.userId` pivot
- DPIA `docs/compliance/dpia-messaging-scope-a.md` §9.5 conditions GO prod
- HDS référentiel Art. L.1111-8 — gestion fin de session
- ANSSI RGS §4.4 — traçabilité gestion session
- RGPD Art. 32 — sécurité du traitement
