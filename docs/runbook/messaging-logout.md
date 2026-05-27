# Runbook — Messaging logout FCM cleanup (Issue #446)

> Procédure de gestion fin de session pour cleanup des push FCM messagerie.
> HDS Art. L.1111-8 · RGPD Art. 32 · ANSSI RGS

## Contexte

L'iter 4 messagerie (PR #444) introduit FCM web push via service worker
`public/firebase-messaging-sw.js`. Sur **poste partagé cabinet de groupe**
(multi-PS shift), le logout doit nettoyer :

1. Service Worker browser (sinon push continue à arriver pour PS sortant)
2. FCM token backend (sinon backend peut encore envoyer push à ce device)

Sans ce cleanup, PS B qui se connecte après PS A sur le même PC peut
recevoir les push messagerie PS A (si `Notification.show()` ajouté
futur iter) — violation HDS gestion fin de session.

## Implémentation (Issue #446 — PR à venir)

Le hook `useAuth.logout()` (`src/hooks/use-auth.ts`) appelle 3 étapes :

```typescript
async function logout() {
  // 1. Unregister SW navigateur (helper iter 4 PR #444)
  try { await unregisterMessagingServiceWorker() } catch {}
  
  // 2. DELETE backend FCM tokens (US-2073 endpoint)
  try {
    await fetch("/api/push/register", {
      method: "DELETE",
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
  } catch {}
  
  // 3. Invalidation session backend (existant)
  try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }) } catch {}
  
  // 4. Clear local + redirect
  sessionStorage.removeItem(LOGIN_TIMESTAMP_KEY)
  router.push("/login")
}
```

## Pattern fire-and-forget

Si SW unregister OU DELETE backend FAIL, le logout DOIT TOUJOURS continuer
(clear cookie + redirect login). On ne bloque jamais la sortie de session
sur cleanup tierce — sinon user "coincé" dans une session zombie en cas
de défaillance réseau / backend.

## Tests de validation (post-déploiement)

### Test manuel cabinet multi-PS

1. PS A login sur PC partagé
2. Activer Firebase config (`NEXT_PUBLIC_FIREBASE_CONFIG`)
3. DevTools → Application → Service Workers : `firebase-messaging-sw.js` ENREGISTRÉ ✓
4. PS A logout
5. DevTools → Application → Service Workers : `firebase-messaging-sw.js` ABSENT ✓
6. Backend DB : `SELECT * FROM "PushDeviceRegistration" WHERE userId = <PS_A_id>` → rows supprimées ✓
7. PS B login sur même PC
8. Envoyer un push test à PS A (via cron / script seed)
9. PS B ne reçoit RIEN ✓

### Test unit (CI)

```bash
pnpm test tests/unit/use-auth-logout.test.tsx
```

7 tests couvrent :
- Ordre des appels (SW → DELETE backend → POST auth/logout)
- CSRF header X-Requested-With sur DELETE
- Redirect /login + clear sessionStorage
- Fire-and-forget : 3 scenarios fail (SW, DELETE, POST) → logout continue
- Idempotence : chaque endpoint appelé exactement 1 fois

### Test E2E (post-seed enrichi — Issue #448)

À ajouter dans `tests/e2e/messaging.spec.ts` :
1. Login PS A via `loginAs(context, request, "doctor")`
2. Visite `/messages` + activate SW (si Firebase config CI)
3. Trigger logout
4. Login PS B (autre seed user)
5. `expect(swRegs.filter(s => s.includes('firebase'))).toHaveLength(0)`

## Bloqueurs résiduels

- **Firebase config CI** : `NEXT_PUBLIC_FIREBASE_CONFIG` non set en CI → SW jamais
  registered → test "SW unregistered" toujours trivial green. À documenter dans
  Issue #445 (self-host SDK) si nécessaire.
- **Notification.show() futur** : si iter 6+ ajoute notifications visibles
  tray, vérifier que `getRegistrations()` cleanup au logout couvre tous les
  workers (pas juste `firebase-messaging-sw.js`).

## Références

- Issue GH #446 — Logout flow unregister SW + DELETE FCM token
- US-2076-UI iter 4 PR #444 — `unregisterMessagingServiceWorker()` helper
- US-2073 PR #340 — Backend `/api/push/register` DELETE endpoint
- DPIA `docs/compliance/dpia-messaging-scope-a.md` §9.5 conditions GO prod
- HDS référentiel Art. L.1111-8 — gestion fin de session
