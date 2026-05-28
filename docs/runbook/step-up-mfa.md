# Runbook — Step-up MFA

**Owner** : Backend platform / Security
**Statut** : Production (Plan B follow-up A2 round 2, 2026-05-28)
**Scope** : Actions sensibles ADMIN (role/status, FSM data-breach, financier)

---

## 1. Pourquoi

L'auth Diabeo actuelle (US-2002 MFA login) prouve MFA **une seule fois** au
login. Pendant les 24h de session, un attacker qui vole la session peut
exécuter n'importe quelle action ADMIN sans seconde preuve.

Le step-up MFA force re-prouver MFA dans les **5 dernières minutes** (par
défaut) ou **60 dernières secondes** (mode CRITICAL) avant chaque action
sensible :

- Changement de rôle / suspension (`PATCH /api/admin/users/[id]`)  — fenêtre 5 min
- Transition FSM data-breach (`POST /api/admin/data-breaches/[id]/transition`) —
  **fenêtre 60 s CRITICAL** (RGPD Art. 33 — notif CNIL irréversible)

Pattern aligné UX banking apps (Stripe Dashboard `live mode`, AWS Console).

> ⚠️ **Note rollout — A2 round 2 M-3** : Au déploiement, toutes les sessions
> live (~24h TTL max) auront `mfaLastVerifiedAt = NULL` → forcent step-up dès
> la prochaine action sensible. **Email aux ADMIN 48h avant** + monitoring
> `MFA_STEP_UP_REQUIRED` count J0 (Grafana dashboard à provisionner).

---

## 2. Architecture

### Schéma

`Session.mfaLastVerifiedAt DateTime?` (migration `20260528150000_a2_step_up_mfa`,
PG 11+ catalog-only ADD COLUMN). NULL = jamais MFA-verified. Bumped à :

- Login via `POST /api/auth/mfa/challenge` (cohérence — éviter step-up immédiat).
- Step-up via `POST /api/auth/mfa/step-up`.

> ⚠️ **A2 round 2 M-6 warning** : `createSession({ mfaVerified: true })` bumpe
> aussi `mfaLastVerifiedAt`. Conséquence : **les 5 premières minutes après
> login MFA sont considérées "fresh"**. Un attacker qui vole le cookie d'un
> user qui vient de login MFA a 5 min de fenêtre fresh sur toutes les routes
> wrappées (defaut). Pour FSM data-breach (CRITICAL 60s), la fenêtre tombe à
> 60s. Trade-off UX assumé — documenté DPIA §3.

### Fenêtres de fraîcheur

- `STEP_UP_WINDOW_SECONDS = 5 * 60` (default — actions ADMIN réversibles)
- `STEP_UP_WINDOW_SECONDS_CRITICAL = 60` (FSM data-breach, exports PHI massifs,
  JWT revoke forcé — actions à impact externe irréversible)

Constantes exportées depuis `src/lib/auth/step-up.ts`. **A2 round 2 M-7** —
non-configurable runtime en V1. V1.5 prévu : env var `STEP_UP_WINDOW_SECONDS_OVERRIDE`
avec validation `env.ts` (60 ≤ value ≤ 600).

### Helper `checkFreshMfa(userId, sessionId, options?)`

Retourne `{ ok: true, verifiedAt }` ou `{ ok: false, reason }` :

- `mfaEnrollmentRequired` — l'utilisateur n'a pas MFA activée.
- `stepUpRequired` — MFA activée mais pas fresh (ou jamais verified, ou session inconnue).

`options.windowSeconds` (default `STEP_UP_WINDOW_SECONDS`) permet le mode
CRITICAL via `STEP_UP_WINDOW_SECONDS_CRITICAL`.

### Helper `stepUpErrorResponse(reason, userId, sessionId, ctx, { route })`

Construit la 401 + headers :

- `WWW-Authenticate: stepup reason="<reason>", realm="diabeo"` (RFC 7235 — custom scheme).
- **`X-Step-Up-Required: <reason>`** — header custom pour clients qui ne
  parsent pas RFC 7235 (interceptors fetch génériques, OkHttp Android natif).
- `Cache-Control: no-store, no-cache, must-revalidate, private` (ANSSI RGS §4.5)
- `Pragma: no-cache`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`

Émet **`auditService.requireStepUp(...)`** (A2 round 2 C-2) qui :

- Crée 1 row `MFA_STEP_UP_REQUIRED` audit.
- Si même userId dépasse `BURST_THRESHOLD = 50` events / 60s → émet aussi
  `RBAC_BREACH_BURST` row atomique dans la même TX. Cooldown 60s.

---

## 3. Contrat client

### 3.1 Action sensible — 1ère tentative

```http
PATCH /api/admin/users/42
Cookie: diabeo_token=<JWT>
X-Requested-With: XMLHttpRequest    ← REQUIS sur 1ère tentative (CSRF middleware)
Content-Type: application/json

{ "role": "DOCTOR" }
```

Si MFA pas fresh, le serveur répond :

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: stepup reason="stepUpRequired", realm="diabeo"
X-Step-Up-Required: stepUpRequired
Cache-Control: no-store, no-cache, must-revalidate, private
Referrer-Policy: no-referrer
Content-Type: application/json

{ "error": "stepUpRequired" }
```

### 3.2 UI prompt OTP → step-up

```http
POST /api/auth/mfa/step-up
Cookie: diabeo_token=<JWT>
Content-Type: application/json

{ "otp": "123456" }
```

Réponse succès :

```http
HTTP/1.1 200 OK
Cache-Control: no-store, no-cache, must-revalidate, private
Content-Type: application/json

{
  "verifiedAt": "2026-05-28T15:00:00.000Z",
  "expiresAt": "2026-05-28T15:05:00.000Z"
}
```

> ⚠️ Note : `expiresAt` est le horizon **default** (5 min). Pour FSM
> data-breach (CRITICAL 60s), le client doit considérer `verifiedAt + 60s`.

### 3.3 Action sensible — retry après step-up

**A2 round 2 C-1 CRITICAL fix** : le wrapper `withIdempotency` détecte
`WWW-Authenticate: stepup` sur le 1er 401 et **NE cache PAS** cette response.
Le client peut donc retry avec **le même Idempotency-Key** après step-up
réussi → le handler re-évalue freshness et exécute normalement.

```ts
// Pattern client validé A2 round 2 C-1
const idemKey = crypto.randomUUID()
let res = await fetch(endpoint, { /* ... */, headers: { "Idempotency-Key": idemKey, ... } })
if (res.status === 401 && res.headers.get("X-Step-Up-Required")) {
  await stepUp() // POST /api/auth/mfa/step-up
  res = await fetch(endpoint, { /* ... */, headers: { "Idempotency-Key": idemKey, ... } }) // même clé
}
```

### 3.4 Cas `mfaEnrollmentRequired`

**A2 round 2 LOW-4 fix** — réponse alignée 401 + `WWW-Authenticate`
(antérieurement 403 sans header sur le endpoint step-up direct, incohérent
avec `stepUpErrorResponse`).

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: stepup reason="mfaEnrollmentRequired", realm="diabeo"
X-Step-Up-Required: mfaEnrollmentRequired

{ "error": "mfaEnrollmentRequired" }
```

L'UI doit rediriger vers `/account/security` (page d'enrôlement).

### 3.5 Best practice frontend

```ts
const MAX_STEP_UP_RETRIES = 1 // A2 round 2 LOW-L4 — anti boucle infinie

async function patchAdminUser(id: number, body: Record<string, unknown>, _retried = false) {
  const idemKey = crypto.randomUUID()
  const res = await fetch(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "Idempotency-Key": idemKey,
    },
    body: JSON.stringify(body),
  })

  if (res.status === 401) {
    const reason = res.headers.get("X-Step-Up-Required")
    if (reason === "mfaEnrollmentRequired") {
      location.href = "/account/security?reason=stepup-required"
      return
    }
    if (reason === "stepUpRequired" && !_retried) {
      const otp = await promptStepUpOtp()
      const stepUp = await fetch("/api/auth/mfa/step-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      })
      if (!stepUp.ok) throw new Error("step-up failed")
      // Retry — _retried=true empêche récursion infinie si server bug.
      return patchAdminUser(id, body, true)
    }
  }
  return res.json()
}
```

> ⚠️ **A2 round 2 LO-L4 anti-pattern** : ne PAS retry plus de 1 fois (le
> serveur ne doit pas renvoyer stepUpRequired après step-up réussi — si ça
> arrive c'est un bug serveur, pas un retry à faire).

---

## 4. Audit & forensique HDS

3 actions `AuditAction` :

- `MFA_STEP_UP_VERIFIED` — succès step-up. `resourceId = sessionId`,
  `metadata.verifiedAt`. **Émis AVANT clearAttempts** (A2 round 2 H-T3) pour
  garantir trace forensique HDS même si Redis rate-limit clear throw.
- `MFA_STEP_UP_REQUIRED` — action sensible refusée. `resourceId = sessionId`
  (ou `"jwt-legacy-no-sid"` + `metadata.legacyJwt: true`), `metadata.route` +
  `metadata.reason`. **Émis via `auditService.requireStepUp(...)`** qui câble
  US-2265 `recordAndCheckBurst` (A2 round 2 C-2 fix).
- `MFA_CHALLENGE_FAILED` (existant US-2002) — réutilisé sur OTP invalide
  step-up avec `metadata.phase = "step-up"` (distinguish login vs step-up).

**Burst detection US-2265 vraiment câblée** : 50 events `MFA_STEP_UP_REQUIRED`
en 60s / userId → row additionnel `RBAC_BREACH_BURST` atomique +
`metadata.kind: "step_up_required_burst"`. Alerte SOC.

Forensique CNIL/ANS "qui a fait quoi quand" — toute action sensible ADMIN
est désormais corrélable à un step-up event 0-5 min avant.

---

## 5. Sécurité

### 5.1 Anti-replay TOTP

`mfaService.verifyOtp` (compare-and-set `User.mfaLastUsedStep`). OTP rejoué
dans la même fenêtre 30s rejeté. Pas de risque "même OTP réutilisé".

### 5.2 Defense-in-depth `mfaEnabled` côté service (A2 round 2 H-2 + H-5)

`mfaService.stepUp` :

1. Check `mfaEnabled = true` AVANT verifyOtp (defense même si caller skip).
2. `updateMany WHERE id=sid AND userId=uid AND user.mfaEnabled=true` —
   TOCTOU defense : si `disable` concurrent flippe `mfaEnabled` entre
   verifyOtp et updateMany → count=0 → no bump.

### 5.3 Rate-limit

`mfa-step-up:<userId>` bucket — pattern `LOCKOUT_SECONDS = [0, 0, 0, 300, 900, 3600]`
(A2 round 2 M-9 doc fix) : 3 essais sans lockout puis 5 min / 15 min / 1h
progressifs.

**Recovery break-glass (A2 round 2 LO-5)** — si un ADMIN se lockout après 3
fat-finger :

```bash
# Ops Redis CLI (Upstash)
curl https://<your-redis>.upstash.io/del/diabeo:prod:ratelimit:mfa-step-up:<userId> \
  -H "Authorization: Bearer <REDIS_TOKEN>"

# Audit manuel (forensique HDS) — créer row MFA_BREAK_GLASS_GRANTED dans audit_logs
# via psql avec userId + ops-userId + raison
```

V1.5 envisagé : auto-clear sur `POST /api/auth/mfa/challenge` succès (re-login
clear le lockout step-up — login est lui-même rate-limited).

### 5.4 Burst detection (US-2265)

**A2 round 2 C-2 fix CONFIRMÉ** : `auditService.requireStepUp` câble
`recordAndCheckBurst`. ≥ 50 events / 60s par userId → `RBAC_BREACH_BURST`
audit + alerte SOC. Cas usuels :

1. **Bug UI en boucle** — frontend qui ne respecte pas `MAX_STEP_UP_RETRIES`.
2. **Bot/attacker** sondant le périmètre step-up.

Cooldown 60s entre 2 burst rows pour éviter log flood.

### 5.5 Anti CRLF injection (A2 round 2 LO-1)

`stepUpErrorResponse` whitelist explicite des `reason` autorisées avant
interpolation dans `WWW-Authenticate`. Typage TS `StepUpReason` est déjà
restrictif mais defense-in-depth si futur refactor ouvre le type.

---

## 6. Anti-patterns

- ❌ Ne PAS utiliser pour actions transactionnelles haute fréquence
  (UX dégradée — OTP toutes les 5 min insupportable).
- ❌ Ne PAS étendre la fenêtre à 30+ min sans review sécurité.
- ❌ Ne PAS exiger sur routes GET (lectures = pas de side-effect).
- ❌ Ne PAS placer le step-up check à l'intérieur d'un handler wrappé
  `withIdempotency` SANS s'assurer que le wrapper skip le cache si
  `WWW-Authenticate: stepup` (A2 round 2 C-1 — déjà câblé).
- ❌ Ne PAS hardcoder `5 * 60_000` côté UI countdown — utiliser `expiresAt`
  retourné par le step-up endpoint.
- ❌ Ne PAS retry > 1 fois côté frontend (boucle infinie si bug serveur).

---

## 7. DPIA — Impact RGPD

**Données traitées** : timestamp MFA verification (`Session.mfaLastVerifiedAt`)
+ audit events `MFA_STEP_UP_*`. Pas de PHI. Pas de transfert hors-UE
(PostgreSQL HDS-certifié OVH France).

**Base légale** : intérêt légitime du responsable de traitement (RGPD Art.
6.1.f) — sécurité des accès aux données de santé HDS Art. L.1111-8.

**Risques résiduels documentés** :

1. **A2 round 2 M-5 — `Session.mfaLastVerifiedAt` persisté en clair**.
   Combiné avec `lastSeenAt`/`ipAddress`/`userAgent` (US-2007), un dump SQL
   exfiltré permet profilage horaire ADMIN. Cohérent avec pattern existant
   `Session.lastSeenAt` (non-chiffré). Décision DPO : argument minimisation
   "horodatage non-corrélable à PHI direct" — pas de chiffrement supplémentaire.

2. **A2 round 2 M-6 — 5 min de bypass step-up post-login**. `createSession({
   mfaVerified: true })` bumpe `mfaLastVerifiedAt`. Trade-off UX assumé. Pour
   FSM data-breach (CRITICAL 60s), le risque est ramené à 60s post-login.

3. **A2 round 2 H-3 — `WWW-Authenticate: stepup` non-RFC standard**.
   Mitigation : header custom `X-Step-Up-Required` ajouté en complément pour
   clients qui ne parsent pas RFC 7235.

---

## 8. Adoption ultérieure (V1.5)

PR A2 round 2 livre **scope minimum** :

- ✅ `PATCH /api/admin/users/[id]` (5 min default)
- ✅ `POST /api/admin/data-breaches/[id]/transition` (60s CRITICAL — FSM CNIL)

**Routes candidates V1.5** (suivi via Issue GH à créer) :

- `PATCH /api/admin/data-breaches/[id]` (declare/update — 60s CRITICAL)
- `PUT /api/cabinet/[id]/sms-config` (financier — voir US-2506)
- `POST /api/admin/users/[id]/jwt-revoke` (kick session forcé)
- `POST /api/admin/exports/data-breach` (export PHI massif — 60s CRITICAL)
- Tout endpoint qui appelle `invalidateAllUserSessions`

Pattern d'adoption :

```typescript
const stepUp = await checkFreshMfa(user.id, user.sessionId, {
  windowSeconds: STEP_UP_WINDOW_SECONDS_CRITICAL, // pour FSM/exports
})
if (!stepUp.ok) {
  return stepUpErrorResponse(stepUp.reason, user.id, user.sessionId, ctx, {
    route: "<endpoint identifier>",
  })
}
```

---

## 9. Procédure recovery / break-glass

### 9.1 ADMIN locked out par rate-limit

Voir §5.3 — ops Redis CLI `DEL diabeo:prod:ratelimit:mfa-step-up:<userId>`.

### 9.2 ADMIN refuse d'enrôler MFA (perte phone, opposition, etc.)

**Pas de bypass code-level**. Procédure ANS manuelle :

1. Direction Médicale autorise l'override en écrit (email + signature).
2. Ops Direction Diabeo exécute via psql :
   ```sql
   UPDATE users SET "mfaEnabled" = false WHERE id = <userId>;
   INSERT INTO audit_logs (user_id, action, resource, resource_id, metadata, created_at)
   VALUES (<ops-userId>, 'MFA_BREAK_GLASS_GRANTED', 'USER', '<target-userId>',
           '{"reason":"<justification>","authorizedBy":"<direction-médicale>"}', NOW());
   ```
3. L'utilisateur peut alors agir sans MFA pendant 24h (session TTL) — devra
   ré-enroller après. Risque opérationnel = visible en audit.

### 9.3 Clock skew NTP désync

Si `mfaLastVerifiedAt` se retrouve dans le futur (NTP désync arrière), le
calcul `ageSec` est négatif → toujours `< windowSeconds` → ok. Tolérance
documentée + testée (A2 round 2 unit test "clock skew").

---

## 10. Métriques / alertes (V1.5)

À ajouter dans le dashboard observabilité quand US-2153 (Loki) sera livrée :

- `MFA_STEP_UP_VERIFIED` count / 1h (succès)
- `MFA_STEP_UP_REQUIRED` count / 1h (échecs / sondages)
- `MFA_CHALLENGE_FAILED metadata.phase=step-up` count
- `RBAC_BREACH_BURST metadata.kind=step_up_required_burst` count (ALERTE)
- Ratio `verified / required` (faible = UX dégradée, à investiguer)
- Latency p99 `POST /api/auth/mfa/step-up`

---

## 11. Procédure rollout production

1. **J-48h** — Email aux ADMIN : "À partir de <date>, les actions sensibles
   (changement rôle, FSM data-breach) demanderont une re-prove MFA toutes
   les 5 min (60s pour les notifications CNIL). Prévoir 30s de plus par action."
2. **J-24h** — Notification slack ops + DPO confirmation rollout
3. **J0 heure creuse** — Deploy migration `20260528150000_a2_step_up_mfa`
   (catalog-only, < 100ms PG 16) + code A2
4. **J0 + 1h** — Monitoring `MFA_STEP_UP_REQUIRED` count via psql :
   ```sql
   SELECT COUNT(*) FROM audit_logs
   WHERE action = 'MFA_STEP_UP_REQUIRED'
   AND created_at > NOW() - INTERVAL '1 hour';
   ```
   Attendu : ~1 event / ADMIN actif (1ère action sensible post-deploy).
5. **J0 + 24h** — Review tickets support + ajustement comm si > 10 tickets.

Rollback : `ALTER TABLE sessions DROP COLUMN mfa_last_verified_at;` + revert
code A2. Aucune perte de données (bump ré-acquérable via step-up).
