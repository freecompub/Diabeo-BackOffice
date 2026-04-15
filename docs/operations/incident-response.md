# Incident Response Playbook

HDS + RGPD require a documented response process for security incidents.
This file is the first-pass checklist for on-call engineers. Severe
incidents (confirmed breach, health-data leak) also trigger the legal
notification procedure (RGPD Art. 33 — 72 h to CNIL).

**Scope of this doc**: operational playbooks. Legal procedures live in
`docs/compliance/breach-notification.md` (TODO — DPO-owned).

General response principle: **contain → investigate → remediate → notify
→ post-mortem**. Never skip the post-mortem.

## Incidents covered

- [Redis outage](#redis-outage)
- [PostgreSQL compromise or suspected leak](#postgresql-compromise)
- [MFA bypass attempt / secret leak](#mfa-bypass-attempt)
- [Rate-limit storm (DoS / credential stuffing)](#rate-limit-storm)
- [Encryption key compromise](#encryption-key-compromise)
- [JWT key compromise](#jwt-key-compromise)
- [Stolen session cookie](#stolen-session-cookie)
- [Third-party vulnerability (npm advisory)](#third-party-vulnerability)

---

## Redis outage

**Symptoms**: Upstash dashboard red, `auth/rate-limit` or `cache/redis`
errors in logs, `GET /api/health` returns `redis: "down"`.

**Impact**:

- Analytics routes: **fail-open** — continue serving, rate-limit disabled
  (acceptable — availability-first).
- RGPD export: **fail-closed** — returns 429, no exports until Redis
  recovers. Audit write is skipped when `degraded=true` (avoids Postgres
  storm during the outage).
- Session revocation check: **fail-closed** (HDS requirement) — every
  request is treated as if revoked. All users forced to re-login.
- GDPR consent cache: serves from in-memory fallback per-pod (cold cache).

**Response**:

1. Confirm Upstash status page: https://status.upstash.com
2. Check Upstash Dashboard → "Usage" tab for quota exhaustion.
3. If quota: upgrade plan via Upstash console, restart is automatic.
4. If Upstash incident: announce via #diabeo-ops Slack, no action needed —
   fail-closed session revocation is the correct degraded state. Users
   will notice login loops.
5. When resolved: `curl https://app.diabeo.fr/api/health` → expect `redis:
   "ok"`. Inform users via status page that normal service has resumed.
6. Post-incident: query `{scope="auth/revocation"}` logs for the outage
   window; confirm no policy bypass occurred.

**Do not**: disable the session-revocation middleware "temporarily" to
reduce user friction — that is a security posture downgrade and must go
through the on-call incident command chain, not a single engineer.

---

## PostgreSQL compromise

**Symptoms**: unexpected DB connections from unknown IPs, mass row
modifications, audit trigger firing UPDATE exceptions, data integrity
alerts (e.g. `mfaEnabled` flip without `MFA_ENABLED` audit).

**Response (in order)**:

1. **Isolate**: pause all Docker services (`docker compose stop api`) —
   stop bleed.
2. **Snapshot**: `pg_dump` the current DB to a separate bucket for forensics.
3. **Assess scope**: query `audit_logs` for suspicious actions in the last
   24 h. Cross-reference with `requestId` against app logs.
4. **Revoke all sessions**: `DELETE FROM sessions;` + flush Upstash key
   prefix (forces every logged-in user to re-login).
5. **Rotate credentials**: `DATABASE_URL` password, `JWT_PRIVATE_KEY`
   (forces every JWT out-of-date within 15 min).
6. **Rotate encryption key** if the DB dump is assumed compromised — see
   [Encryption key compromise](#encryption-key-compromise).
7. **Notify**:
   - DPO within 1 h (RGPD Art. 33 clock starts).
   - CNIL within 72 h of awareness (electronic form on cnil.fr).
   - Affected users without "undue delay" (RGPD Art. 34) if the breach
     creates high risk (PII/PHI access).
8. **Post-mortem** within 5 business days.

---

## MFA bypass attempt

**Symptoms**: spike in `MFA_CHALLENGE_FAILED` audit rows for one user,
`MFA_DISABLED` event not preceded by a legitimate login, successful LOGIN
with `metadata.mfa=false` on a `mfaEnabled=true` user.

**Response**:

1. **Identify the victim user** from `audit_logs.user_id`.
2. **Check the session table**: `SELECT * FROM sessions WHERE user_id=X`.
   Look for `mfaVerified=false` sessions — these should not exist when
   `users.mfaEnabled=true`. Any found = active exploitation.
3. **Revoke sessions**: `DELETE FROM sessions WHERE user_id=X;` +
   `SADD diabeo:prod:revocation:user:X *` in Upstash (fail-closed).
4. **Force password + MFA reset** for the user — out-of-band verification
   (voice call to the registered phone) before issuing a temporary code.
5. **Grep logs** for `requestId` patterns across `auth/mfa/*` scopes to
   confirm whether the bypass succeeded or was blocked by the replay
   guard (`mfaLastUsedStep` CAS → updated count=0 means bypass blocked).
6. **Rotate the user's `mfaSecret`** via forced re-enrollment (clear
   `mfaSecret`, `mfaEnabled=false`, `mfaLastUsedStep=null`).

**Do not**: log the OTP value anywhere, even during investigation.

---

## Rate-limit storm

**Symptoms**: 429 response rate spikes in Grafana on `/auth/login`,
`/auth/mfa/challenge`, or `/api/analytics/*`. Cloudflare / WAF reports
unusual traffic from a single ASN.

**Response**:

1. **Confirm it is hostile**: check `ipAddress` distribution in
   `audit_logs` for the last 15 min. Multiple distinct users same IP =
   stuffing. Single user across many IPs = distributed credential stuffing.
2. **WAF ban** at the edge (OVH Advanced Anti-DDoS) — easier than in-app
   IP banning.
3. Check that the **fail-closed buckets held** (export, revocation) — if
   not, we have a data-exfiltration amplification ongoing, treat as
   Postgres compromise.
4. Do NOT widen rate-limit budgets under duress. Temporary WAF rules are
   the correct lever.
5. Post-storm: verify audit volume did not exceed Loki ingestion cap,
   and that no `CONFIG_ERROR` or `MFA_CHALLENGE_FAILED` events were
   dropped.

---

## Encryption key compromise

**Symptoms**: `HEALTH_DATA_ENCRYPTION_KEY` leaked on a public Git
repository, accidentally logged, or shared in a non-authorized channel.

**Response**:

1. **Treat as a full data breach** — assume every encrypted field is
   readable by the adversary (regulatory posture under RGPD).
2. **Generate new 32-byte key**: `openssl rand -hex 32`.
3. **Ship a key-version migration**:
   - Add `v2:` prefix to all newly-encrypted values.
   - Background job rewrites existing rows batch by batch with the new key.
   - Remove the old key from env after every `audit_logs`, `users`,
     `patients.medical_data`, and `patient_pregnancy.notes` row has been
     re-encrypted.
4. **Notify per RGPD Art. 33/34** — this IS a breach even if no
   exploitation has been observed, because the confidentiality guarantee
   is broken.

---

## JWT key compromise

**Symptoms**: `JWT_PRIVATE_KEY` leaked. Adversary can forge JWTs with
arbitrary `sub` and `role`.

**Response**:

1. **Rotate immediately** — skip the 15-min overlap window (see
   `runbook.md`). Deploy new key; remove old.
2. **Revoke every live session**: `DELETE FROM sessions;` +
   `SADD diabeo:prod:revocation:* *` for bulk revocation.
3. **Audit the last 15 min** of access logs for forged `sub` + `role`
   combinations that do not match a legitimate DB row (e.g. admin access
   from a DOCTOR-only user).
4. Notify DPO. Usually not a data breach (no data leaked yet) unless the
   key was known to an adversary.

---

## Stolen session cookie

**Symptoms**: user reports "logged in from a device I don't own", active
session from an unexpected IP / User-Agent in `audit_logs`.

**Response**:

1. **User self-service** (preferred): `POST /api/auth/logout` invalidates
   the current session.
2. **Operator-forced revocation**: `DELETE FROM sessions WHERE id=X;` +
   `SADD diabeo:prod:revocation:<sid>` in Upstash.
3. **Force password reset** for the user (password-reset flow).
4. If MFA was NOT enabled on the compromised account: **enforce MFA
   enrollment on next login** by setting `mfaEnabled=true` and
   `mfaSecret=null` — this blocks login until `/mfa/setup` is re-run
   (requires authenticated session, chicken-and-egg) so send a
   password-reset link too.
5. Review `audit_logs` for the window between cookie theft and logout —
   quantify what the attacker accessed.

---

## Third-party vulnerability

**Symptoms**: `pnpm audit` reports a HIGH/CRITICAL CVE, Snyk/Dependabot
PR alert, npm security advisory in a dependency we use.

**Response**:

1. Read the advisory — confirm the affected code path is actually reached
   by the backoffice (many CVEs are in dev-dep tooling we don't ship).
2. Check `package.json` + `pnpm-lock.yaml` for direct vs transitive.
3. **Patch window**:
   - CRITICAL: patch within 24 h, cherry-picked to production branch.
   - HIGH: patch within 1 week.
   - MEDIUM: patch in next regular release.
4. Regen lockfile: `pnpm install` (pins the patched version).
5. Deploy, verify `pnpm audit` clean.
6. Add to CHANGELOG under "Security".

---

## Incident log template

Create an issue on GitHub repo `freecompub/Diabeo-BackOffice` with the
`incident` label:

```md
## Summary
<what happened, 2 sentences>

## Detection
- First noticed: <timestamp + UTC>
- Detection source: <Grafana alert / user report / self-discovery>
- Time-to-detect: <minutes between incident start and first alert>

## Impact
- Users affected: <count or "unknown, investigating">
- Data classification: <PII / PHI / system / none>
- Duration: <start ts → end ts>

## Response
- <timestamp> <action>
- ...

## Remediation
- [ ] <action item>
- [ ] ...

## RGPD notification
- [ ] DPO notified: <timestamp>
- [ ] CNIL notification needed: <yes/no/decision pending>
- [ ] User notification needed: <yes/no + count>

## Post-mortem
<scheduled date>
```
