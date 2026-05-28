# Runbook — Step-up MFA

**Owner** : Backend platform / Security
**Statut** : Production (Plan B follow-up A2, 2026-05-28)
**Scope** : Actions sensibles ADMIN (role/status, FSM data-breach, financier)

---

## 1. Pourquoi

L'auth Diabeo actuelle (US-2002 MFA login) prouve MFA **une seule fois** au
login. Pendant les 24h suivantes (durée session), un attacker qui vole la
session (cookie httpOnly via attaque MITM, exfiltration via XSS pré-existant,
etc.) peut exécuter n'importe quelle action ADMIN sans seconde preuve.

Le step-up MFA force l'utilisateur à re-prouver MFA dans les 5 dernières
minutes **avant** chaque action sensible :
- Changement de rôle (`PATCH /api/admin/users/[id] { role }`)
- Suspension de compte (`PATCH /api/admin/users/[id] { status }`)
- Transition FSM data-breach (`POST /api/admin/data-breaches/[id]/transition`)
- (Futur) Toggle SMS config cabinet, génération factures critiques, etc.

Pattern aligné UX banking apps (Stripe Dashboard, AWS Console, etc.).

---

## 2. Architecture

### Schéma

`Session.mfaLastVerifiedAt DateTime?` (migration `20260528150000_a2_step_up_mfa`).
NULL = jamais MFA-verified. Bumped à :
- Login via `POST /api/auth/mfa/challenge` (cohérence — éviter step-up immédiat).
- Step-up via `POST /api/auth/mfa/step-up`.

### Fenêtre de fraîcheur

`STEP_UP_WINDOW_SECONDS = 5 * 60` (5 min). Constante exportée depuis
`src/lib/auth/step-up.ts` — modifiable centralement.

### Helper `checkFreshMfa(userId, sessionId)`

Retourne `{ ok: true, verifiedAt }` ou `{ ok: false, reason }` :
- `mfaEnrollmentRequired` — l'utilisateur n'a pas MFA activée.
- `stepUpRequired` — MFA activée mais pas fresh (ou jamais verified, ou session inconnue).

### Helper `stepUpErrorResponse(reason, userId, sessionId, ctx, { route })`

Construit la 401 + headers :
- `WWW-Authenticate: stepup reason="<reason>", realm="diabeo"` (RFC 7235).
- `Cache-Control: no-store, no-cache, must-revalidate, private` (ANSSI RGS §4.5).

Émet audit `MFA_STEP_UP_REQUIRED` avec `metadata.route` + `metadata.reason`
(US-2265 burst detection sur sondage répété).

---

## 3. Contrat client

### 3.1 Action sensible — 1ère tentative

```http
PATCH /api/admin/users/42
Cookie: diabeo_token=<JWT>
Content-Type: application/json

{ "role": "DOCTOR" }
```

Si MFA pas fresh, le serveur répond :

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: stepup reason="stepUpRequired", realm="diabeo"
Cache-Control: no-store, no-cache, must-revalidate, private
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
Content-Type: application/json

{
  "verifiedAt": "2026-05-28T15:00:00.000Z",
  "expiresAt": "2026-05-28T15:05:00.000Z"
}
```

### 3.3 Action sensible — retry après step-up

Le client retry la même requête (même `Idempotency-Key` si présent — le
wrapper idempotency considère le 1er échec 401 comme non-caché → handler
ré-exécute proprement).

### 3.4 Cas `mfaEnrollmentRequired`

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: stepup reason="mfaEnrollmentRequired", realm="diabeo"

{ "error": "mfaEnrollmentRequired" }
```

L'UI doit rediriger vers `/account/security` (page d'enrôlement) plutôt
que prompter l'OTP (pas de secret partagé encore).

### 3.5 Best practice frontend

```ts
async function patchAdminUser(id: number, body: Record<string, unknown>) {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest", // CSRF
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  })

  if (res.status === 401) {
    const wwwAuth = res.headers.get("WWW-Authenticate") ?? ""
    if (wwwAuth.startsWith("stepup ")) {
      const json = await res.json()
      if (json.error === "mfaEnrollmentRequired") {
        // Redirect to setup page
        location.href = "/account/security?reason=stepup-required"
        return
      }
      // Prompt OTP modal → on submit:
      const otp = await promptStepUpOtp()
      const stepUp = await fetch("/api/auth/mfa/step-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      })
      if (!stepUp.ok) throw new Error("step-up failed")
      // Retry la requête originale
      return patchAdminUser(id, body)
    }
  }
  return res.json()
}
```

---

## 4. Audit & forensique HDS

3 nouveaux events `AuditAction` :

- `MFA_STEP_UP_VERIFIED` — succès step-up. `resourceId = sessionId`,
  `metadata.verifiedAt`.
- `MFA_STEP_UP_REQUIRED` — action sensible refusée. `resourceId = sessionId`,
  `metadata.route` + `metadata.reason`. Compté par US-2265 burst detection.
- `MFA_CHALLENGE_FAILED` (existant US-2002) — réutilisé sur OTP invalide
  step-up avec `metadata.phase = "step-up"` (distinguish login vs step-up).

Forensique CNIL/ANS "qui a fait quoi quand" — toute action sensible ADMIN
est désormais corrélable à un step-up event 0-5 min avant.

---

## 5. Sécurité

### 5.1 Anti-replay TOTP

Repose entièrement sur `mfaService.verifyOtp` (compare-and-set
`mfaLastUsedStep`). Un OTP rejoué dans la même fenêtre 30s est rejeté.
Pas de risque "même OTP réutilisé pour 2 step-ups".

### 5.2 Cross-user spoof

`mfaService.stepUp(userId, sessionId, otp)` utilise `updateMany WHERE id =
sessionId AND userId = userId` — race-safe + cross-user safe. Si un attacker
forge un JWT avec `sub=42` mais `sid` d'un autre user → `updateMany count=0`
→ step-up échoue.

### 5.3 Rate-limit

`mfa-step-up:<userId>` bucket — 5 attempts / 5 min via
`@/lib/auth/rate-limit` (cohérent avec MFA challenge login). Bloque
brute-force online des codes 6 digits (avec MFA standard 30s/code, c'est
défense en profondeur).

### 5.4 Burst detection (US-2265)

`MFA_STEP_UP_REQUIRED` répété ≥ 50 fois / 60s par même userId →
`RBAC_BREACH_BURST` audit + alerte SOC. Indique :
- Bug UI en boucle (probable).
- Tentative bot / attacker sondant le perimètre.

---

## 6. Anti-patterns

- ❌ Ne PAS utiliser pour des actions transactionnelles haute fréquence
  (UX dégradée — OTP toutes les 5 min insupportable). Réservé aux actions
  rares + à fort impact (role change, CNIL notif, etc.).
- ❌ Ne PAS étendre la fenêtre à 30+ min sans review sécurité (anéantit le
  bénéfice anti-MITM).
- ❌ Ne PAS exiger sur les routes GET (lectures = pas de side-effect → step-up
  inutile).
- ❌ Ne PAS skipper sur les routes "qui ont déjà confirmation UI" (les
  confirmations UI sont contournables côté JS — la défense backend reste
  obligatoire).

---

## 7. DPIA — Impact RGPD

**Données traitées** : timestamp MFA verification (`Session.mfaLastVerifiedAt`)
+ audit events `MFA_STEP_UP_*`. Pas de PHI. Pas de transfert hors-UE
(PostgreSQL HDS-certifié OVH France).

**Base légale** : intérêt légitime du responsable de traitement (RGPD Art.
6.1.f) — sécurité des accès aux données de santé HDS Art. L.1111-8.

**Risques résiduels** : aucun nouveau. Hérite des mesures MFA US-2002
(secret chiffré AES-256-GCM, anti-replay TOTP, rate-limit).

---

## 8. Adoption ultérieure

Routes candidates à wrapper avec `checkFreshMfa` (à arbitrer par security/UX) :

- `PATCH /api/admin/data-breaches/[id]` (declare/update)
- `PUT /api/cabinet/[id]/sms-config` (financier — provisioning SMS)
- `POST /api/admin/users/[id]/jwt-revoke` (kick session forcé)
- `POST /api/admin/exports/data-breach` (export PHI massif)
- Tout endpoint qui appelle `invalidateAllUserSessions`

Le helper `checkFreshMfa(user.id, user.sessionId)` + `stepUpErrorResponse(...)`
est designé pour être inséré en 4 lignes en début de handler.
