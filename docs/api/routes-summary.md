# API Routes — Resume complet

## Authentification (Phase 1)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | /api/auth/login | Non | Connexion email + password. Si `mfaEnabled=true` → 200 `{ mfaRequired, mfaToken }` (pas de cookie JWT). Sinon → cookie httpOnly |
| POST | /api/auth/logout | JWT | Deconnexion + invalidation session |
| POST | /api/auth/refresh | JWT (expire) | Renouvellement token (clockTolerance 15min) |
| POST | /api/auth/reset-password | Non | Demande reset (anti-enumeration, stub) |
| POST | /api/auth/mfa/setup | JWT | Génère secret TOTP (refuse 409 si `mfaEnabled=true`), retourne QR code — audit `MFA_SETUP_INITIATED` |
| POST | /api/auth/mfa/verify | JWT | Confirmation 1ère fois, flip `mfaEnabled=true` sur OTP valide — audit `MFA_ENABLED`/`MFA_CHALLENGE_FAILED`. Rate-limited. |
| POST | /api/auth/mfa/challenge | mfa-pending token | Exchange `{ mfaToken, otp }` → cookie JWT final. Session `mfaVerified=true`. Rate-limited. |
| POST | /api/auth/mfa/disable | JWT | Requires `{ password, otp }`. 401 uniforme `invalidCredentials`. Audit `MFA_DISABLED`. Rate-limited. |

## Compte utilisateur (Phase 1)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/account | JWT | Profil complet (dechiffre) |
| PUT | /api/account | JWT | Mise a jour profil |
| DELETE | /api/account | JWT | Suppression RGPD (cascade) |
| PUT | /api/account/photo | JWT | Upload photo (501 — TODO S3) |
| PUT | /api/account/terms | JWT | Acceptation CGU |
| PUT | /api/account/data-policy | JWT | Politique donnees |
| GET/PUT | /api/account/units | JWT | Preferences d'unites |
| GET/PUT | /api/account/privacy | JWT | Parametres confidentialite. PUT invalide le cache GDPR (RGPD Art. 7(3)) |
| GET/PUT | /api/account/notifications | JWT | Preferences notifications |
| GET/PUT | /api/account/day-moments | JWT | Periodes journalieres |
| GET | /api/account/export | JWT + RL(user 3/h + IP 10/h, fail-closed) | Export RGPD (JSON). Double bucket séquentiel. Audit `RATE_LIMITED` sur blocage (sauf si `degraded`) |

## Dossier patient (Phase 2)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/patient | JWT + GDPR | Propre profil patient |
| PUT | /api/patient | JWT + GDPR | Mise a jour pathologie |
| GET | /api/patients/:id | NURSE+ | Dossier patient (pro) |
| PUT | /api/patients/:id | DOCTOR+ | Mise a jour patient (pro) |
| GET/PUT | /api/patient/medical-data | JWT + GDPR | Donnees medicales |
| GET | /api/patient/objectives | JWT + GDPR | Objectifs glycemiques |
| PUT | /api/patient/objectives | DOCTOR+ | CGM objectives |
| PATCH | /api/patient/objectives | DOCTOR+ | Annex objectives |
| GET | /api/patient/pregnancy | JWT + GDPR | Grossesse active |
| POST | /api/patient/pregnancy | JWT + GDPR | Nouvelle grossesse |
| PUT | /api/patient/pregnancy/:id | JWT + GDPR | Mise a jour grossesse |

## Donnees de sante (Phase 3)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/cgm | JWT + GDPR | Donnees CGM brutes |
| GET | /api/userdata | JWT + GDPR | Donnees combinees |
| POST | /api/events | JWT + GDPR | Creer evenement diabete |
| PUT | /api/events/:id | JWT + GDPR | Modifier evenement |
| DELETE | /api/events/:id | JWT + GDPR | Supprimer evenement |

## Analytics (Phase 3)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/analytics/glycemic-profile | JWT + GDPR + RL(30/min) | Profil glycemique (GMI, CV, TIR) |
| GET | /api/analytics/time-in-range | JWT + GDPR + RL(30/min) | TIR 5 zones |
| GET | /api/analytics/agp | JWT + GDPR + RL(30/min) | Profil AGP (96 slots) |
| GET | /api/analytics/hypoglycemia | JWT + GDPR + RL(30/min) | Episodes hypoglycemiques |
| GET | /api/analytics/insulin | JWT + GDPR + RL(30/min) | Resume insuline |
| GET | /api/patients/[id]/analytics | NURSE+ + canAccessPatient + RL(30/min) | Profil glycémique accès pro |

**RL(30/min)** = rate limit 30 requêtes / 60s / user (fail-open sur panne Redis).
Toutes les routes analytics + patient/userdata/events/cgm acceptent `?patientId=N`
pour un accès pro (DOCTOR/NURSE → `canAccessPatient`) ou lecture propre (VIEWER).

## Insulinotherapie (Phase 4)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/insulin-therapy/settings | JWT + GDPR | Parametres complets |
| PUT | /api/insulin-therapy/settings | JWT + GDPR | Mise a jour parametres |
| DELETE | /api/insulin-therapy/settings | DOCTOR+ | Suppression cascade |
| GET/POST | /api/insulin-therapy/sensitivity-factors | JWT + GDPR | Creneaux ISF |
| GET/POST | /api/insulin-therapy/carb-ratios | JWT + GDPR | Creneaux ICR |
| POST | /api/insulin-therapy/calculate-bolus | JWT + GDPR | Calcul bolus |
| GET | /api/insulin-therapy/bolus-logs | JWT + GDPR | Historique bolus |

## Propositions d'ajustement (Phase 4)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/adjustment-proposals | JWT + GDPR | Liste propositions |
| GET | /api/adjustment-proposals/summary | JWT + GDPR | Compteurs par statut |
| PATCH | /api/adjustment-proposals/:id/accept | DOCTOR+ | Accepter proposition |
| PATCH | /api/adjustment-proposals/:id/reject | DOCTOR+ | Rejeter proposition |

## Equipe soignante (Phase 5)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/healthcare/services | NURSE+ | Liste services de sante |
| GET | /api/healthcare/members | JWT + GDPR | Equipe du patient |
| POST | /api/patient/services | JWT + GDPR | Inscription a un service |
| PUT | /api/patient/referent | DOCTOR+ | Definir medecin referent |
| GET | /api/patients | NURSE+ | Liste patients du pro |
| GET | /api/patients/:id/cgm | NURSE+ | CGM patient (pro) |
| GET | /api/patients/:id/analytics | NURSE+ | Analytics patient (pro) |
| POST | /api/patients/:id/glycemia | NURSE+ | Saisie pro glycemie |

## Documents et rendez-vous (Phase 5)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/documents | JWT + GDPR | Liste documents |
| POST | /api/documents | JWT + GDPR | Creer document |
| GET/POST | /api/appointments | JWT + GDPR | Rendez-vous |

## Appareils et sync (Phase 6)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET/POST | /api/devices | JWT + GDPR | Appareils connectes (max 9) |
| GET | /api/devices/sync-status | JWT | Etat synchronisation |
| POST | /api/sync/pull | JWT + GDPR | Pull differentiel (conflict 409) |
| POST | /api/sync/push | JWT + GDPR | Push + increment sequence |

## Push notifications (Phase 7)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET/POST/DELETE | /api/push/register | JWT | Tokens push (masques) |
| GET | /api/push/templates | NURSE+ | Templates notifications |
| GET/POST | /api/push/scheduled | NURSE+ | Notifications planifiees |
| GET | /api/announcements | JWT | Annonces actives |
| POST | /api/announcements | ADMIN | Creer annonce |

## Admin

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/admin/audit-logs | ADMIN | Logs d'audit avec filtres |
| GET | /api/units | JWT | Referentiel unites |

## Monitoring / Infra

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/health | Non | Probe DB + Redis. 200 `ok` / 503 `degraded` (Redis down) / 503 `down` (DB down). Utilise par OVH Monitoring + pipeline deploy |
