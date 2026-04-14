# MFA TOTP Flow

Multi-factor authentication via time-based one-time password (RFC 6238).
Compatible with Google Authenticator, 1Password, Aegis, any standard TOTP client.

## Overview

Enforced at the login step: a user with `mfaEnabled=true` cannot obtain a
full-access JWT without proving possession of the TOTP secret via a current
6-digit code.

Secret is stored **encrypted at rest** (AES-256-GCM) via
`src/lib/crypto/fields.ts`. A database dump does not leak TOTP seeds.

## Enrollment flow (authenticated user, MFA off)

```
┌─────────┐                                            ┌────────┐
│ Client  │                                            │ Server │
└────┬────┘                                            └────┬───┘
     │                                                      │
     │ POST /api/auth/mfa/setup (JWT required)              │
     ├─────────────────────────────────────────────────────>│
     │                                                      │ generate secret
     │                                                      │ encrypt + store
     │                                                      │ mfaEnabled=false
     │ { otpauthUri, qrCodeDataUri }                        │
     │<─────────────────────────────────────────────────────┤
     │                                                      │
     │ user scans QR in authenticator app                   │
     │                                                      │
     │ POST /api/auth/mfa/verify { otp: "123456" }          │
     ├─────────────────────────────────────────────────────>│
     │                                                      │ verify OTP
     │                                                      │ mfaEnabled=true (only on success)
     │                                                      │ emit MFA_ENABLED audit
     │ { mfaEnabled: true }                                 │
     │<─────────────────────────────────────────────────────┤
```

Two-step design: `mfaEnabled` flips to `true` **only** after a successful
first OTP. A half-completed setup (user closed the app) leaves a stored
secret + `mfaEnabled=false` — safe; next `setup` call overwrites it.

## Login flow (MFA enabled)

```
┌─────────┐                                            ┌────────┐
│ Client  │                                            │ Server │
└────┬────┘                                            └────┬───┘
     │                                                      │
     │ POST /api/auth/login { email, password }             │
     ├─────────────────────────────────────────────────────>│
     │                                                      │ verify password
     │                                                      │ mint mfa-pending token (5 min)
     │                                                      │ audience=diabeo-mfa-pending
     │ 200 { mfaRequired: true, mfaToken: "eyJ..." }        │
     │<─────────────────────────────────────────────────────┤
     │                                                      │
     │ POST /api/auth/mfa/challenge                         │
     │      { mfaToken, otp: "123456" }                     │
     ├─────────────────────────────────────────────────────>│
     │                                                      │ verify mfa-pending JWT
     │                                                      │ verify OTP
     │                                                      │ mint full JWT (15 min)
     │                                                      │ set httpOnly cookie
     │                                                      │ emit LOGIN audit (mfa=true)
     │ 200 { expiresAt } + Set-Cookie: diabeo_token         │
     │<─────────────────────────────────────────────────────┤
```

- **mfa-pending token** has audience `diabeo-mfa-pending` — the middleware
  rejects it on every protected route. It cannot be used as a bypass.
- On invalid OTP: `MFA_CHALLENGE_FAILED` audit emitted, rate-limit counter
  incremented (3 attempts → exponential lockout, same policy as login).
- On successful exchange: `LOGIN` audit with `metadata.mfa=true`.

## Disable flow

```
POST /api/auth/mfa/disable { password, otp }  (JWT required)
  → verify password  AND  verify OTP
  → clear mfaSecret + mfaEnabled=false
  → emit MFA_DISABLED audit
```

Both factors required. A stolen authenticated session without the password
cannot disable MFA; a stolen password without the phone cannot bypass it.
Uniform 401 `invalidCredentials` on failure (no oracle on which factor failed).

## Rate limiting

Shared `auth/rate-limit` helper — exponential backoff starting at 3 failed
attempts (5 min / 15 min / 1 h). Separate buckets per endpoint + userId so
setup, verify, challenge, and disable do not cross-pollute counters.

| Bucket            | Used by             |
|-------------------|---------------------|
| `mfa-verify:<id>` | /api/auth/mfa/verify |
| `mfa-challenge:<id>` | /api/auth/mfa/challenge |
| `mfa-disable:<id>` | /api/auth/mfa/disable |

## Audit events (HDS §IV.3)

| Action | Emitted on |
|---|---|
| `MFA_ENABLED` | Successful first OTP via `/verify` |
| `MFA_DISABLED` | Successful `/disable` |
| `MFA_CHALLENGE_FAILED` | Invalid OTP on `/verify`, `/challenge`, or `/disable` (metadata.phase distinguishes) |
| `LOGIN` | Successful `/mfa/challenge` (metadata.mfa=true) |

## iOS app wiring (TODO)

The mobile client must:
1. Call `/api/auth/login` as before. Branch on response:
   - `200 { expiresAt }` + cookie → normal flow (MFA off)
   - `200 { mfaRequired: true, mfaToken }` → prompt user for OTP, then call `/mfa/challenge`
2. Implement `/mfa/setup` → display QR with `qrCodeDataUri`, then post OTP to `/verify`.
3. Implement `/mfa/disable` with password + OTP confirmation UI.

**No iOS code in this PR** — backend only. Tracking in a separate issue for
iOS repo coordination.

## Threats out of scope (follow-up PRs)

- **Backup codes** — a single-use recovery code set if the phone is lost.
- **WebAuthn** — hardware-token based 2FA (YubiKey, passkeys).
- **"Remember this device"** — skip MFA on known devices for N days.
