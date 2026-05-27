# DPIA — US-2076 scope A Messagerie sécurisée

> Document Privacy Impact Assessment pour la messagerie 1↔1
> patient↔PS et staff↔staff (RGPD Art. 35).
> Statut : draft V1 — validation DPO en cours.

## 1. Périmètre du traitement

- **Données** : contenu des messages échangés (texte libre potentiellement
  PHI), métadonnées (expéditeur/destinataire, horodatage, lu/non-lu).
- **Personnes concernées** : patients diabétiques, médecins, infirmiers,
  admins de la plateforme Diabeo.
- **Finalité** : coordination clinique (questions patient↔soignant,
  handoff staff↔staff, prescriptions, ajustements de traitement).
- **Base légale** :
  - Art. 9(2)(a) RGPD : consentement explicite du patient (gdprConsent)
    pour le stockage et le traitement de messages contenant PHI.
  - Art. 9(2)(h) : envisageable pour soins de santé entre PS, mais
    Diabeo a choisi le modèle de consentement unilatéral V1.

## 2. Mesures techniques implémentées

| Mesure | Référence | Statut |
|---|---|---|
| Chiffrement AES-256-GCM corps de message | `crypto/health-data.ts` | ✅ |
| HMAC-SHA256 + pepper `conversation_key` (HIGH-2 round 5) | `messaging.service.ts:96` | ✅ |
| Anti-énumération routes `/messages/**` | 404 sur non-participant | ✅ |
| Consentement émetteur ET destinataire | `requireGdprConsent` 4 routes | ✅ |
| Audit log immuable HDS Art. L.1111-8 | trigger PG | ✅ |
| Pivot `metadata.patientId` singulier (US-2268) | listThreads N rows | ✅ |
| FCM data payload sans PHI/identifier | `nonce: randomUUID()` | ✅ |
| Soft-delete RGPD Art. 17 + purge user | `deletion.service.ts` | ✅ |
| Export RGPD Art. 20 + flag truncated | `export.service.ts` | ✅ |
| Cache-Control: no-store toutes routes | 4/4 routes | ✅ |
| Rate-limit 100 msgs/min/user | in-memory POC | ⚠️ V1 |
| Decrypt-fail SOC alerting throttled | per-user + cumulative | ✅ |

## 3. Risques résiduels acceptés V1 (avec décision DPO requise)

### 3.1 HIGH — Rétention messages absente (issue GH #413)

- **Risque** : Conservation indéfinie viole RGPD Art. 5(1)(e).
- **Mitigation V1** : aucune purge automatique. Suppression Art. 17 sur
  demande user uniquement.
- **Plan** : Issue GH #413 (`US-2076-bis-retention`). Proposition 36 mois
  (ANS-aligned) ou 6 ans (audit-aligned). **Décision DPO requise avant
  pre-prod.**
- **Acceptabilité** : OK pour dev/recette, **bloquant** pre-prod patients réels.

### 3.2 HIGH — Posture consent destinataire bloque l'envoi

- **Risque** : Si Bob (patient ou PS) révoque son consent, Alice ne peut
  plus lui envoyer de message. Tension avec Art. 9(2)(h) "soins de santé"
  qui pourrait justifier un envoi PS→patient même sans consent actif.
- **Mitigation V1** : Posture conservatrice — blocage uniforme.
  L'audit `accessDenied` (kind `message.send.recipientConsentRevoked`)
  préserve la forensique CNIL.
- **Plan** : statu quo V1 conservateur. Reconsidérer en V2 selon retours
  métier.
- **Décision DPO** : valider la posture V1 et documenter.

### 3.3 MEDIUM — Write amplification 8 indexes par INSERT message

- **Risque** : Bloat sous CHURN (read_at flip NULL→timestamp).
- **Mitigation V1** : REINDEX trimestriel recommandé, monitoring
  `pg_stat_user_indexes.idx_scan`.
- **Acceptabilité** : OK pour POC 50K patients, à monitorer scale.

### 3.4 MEDIUM — `conversation_key` HMAC-SHA256 dans 4 indexes B-tree

- **Risque** : Même avec pepper HMAC, l'index leak partiel + accès au
  pepper (env var compromise) reconstruit le graphe bipartite.
- **Mitigation V1** : Pepper stocké hors DB (env var), rotation possible.
  Chiffrement at-rest pgcrypto.
- **Plan V2** : envisager `pgcrypto`-encrypted column ou view matérialisée
  hashée à la lecture seule.

### 3.5 MEDIUM — Rate-limit in-memory (1 VPS POC)

- **Risque** : Scale-out horizontal sans config Redis → 100 msg/min × N
  instances effectif.
- **Mitigation V1** : Documenté dans `messaging.service.ts:27-29`. Boot
  assert single-instance en V1.
- **Plan V2** : Migration `@upstash/redis` atomic INCR+EXPIRE quand >1 VPS.

### 3.6 MEDIUM — FCM `nonce` sans mapping → notif fantôme post-crash app

- **Risque** : Si app iOS crashe avant fetch inbox, notification système
  reste sans contenu fetchable directement.
- **Mitigation V1** : Client iOS doit refetch inbox sur tap notification
  (pattern documenté `docs/runbook/messaging-mobile-contract.md`).
- **Acceptabilité** : Trade-off UX vs anti-corrélation Google Cloud Act.

## 4. Conditions GO production patients réels

- [ ] Issue GH #413 livrée (rétention messages).
- [ ] Décision DPO #1 (consent destinataire posture V1).
- [ ] Décision DPO #2 (durée rétention 36 mois ou 6 ans).
- [ ] DPIA validée signed-off par DPO.
- [ ] Monitoring `pg_stat_user_indexes` en place.
- [ ] Test EXPLAIN ANALYZE sur dataset 100K messages.

## 5. Historique des revues

| Round | Date | Verdict | Issues |
|---|---|---|---|
| 1 | 2026-05-15 | NO-GO | 5 Critical + 9 High |
| 2 | 2026-05-15 | NO-GO | 1 Medium (CHECK 8192) |
| 3 | 2026-05-15 | NO-GO | 1 Critical + 8 High |
| 4 | 2026-05-15 | NO-GO | 1 Critical (audit recipientConsent) + 3 High |
| 5 | 2026-05-16 | GO HDS dev/recette | Tous résolus sauf décisions DPO |

## 6. Références

- `docs/runbook/messaging-mobile-contract.md` — Contract API mobile/web.
- Issue GH #413 — `US-2076-bis-retention`.
- Issue GH #442 — `US-2076bis-V2` — Opaque UUID for patientId/userId (anti-énumération iter 2 PR #441). ✅ **Livré** (V1 acquis early — patientId BDD plus exposé UI, 12 chars affichés Fix H1 round 1). Reste `otherUserId` numeric — Issue follow-up GH (cf. §7.2 ci-dessous).
- ADR #18 CLAUDE.md — Convention audit `metadata.patientId` pivot.
- CLAUDE.md §"Sécurité des données de santé" — Patterns crypto.

## 7. UI iter 2 — Thread list (PR #441)

### 7.1 Surface UI exposée

`ThreadList` (sidebar 320px) — affiche per thread :
- Avatar P/U (décoratif, pas PHI)
- `Patient #<12 first chars UUID>` (US-2076bis-V2 Issue #442 — UUID v4
  opaque vs `patient.id` BDD séquentiel iter 2 — anti-énumération ANSSI /
  RGPD Art. 5.1.f). Fix H1 round 1 — 12 chars (48 bits entropy, collision
  1% à ~2M patients) vs 8 chars (32 bits, collision 1% à ~9 300 patients =
  patient safety risk sur scaling). Full UUID exposé dans `title` tooltip
  pour disambiguation visuelle. Ou `User #N` (staff, hors scope #442).
- `bodyPreview` 80 codepoints clear-text (déchiffré server-side, PHI Art. 9)
- Timestamp relatif "il y a 3 min" via `formatRelativeTime`
- Badge `unreadCount` cap "9+" (cf. iter 1 M1)

### 7.2 Risques identifiés et mitigations

| Risque | Mitigation V1.5 | Statut |
|---|---|---|
| `bodyPreview` PHI visible permanent open-space | Cap 80c backend + `Cache-Control: no-store` + middleware `/messages/*` (Fix C2 PR #440) | ✓ couvert |
| `patientId` BDD séquentiel timing oracle | UUID opaque `patientPublicRef` (UUID v4 ~122 bits entropy) — **12 premiers chars** affichés UI (Fix H1 round 1 — 32→48 bits) + full UUID dans `title` tooltip | ✅ **Livré Issue #442** |
| Collision UI 12 chars publicRef (patient safety) | Birthday paradox 1% à ~2M patients. Full UUID dans tooltip pour disambiguation. Affichage initiales réelles iter 3 éliminera le risque | ⏳ V1.5 (iter 3) |
| `userId` (staff) BDD séquentiel timing oracle | Hors scope #442 (staff IDs rares hors PHI). Issue GH follow-up V2 si scaling > pilote interne (CHU multi-cabinets) | ⏳ V2 — [Issue #456](https://github.com/freecompub/Diabeo-BackOffice/issues/456) |
| Audit pollution polling 60s | `X-Inbox-Trigger` discriminator + coalesce row si `trigger=poll` (Fix H1 PR #441) | ✓ couvert |
| Preview mask preference user (mode discret) | V1.5 — Issue à créer si demande utilisateurs | ⏳ V1.5 |
| Rate-limit GET `/api/messages` (DoS amplification) | Cap backend Redis 30 req/min/user (Fix M1 PR #441) | ⏳ V1.5 |

### 7.3 Audit coalescing trigger

PR #441 introduit un `trigger` parameter à `listThreads()` (backend) et un header `X-Inbox-Trigger` (frontend) pour discriminer :
- `user` — ouverture inbox par action explicite → audit per-patient row (forensique CNIL granulaire)
- `poll` — polling 60s background → 1 row coalescé `kind: "message.inbox.poll"` sans pivot patient (réduit volume `audit_logs` HDS Art. L.1111-8)
- `visibilitychange` — refetch post tab-resume → idem `poll`

Forensique CNIL : pour reconstituer "qui a accédé aux données patient X", chercher events `kind: "message.inbox"` (user-triggered) uniquement, pas `kind: "message.inbox.poll"`.

Volume estimé : 1 médecin × 8h connecté = 480 polls → 1 row `inbox` (user) + ~1 row `inbox.poll` toutes les ~10 min. Réduction ~95% vs ancien per-patient audit à chaque poll.

### 7.4 Conditions GO prod patients réels (iter 2)

- [ ] Issue #442 livrée (UUID opaque V2) — bloqueur scaling public > pilote interne
- [ ] Décision DPO sampling audit polling acceptable (vs full granular)
- [ ] Rate-limit GET `/api/messages` côté backend (cap Redis 30 req/min/user)
- [ ] Documentation runbook Ops sur volume audit_logs attendu (post-coalescing)
- [ ] Test EXPLAIN ANALYZE dataset 100K messages confirm perf listThreads avec trigger param

## 8. UI iter 3 — Thread viewer + composer + read receipts (PR #443)

### 8.1 Surface UI exposée

`ThreadViewer` (PR #443) — viewer messages COMPLETS déchiffrés (vs preview 80c iter 2) :

- Messages body **complets** (jusqu'à 8164 octets UTF-8 par message) déchiffrés côté backend, transmis JSON, affichés dans bubbles `bg-teal-700` / `bg-slate-100`
- Composer textarea + cap 8164 octets UTF-8 (defense-in-depth backend re-check)
- Cursor pagination loadMore (messages anciens, 50/page backend)
- Polling 30s `useThreadMessages` (vs 60s threads list `useMessageThreads`)
- Auto-mark on scroll via IntersectionObserver

### 8.2 Risques identifiés et mitigations

| Risque | Mitigation iter 3 | Statut |
|---|---|---|
| `readAt` acte clinique opposable (RGPD Art. 4(11) + CSP Art. R.4127-32) | `threshold: 1.0` (vs 0.5) + `dwell time: 1500ms` minimum visible avant trigger | ✓ Fix C1 PR #443 |
| Memory PHI plaintext non wipée au unmount | `key={selectedKey}` parent force re-mount → state local clear auto | ✓ Iter 1 pattern |
| PHI dans `console.warn` dev mode (echo backend "Invalid: john@x.com") | Helper `sanitizeError` + `logHookError` scrub email/phone/NIRPP | ✓ Fix H7 PR #443 |
| Audit pollution polling 30s `getThread` | `X-Thread-Trigger` header + coalesce row si trigger="poll" (cohérent X-Inbox-Trigger iter 2) | ✓ Fix H8 PR #443 |
| Composer texte clinique → API spell-check tiers (Chrome→Google) | `autocomplete="off" spellcheck="false" data-1p-ignore data-lpignore="true"` | ✓ Fix M4 PR #443 |
| Auto-mark `readAt` sans contexte CGU pro | DPIA documente sémantique "vu, ≠ traité cliniquement" | ⏳ DPO sign-off + CGU clarification |
| Rate-limit GET `/api/messages/thread` non enforced | V1.5 — Redis cap 100 req/min/user (cohérent listThreads) | ⏳ V1.5 |
| Mémoire client-side wipe au logout | V1.5 — `window.location.replace()` force full-page nav (vs router.push) | ⏳ V1.5 |

### 8.3 Sémantique `readAt` — DPO decision required

**`readAt` est un acte clinique opposable** :
- Patient peut prouver "le médecin a vu mon message à 14:32" via `readAt` exposé
- Médecin = responsable Art. R.4127-32 CSP (devoir d'assistance)
- Si signalement hypo nocturne marqué `readAt` mais médecin n'a pas agi → litige

**Mitigations iter 3** :
- IntersectionObserver `threshold: 1.0` (message ENTIÈREMENT visible)
- Dwell time 1500ms minimum avant trigger
- Auto-mark UNIQUEMENT messages reçus non-lus (`data-mark-on-view`)

**CGU pro à compléter** (bloqueur pre-prod patients réels) :
- "Le statut 'lu' indique que le message a été affiché à l'écran du professionnel ≥ 1.5s. Il ne préjuge pas de la prise en compte clinique du contenu."
- "Pour toute urgence vitale, contactez le SAMU 15 — la messagerie n'est pas un canal d'urgence."

### 8.4 Audit coalescing iter 3 trigger

PR #443 introduit `trigger` parameter à `getThread()` + header `X-Thread-Trigger` (cohérent iter 2 `X-Inbox-Trigger`) :
- `user` — ouverture thread par action explicite → audit per-thread row complet avec pivot `metadata.patientId` (forensique CNIL granulaire "qui a accédé aux messages COMPLETS de X")
- `poll` — polling 30s background → 1 row coalescé `kind="message.thread.poll"` SANS pivot
- `visibilitychange` — refetch post tab-resume → idem `poll`

Forensique CNIL : pour reconstituer "qui a accédé aux messages complets de patient X", chercher `kind: "message.thread"` (user-triggered) UNIQUEMENT. Volume estimé : 1 médecin × 8h thread ouvert = ~1 row "user" + ~16 rows "poll" / fenêtre 10 min (réduction ~95% vs ancien per-thread audit).

### 8.5 Conditions GO prod patients réels (iter 3 additionnelles)

- [ ] DPO sign-off sémantique `readAt` "vu ≠ traité cliniquement"
- [ ] CGU pro mention IntersectionObserver auto-mark (clause "non préjuge")
- [ ] V1.5 : full-page nav logout (`window.location.replace`) pour wipe heap
- [ ] V1.5 : rate-limit GET `/api/messages/thread` Redis 100 req/min/user
- [ ] V1.5 : decision préférence user "masquer previews" (mode discret open-space)
- [ ] Test E2E Playwright : IntersectionObserver threshold 1.0 + dwell time validé navigateurs réels

## 9. UI iter 4 — NewThreadModal + FCM consume (PR #444)

### 9.1 Surface UI exposée

PR #444 introduit :
- `NewThreadModal` : permet PS de démarrer une conversation avec un patient autorisé. Search + radiogroup contacts + composer premier message.
- `useMessagingContacts` : fetch `/api/messaging/contacts` (NEW endpoint Fix HSA H2) — filtré par `canMessage()` server-side
- `useMessagingPush` : FCM consume via service worker `public/firebase-messaging-sw.js`
- Backend route `/api/messaging/contacts` : pré-filtre patients via `canMessage` (NURSE+, GDPR consent)

### 9.2 Risques identifiés et mitigations

| Risque | Mitigation iter 4 | Statut |
|---|---|---|
| Fuite préférence patient consent opt-out (modal affiche TOUS patients) | Endpoint `/api/messaging/contacts` filtre `canMessage` server-side avant exposition UI | ✓ Fix HSA H2 PR #444 |
| SW `importScripts` Firebase CDN sans SRI — supply chain compromise | TODO V1.5 — self-host SDK dans `public/vendor/` après scan AV manuel | ⏳ Issue #445 |
| SW accepte `FIREBASE_CONFIG` postMessage sans validation | Whitelist origin + shape config + allowlist `projectId` + latch TOCTOU | ✓ Fix HSA C1 PR #444 |
| BroadcastChannel exfiltrable par scripts same-origin (XSS, extensions) | Documenté DPIA §9.4 — limitation API native, surveillance code |  ⏳ V2 si XSS surface |
| Modal close pendant send in-flight → message envoyé silencieusement | `closedDuringSendRef` flag — ignore `onMessageSent` callback post-close | ✓ Fix H1 PR #444 |
| SW persiste après logout → notifications fuites poste partagé | TODO V1.5 — `unregisterMessagingServiceWorker()` helper + DELETE FCM token | ⏳ Issue #446 |
| SW pas de cache-bust si bug critique iter 5+ | `updateViaCache: "none"` + `SW_VERSION` bump strategy | ✓ Fix HSA M3 PR #444 |
| `apiKey` Firebase via postMessage observable devtools | Validation shape côté SW + client (defense-in-depth) | ✓ Fix HSA C1 PR #444 |

### 9.3 Endpoint `/api/messaging/contacts` (Fix HSA H2)

Nouveau endpoint backend (PR #444) qui appelle `canMessage()` côté serveur pour CHAQUE patient du portefeuille PS avant exposition UI :

- **RBAC** : NURSE+ + GDPR consent obligatoire
- **Performance** : O(N) appels `canMessage` (4 queries DB chacun). Cap N à `MAX_CONTACTS_PER_QUERY = 50`. V1.5 introduira cache Redis pré-calculé
- **Anonymisation** : retourne `Patient #{patientId}` uniquement (cohérent iter 2)
- **Audit** : 1 row `READ MESSAGING_CONTACTS` agrégé (pas de pivot patientId — vue multi-patients)
- **Cache-Control** : `no-store, private` (préférences messagerie peuvent changer)

### 9.4 BroadcastChannel surface (HSA H1)

`BroadcastChannel("messaging-events")` est l'API standard Web pour SW→client communication. Limitation native : **n'a pas de mécanisme origin/auth** — tout script JS sur app.diabeo.fr peut listen.

**Threat model** : XSS attaquant peut `new BroadcastChannel("messaging-events").onmessage = ...` et collecter le `nonce` de chaque push reçu. Corrélé timing avec backend, permet inférer "PS X a reçu un message à T" → reconstruit graphe relations patient↔PS (Art. 9 inférée).

**Mitigations V1+** :
- Pas de PHI dans le broadcast (uniquement `nonce` opaque)
- Surveillance XSS via CSP `default-src 'self'`
- CGU pro mention monitoring sécurité

**Mitigations V2** : signature HMAC du nonce SW→client + verification.

### 9.5 Conditions GO prod patients réels (iter 4 additionnelles)

- [ ] Issue #445 (self-host Firebase SDK) livrée — bloqueur si CSP `script-src 'self'` strict appliqué
- [ ] Issue #446 (logout flow unregister SW + DELETE FCM token) livrée — bloqueur multi-PS cabinet poste partagé
- [ ] Firebase config (`apiKey` + `projectId` + `messagingSenderId` + `appId`) provisionnée + ajoutée à `ALLOWED_PROJECT_IDS` du SW (3 envs : dev/staging/prod)
- [ ] DPA Google Firebase signé (transfert hors-UE Art. 44+ — projet Firebase US-region)
- [ ] CGU pro mention notifications push activées + permission flow `Notification.requestPermission()` UI
- [ ] Test E2E Playwright : SW registration + push consume + BroadcastChannel callback (jsdom unsupported)

## §11 — Cross-tab logout sync (Issue #450 PR #451)

### 11.1 Contexte

L'iter 4 (PR #444) + Issue #446 (PR #449) résolvent le bug FCM cleanup sur logout d'un onglet — mais sur poste partagé cabinet, si PS A laisse plusieurs onglets ouverts et logout dans un seul, les autres restent visuellement authentifiés. Risque : `useMessagingPush` mount cycle des autres tabs ré-register un token FCM (annulant cleanup tab 1) → PS B login derrière reçoit push PS A.

### 11.2 Solution implémentée — `BroadcastChannel("diabeo:auth")`

Cf. `docs/runbook/messaging-logout.md` section M2. Le tab initiateur du logout broadcast `{type, from, at}` après cleanup backend ; les autres tabs cleanup local (sessionStorage clear + replace `/login`) sans ré-émettre (anti-loop). `useState(() => crypto.randomUUID())[0]` comme tab identifier.

### 11.3 Modèle de menace

| Risque | Impact | Mitigation V1 | Statut |
|---|---|---|---|
| **XSS amplification** : attaquant XSS broadcast `{type: "logout"}` → DOS session tous tabs | XSS est game-over (cookie déjà exfiltrable via XHR) ; DOS empêche victime de noter l'attaque | Aucune mitigation pratique (un secret JS-accessible serait extractible par même XSS). Documenté DPIA, surveillance CSP `default-src 'self'` | ⏸ Acceptable V1 |
| **Timing oracle sous-domaine** : si futur `cdn.diabeo.fr` partage origin (CSP relax) → attaquant observe quand PS logout | Information disclosure faible (timing patterns d'activité) | BroadcastChannel strictement same-origin (host+port+protocol). Sous-domaines hors-origin isolés | ✓ Spec-level |
| **Forge tab id par XSS** : attaquant peut envoyer `{type, from: "fake-id"}` pour faire cleanup d'un autre tab | Cf. XSS amplification ci-dessus | `tabId` non secret, juste désambiguïsation runtime — pas une frontière sécurité | ⏸ Acceptable V1 |
| **Cross-user logout DOS multi-account** : V2 multi-account UX → logout user A déclenche logout user B | Pas applicable V1 (cookie unique par origin = 1 user actif) | Documenté DPIA + Issue GH V2 (filter `userId` payload) | ⏸ V2 ([Issue #452](https://github.com/freecompub/Diabeo-BackOffice/issues/452)) |
| **Cookie httpOnly tab 2 résiduel post-logout tab 1** : cookie reste jusqu'à expiration JWT (~15min) | Tab 2 peut tenter d'accéder à PHI cached avant prochain middleware refresh | Cleanup UI immédiat via cross-tab listener (replace `/login` < 100ms) | ✓ PR #451 |

### 11.4 Décision audit `session.cross_tab_close`

**Question HSA H2 round 2 PR #451** : faut-il émettre un audit log backend pour chaque tab fermé via broadcast cross-tab ?

**Décision V1 (PR #451)** : **NON** — la révocation backend tab 1 (POST `/api/auth/logout`) fait foi pour démontrer "PS X a fini sa session à T". Audit cross-tab additionnel = bruit (N tabs × 1 audit = pollution + perf cron messagerie).

**Démonstrabilité HDS Art. L.1111-8** : forensique "PS X a fini sa session à T sur tous ses tabs" reconstituable via :
1. Audit `session.logout` (action="DELETE" resource="SESSION") tab initiateur — IP/UA + count tokens FCM cleared
2. Audit `push.unregister.all` (PR #449 HSA H2) — IP/UA + count
3. Middleware refuse cookie résiduel autres tabs au prochain refresh (≤15min) — implicite par modèle cookie unique

**Validation DPO** : pending signature pre-prod patients réels (à demander avec PR #451 review).

### 11.5 Bloqueurs pre-prod patients réels (iter 4 — addendum PR #451)

- [ ] Décision DPO §11.4 — confirmation que révocation backend tab 1 + middleware refresh suffit pour démonstrabilité Art. L.1111-8 cross-tab
- [ ] Surveillance CSP `default-src 'self'` + `script-src 'self'` strict (mitigation XSS amplification §11.3)
- [ ] Issue GH V1.5 trackée pour filtre `userId` si multi-account UX V2

