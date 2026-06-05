# Diabeo Backoffice — Fonctionnalités par rôle

> Inventaire exhaustif (2026-05-23). Source : `src/app/api/**/route.ts` et
> `src/app/(dashboard|patient|auth)/**/page.tsx`. Régénérable via grep
> des helpers `requireRole / auditedRequireRole / requireAuth`.

---

## 1. Hiérarchie & helpers RBAC

### Rôles (4)

| Rôle    | Level | Périmètre |
|---------|-------|-----------|
| **ADMIN**   | 3 | Tout — gestion users, audit, config système, cabinets, base médicaments |
| **DOCTOR**  | 2 | Patients de son portefeuille (référent + cabinet), validation InsulinConfig, propositions, prescriptions |
| **NURSE**   | 1 | Consultation patients (cabinet), création InsulinConfig (sans validation), saisie événements |
| **VIEWER**  | 0 | Patient self-service — accès à ses propres données uniquement |

Hiérarchie : `ADMIN > DOCTOR > NURSE > VIEWER`. Un `requireRole(req, "NURSE")`
autorise NURSE, DOCTOR et ADMIN.

### Helpers RBAC (src/lib/auth/)

| Helper | Effet |
|--------|-------|
| `requireAuth(req)` | JWT valide, tout rôle accepté |
| `requireRole(req, "NURSE")` | minRole = NURSE (NURSE/DOCTOR/ADMIN) |
| `auditedRequireRole(req, role, ctx, resource, id)` | idem + audit log automatique |
| `canAccessPatient(user, patientId)` | scope : ADMIN > tout, DOCTOR/NURSE > cabinet+référent, VIEWER > own |
| `getOwnPatientId(userId)` | résout `userId → patientId` pour VIEWER (1:1) |
| `requireGdprConsent(userId)` | vérifie `UserPrivacySettings.gdprConsent = true` |
| `resolveHomeForRole(role)` | mapping role → home path (post-login redirect) |

### Cookies & middleware

- JWT RS256 stocké en `diabeo_token` (httpOnly, secure, sameSite=Strict).
- Middleware (`src/middleware.ts`) injecte `x-user-id` + `x-user-role` + `x-session-id` après vérification du JWT.
- Routes `/api/cron/*` bypass JWT, authentifiées par `Authorization: Bearer ${CRON_SECRET}` (timing-safe).
- `requireGdprConsent` lit `UserPrivacySettings.gdprConsent` (cache Redis 5min).

---

## 2. Pages UI par rôle

### 2.1 Pages publiques (non authentifiées)

| Path | Description |
|------|-------------|
| `/login` | Formulaire de connexion email/password + MFA |
| `/reset-password` | Reset mot de passe (token email) |

### 2.2 Pages ADMIN-only

| Path | Description |
|------|-------------|
| `/admin` | Dashboard administrateur — 3 cards (KPI cabinet, facturation, conformité) — US-2410 |
| `/admin/users` | Gestion utilisateurs (US-2148 ; `/users` redirige ici) |
| `/audit` | Consultation audit logs (stub V1 — API `/api/admin/audit-logs` prête) |

### 2.3 Pages DOCTOR-only

| Path | Description |
|------|-------------|
| `/medecin` | Dashboard médecin — urgences, RDV, patients à risque, KPI 14j — US-2400 |
| `/adjustment-proposals` | Validation des propositions d'ajustement insuline (accept/reject) |

### 2.4 Pages NURSE+ (NURSE / DOCTOR / ADMIN)

| Path | Description |
|------|-------------|
| `/infirmier` | Dashboard infirmier — KPI ma journée, to-do, coordination, relances — US-2405-2409 |
| `/patients` | Liste patients filtrable (search, pathologie, tags) |
| `/patients/new` | Wizard onboarding patient (2 étapes : identité + pathologie) |
| `/patients/[id]` | Fiche patient — 4 tabs : overview, glycémie, traitements, documents |
| `/insulin-therapy` | Configuration insulinothérapie (ISF/ICR/basal/IOB) |
| `/devices` | Liste devices + supervision (battery/expiry/sync) |
| `/devices/pair` | Wizard pairing device (3 étapes) |
| `/medications` | Recherche base médicaments BDPM + favoris cabinet |
| `/analytics` | Analytics population (TIR/GMI distributions, cohortes) |
| `/analytics/radar` | Vue radar multi-variable comparison |
| `/documents` | Liste documents + upload (NURSE+ pour upload, ClamAV scan) |
| `/events/new` | Saisie événement (glycémie, insuline, repas, activité) |
| `/weekly` | Vue hebdomadaire glycémie |
| `/import` | Import MyDiabby (DOCTOR+) |
| `/dashboard` | Vue glycémie patient (page legacy patient-facing — à renommer V1.5, issue #425) |
| `/settings` | Paramètres utilisateur (profil, préférences, MFA, langues) |

### 2.5 Pages VIEWER (patient self-service)

| Path | Description |
|------|-------------|
| `/patient/dashboard` | Dashboard patient — glycémie 24h, AGP 7j, actions rapides — US-3356 |

> US-3356 Batch 2+ ajoutera : `/patient/glycemia`, `/patient/events`,
> `/patient/appointments`, `/patient/profile`, `/patient/preferences`.

### 2.6 Routing post-login

- Tous les rôles : login → mapping `ROLE_TO_HOME` (cf. `src/lib/auth/role-home.ts`)
- DOCTOR → `/medecin`
- NURSE → `/infirmier`
- ADMIN → `/admin`
- VIEWER → `/patient/dashboard`

---

## 3. Routes API par domaine

### 3.1 Auth (public ou auth)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/auth/login` | POST | public | Rate-limited (3 fails → lockout backoff exponentiel) |
| `/api/auth/logout` | POST | public | Invalide la session DB + clear cookie |
| `/api/auth/refresh` | POST | public | Renew JWT si session valide (15min cycle) |
| `/api/auth/reset-password` | POST | public | Anti-énumération (200 toujours, email si user existe) |
| `/api/auth/mfa/setup` | POST | auth | Génère TOTP secret + QR |
| `/api/auth/mfa/verify` | POST | auth | Active MFA après vérif code |
| `/api/auth/mfa/disable` | POST | auth | Désactive MFA (re-vérif mot de passe) |
| `/api/auth/mfa/challenge` | POST | public | Step 2 du login si MFA activé |

### 3.2 Account (tout user authentifié — `requireAuth`)

| Route | Verbe | Description |
|-------|-------|-------------|
| `/api/account` | GET/PUT/DELETE | Profil utilisateur (déchiffré PUT/DELETE incl. cascade RGPD Art. 17) |
| `/api/account/photo` | PUT | Upload avatar (5MB max, ClamAV, S3 OVH SSE-S3) |
| `/api/account/terms` | PUT | Acceptation CGU |
| `/api/account/data-policy` | PUT | Acceptation politique données |
| `/api/account/privacy` | GET/PUT | Consentement RGPD + partage soignants/chercheurs (US-2013) |
| `/api/account/notifications` | GET/PUT | Préférences notifs email/push (US-2079) |
| `/api/account/units` | GET/PUT | Préférences unités (mg/dL vs g/L, etc.) |
| `/api/account/day-moments` | GET/PUT | Périodes journalières personnalisées |
| `/api/account/locale` | PUT | Switch langue (fr/en/ar + cookie persistence — US-2112) |
| `/api/account/export` | GET | Export RGPD Art. 20 complet (profil + patient + CGM + events + invoices) |
| `/api/account/sessions` | GET | Liste sessions actives utilisateur (US-2007) |
| `/api/account/sessions/[id]` | DELETE | Révoque session (self-only, audit US-2265 sur cross-user) |

### 3.3 Patients & gestion (NURSE+ avec `canAccessPatient`)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/patients` | GET/POST | NURSE+ | GET=liste cabinet, POST=création (DOCTOR+) |
| `/api/patients/search` | GET | NURSE+ | Full-text via HMAC + filtres pathologie/consent |
| `/api/patients/[id]` | GET/PUT | NURSE+ | Scope cabinet, PUT=DOCTOR+ pour pathologie |
| `/api/patients/[id]/invite` | POST | DOCTOR+ | QR code invite mobile (JWT 15min, US-2025) |
| `/api/patients/[id]/referent` | GET/PUT | NURSE+ | Affectation médecin référent (ADMIN/référent/self-claim DOCTOR) |
| `/api/patients/[id]/tags` | GET/PUT | NURSE+ | Tags patient (US-2022) |
| `/api/patients/[id]/groups` | GET/PUT | NURSE+ | Cohortes M:N (US-2088) |
| `/api/patients/[id]/audit-history` | GET | DOCTOR+ | Historique modifications PHI redacted (US-2024) |
| `/api/patients/[id]/ins` | GET/PUT/DELETE | DOCTOR+ ou VIEWER (own) | Identité Nationale Santé US-2026 (Luhn-97 + HMAC) |
| `/api/patient/medical-data` | GET/PUT | auth | Données médicales du patient connecté (history_* chiffrés) |
| `/api/patient/objectives` | GET/PUT | auth (PUT=DOCTOR+) | Objectifs glycémie/CGM/annex (defaults ADA) |
| `/api/patient/pregnancy` | GET/POST | auth | Suivi grossesse (DPA, gestational age 0-45 sem) |
| `/api/patient/pregnancy/[id]` | PUT | auth | Mise à jour grossesse |
| `/api/patient/route` | GET/PUT | auth | Propre profil patient + pathologie |
| `/api/patient/referent` | GET | auth | Médecin référent du patient connecté |
| `/api/patient/services` | GET | auth | Services healthcare du patient |

### 3.4 Glycémie & analytics (auth + `requireGdprConsent`)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/cgm` | GET | auth | Lecture CGM (patient via getOwnPatientId, pro via ?patientId=) |
| `/api/analytics/glycemic-profile` | GET | auth | Avg glucose, HbA1c estimée, SD |
| `/api/analytics/time-in-range` | GET | auth | TIR (Time In Range) — défauts ADA 70-180 |
| `/api/analytics/hypoglycemia` | GET | auth | Détection hypos (< 70 mg/dL) |
| `/api/analytics/agp` | GET | auth | Profil AGP percentile (p25/p50/p75) |
| `/api/analytics/agp/pdf` | GET | auth | Export AGP en PDF (pdf-lib) |
| `/api/analytics/heatmap` | GET | auth | Heatmap glycémique TZ-pinned Europe/Paris |
| `/api/analytics/compare` | GET | auth | Comparaison de périodes (delta) |
| `/api/analytics/insulin` | GET | auth | Analytics insuline |
| `/api/analytics/cohorts` | GET | NURSE+ | Cohorte par pathologie DT1/DT2/GD |
| `/api/analytics/population` | GET | NURSE+ | Tableau de bord population cabinet |
| `/api/analytics/quality-indicators` | GET | NURSE+ | TIR/GMI distributions cabinet |
| `/api/analytics/export` | GET | NURSE+ | Export CSV/Excel anti-injection |
| `/api/patients/[id]/glycemia` | GET | NURSE+ | Glycémie d'un patient spécifique |
| `/api/patients/[id]/cgm` | GET | NURSE+ | CGM raw d'un patient spécifique |
| `/api/patients/[id]/analytics` | GET | NURSE+ | Analytics agrégés d'un patient |
| `/api/patients/[id]/adherence` | GET | NURSE+ | Score adhérence thérapeutique (US-2251) |
| `/api/patients/[id]/glycemia-meal-context` | GET | NURSE+ | CGM ±2h pre/post repas (US-2253) |

### 3.5 Insulinothérapie (NURSE+ pour création, DOCTOR+ pour validation)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/insulin-therapy/settings` | GET/POST | NURSE+ (PUT=DOCTOR+ validation) | Config racine patient |
| `/api/insulin-therapy/sensitivity-factors` | GET/POST/PUT | NURSE+ | ISF par slot horaire (clinical bounds appliquées) |
| `/api/insulin-therapy/carb-ratios` | GET/POST/PUT | NURSE+ | ICR par slot horaire |
| `/api/insulin-therapy/basal-config` | GET/POST/PUT | NURSE+ | Configuration basale pompe/MDI |
| `/api/insulin-therapy/basal-config/pump-slots` | GET/POST/PUT | NURSE+ | Slots basal pompe (Time, pas Timestamp) |
| `/api/insulin-therapy/calculate-bolus` | POST | auth | Calcul bolus (transaction Prisma, BolusCalculationLog immuable) |
| `/api/insulin-therapy/bolus-logs` | GET | auth | Historique bolus calculés |
| `/api/adjustment-proposals` | GET/POST | auth | Liste / création proposition d'ajustement |
| `/api/adjustment-proposals/[id]/accept` | POST | DOCTOR+ | Acceptation proposition (validation médicale) |
| `/api/adjustment-proposals/[id]/reject` | POST | DOCTOR+ | Rejet proposition |
| `/api/adjustment-proposals/summary` | GET | auth | Synthèse propositions en attente |

### 3.6 Repas & activité (auth ou NURSE+ selon scope)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/events` | GET/POST | auth | Événements diabète (glycémie/insuline/repas/activité) |
| `/api/events/[id]` | GET/PUT/DELETE | auth | Détail événement |
| `/api/patients/[id]/activity` | GET/POST/PUT/DELETE | NURSE+ (VIEWER own) | Journal activité physique (US-2059) |
| `/api/patients/[id]/activity/[activityId]` | GET/PUT/DELETE | NURSE+ (VIEWER own) | Détail activité |
| `/api/patients/[id]/activity/sync` | POST | NURSE+ (VIEWER own) | Bulk sync HealthKit/Google Fit (idempotent UNIQUE) |
| `/api/patients/[id]/food-journal` | GET | NURSE+ | Journal alimentaire patient (US-2248) |
| `/api/patients/[id]/meals/pending` | GET | NURSE+ | Repas en attente validation |
| `/api/patients/[id]/meal-photos` | GET | NURSE+ | Photos repas (S3 + ClamAV + EXIF strip) |
| `/api/meals/[id]/validate` | POST | NURSE+ | Validation comptage glucides (US-2053) |
| `/api/foods/search` | GET | NURSE+ | Recherche aliments CIQUAL ANSES (HMAC + NFC norm) |
| `/api/foods/[id]` | GET | NURSE+ | Détail aliment |
| `/api/pump-events` | GET/POST | NURSE+ | Événements pompe à insuline |
| `/api/pump-events/sync` | POST | NURSE+ | Bulk sync pump events (dedup cross-batch) |

### 3.7 Devices & sync (auth ou NURSE+)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/devices` | GET/POST | auth | Devices patient (VIEWER own, pro cabinet) |
| `/api/devices/compatibility` | GET/POST | public/NURSE+ | Whitelist HDS supported devices (création ADMIN) |
| `/api/devices/sync-status` | GET | auth | Statut sync (ok/late/critical/never_synced) |
| `/api/devices/sync-status/cohort` | GET | NURSE+ | Cohorte sync status (cap 2000 patients) |
| `/api/devices/supervision/cohort` | GET | NURSE+ | Supervision cohort (battery/expiry) |
| `/api/patients/[id]/devices/supervision` | GET | auth (canAccessPatient) | Supervision per-patient |
| `/api/patients/[id]/devices/sync-status` | GET | auth (canAccessPatient) | Sync status per-patient |
| `/api/patients/[id]/devices/history` | GET | auth (canAccessPatient) | Historique devices cursor-pagination |
| `/api/patients/[id]/devices/[deviceId]/revoke` | POST | auth (canAccessPatient) | Soft-revoke atomic CAS (US-2092) |
| `/api/patients/[id]/devices/[deviceId]/sync-ping` | POST | auth | Alimente lastSyncAt + battery |

### 3.8 Messagerie & notifications (auth + GDPR + canMessage)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/messages` | GET/POST | auth + GDPR | Messages patient↔PS (US-2076 scope A, REST + polling 60s) |
| `/api/messages/thread/[conversationKey]` | GET | auth + GDPR | Thread pagination cursor |
| `/api/messages/[id]/read` | PUT | auth + GDPR | Marquer comme lu (idempotent) |
| `/api/messages/unread-count` | GET | auth + GDPR | Badge polling 60s |
| `/api/push/register` | GET/POST/DELETE | auth | FCM device registration |
| `/api/push/send` | POST | NURSE+ (canAccessPatient) | Envoi push FCM (rate limit fail-closed 50/h) |
| `/api/push/templates` | GET | NURSE+ | Templates push |
| `/api/push/scheduled` | GET/POST | NURSE+ | Notifications programmées (cap scheduledAt 1y) |
| `/api/announcements` | GET/POST | auth (POST=ADMIN) | Communications patients |

### 3.9 Documents (auth + GDPR + NURSE+ pour upload)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/documents` | GET/POST | auth + GDPR | Liste documents + création metadata |
| `/api/documents/upload` | POST | NURSE+ + GDPR | Upload multipart S3 (50MB max, ClamAV, SSE-S3) |
| `/api/documents/[id]/download` | GET | auth + GDPR | Stream fichier S3 (RBAC + audit) |

### 3.10 Équipe médicale (NURSE+ ou DOCTOR+ selon scope)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/healthcare/services` | GET | NURSE+ | Liste services healthcare |
| `/api/healthcare/services/[id]/tags` | GET/PUT | NURSE+ (PUT=DOCTOR+) | Tags cabinet |
| `/api/healthcare/services/[id]/tags/[tagId]` | DELETE | DOCTOR+ | Suppression tag |
| `/api/healthcare/members` | GET | auth + GDPR | Membres équipe |
| `/api/team/templates` | GET/POST/PUT | NURSE+ (mutations=DOCTOR+) | Templates messagerie cabinet (US-2078) |
| `/api/team/insulin-templates` | GET/POST/PUT | NURSE+ (mutations=DOCTOR+) | Templates ajustement insuline cabinet-scoped (US-2050) |
| `/api/team/delegations` | GET/POST | NURSE+ | Délégations médecin → IDE (US-2083) |
| `/api/team/delegations/[id]/respond` | POST | DOCTOR+ | Accept/refuse délégation |
| `/api/team/handoffs` | GET/POST | NURSE+ | Handoff entre soignants (chiffré, US-2086) |
| `/api/team/handoffs/[id]/acknowledge` | POST | NURSE+ | Accusé handoff |
| `/api/team/absences` | GET/POST | NURSE+ (POST=ADMIN) | Remplacements / congés (US-2084) |
| `/api/team/groups` | GET/POST/PUT | NURSE+ (PUT=DOCTOR+) | Groupes patients M:N (US-2088) |
| `/api/team/read-receipts` | POST | auth | Accusés de lecture génériques (US-2080) |
| `/api/team/availability` | GET/POST | auth (POST=DOCTOR+) | Plages indisponibilité médecin |
| `/api/team/availability/[id]` | PUT/DELETE | DOCTOR+ | Mise à jour disponibilité |
| `/api/team/booking-config/[memberId]` | GET/PUT | NURSE+ (PUT=DOCTOR+) | Config auto vs validation manuelle (US-2505) |
| `/api/team/teleconsult-actes` | GET/POST | DOCTOR+ | Acte téléconsult (US-2072) |
| `/api/team/teleconsult-actes/[id]/invoice` | POST | ADMIN | Facturation acte téléconsult |
| `/api/team/proposal-ack/[proposalId]` | POST | auth (getOwnPatientId) | Patient ack proposition (US-2065) |
| `/api/team/proposal-actualization/[proposalId]` | POST | NURSE+ | Verifiedvia overwrite guard (US-2066) |
| `/api/patients/[id]/consultation-notes` | GET/POST/PUT | NURSE+ (DOCTOR+ pour write) | Notes consultation chiffrées (US-2068) |

### 3.11 Rendez-vous (`canAccessPatient` + scope)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/appointments` | GET/POST | NURSE+ | Calendrier RDV listInRange scope obligatoire (US-2500) |
| `/api/appointments/[id]` | GET/PUT/DELETE | NURSE+ | Détail RDV (note/motif/cancelReason chiffrés AES-256-GCM) |
| `/api/appointments/[id]/confirm` | POST | DOCTOR+ | Confirmer RDV (auto vs validation manuelle US-2505) |
| `/api/appointments/[id]/cancel` | POST | NURSE+ | Annulation (state machine, TTL 7j alternative) |
| `/api/appointments/[id]/propose-alternative` | POST | NURSE+ | Propose nouveau créneau |
| `/api/appointments/[id]/accept-alternative` | POST | NURSE+ | Accept proposition contre-RDV |

### 3.12 Facturation (NURSE+ pour lecture, DOCTOR+/ADMIN pour mutations)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/billing/invoices` | GET/POST | NURSE+ (canReadInvoice) | Liste/création factures + customerSnapshot AES-256-GCM |
| `/api/billing/invoices/[id]` | GET/PUT | NURSE+ | Détail facture |
| `/api/billing/invoices/[id]/issue` | POST | DOCTOR+ | Émettre facture (numérotation séquentielle gap-less) |
| `/api/billing/invoices/[id]/cancel` | POST | DOCTOR+ | Annuler facture (immuable post-issue, trigger PG) |
| `/api/billing/invoices/[id]/pay` | POST | DOCTOR+ | Marquer payée |
| `/api/billing/invoices/[id]/pdf` | GET/POST | auth (canReadInvoice) | PDF pdf-lib multi-page + IBAN chiffré (US-2102) |

### 3.13 Urgences & alertes (NURSE+ + `canAccessPatient`)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/emergency-alerts` | GET/POST | NURSE+ (canAccessPatient) | Inbox urgences (US-2224) |
| `/api/emergency-alerts/[id]` | GET | NURSE+ (canAccessPatient) | Timeline urgence + snapshot CGM 30min chiffré (US-2225) |
| `/api/emergency-alerts/[id]/actions` | POST | NURSE+ (canAccessPatient) | Workflow ack/resolve race-safe (US-2226) |
| `/api/alerts/templates` | GET/POST/PUT | DOCTOR+ (NURSE pour read) | Templates seuils alertes cabinet (US-2220) |
| `/api/alerts/templates/[id]` | GET/PUT/DELETE | DOCTOR+ | Détail template |
| `/api/patient/alert-thresholds` | GET/PUT | auth (PUT=DOCTOR+) | Config seuils hypo/hyper patient (US-2215) |
| `/api/patient/ketone-thresholds` | GET/PUT | auth (PUT=DOCTOR+) | Seuils cétones ISPAD (US-2216) |
| `/api/patient/hypo-treatment` | GET/PUT | auth (PUT=DOCTOR+) | Protocole resucrage rule of 15/15 (US-2217) |
| `/api/patient/risk-score` | GET | auth | Score risque 0-100 (3 facteurs US-2229) |
| `/api/patient/risk-score/acknowledge` | POST | auth | Patient ack score |
| `/api/patient/quarterly-report` | GET | auth | Rapport trimestriel urgences (cache + recompute) |

### 3.14 Modes patient (canAccessPatient + GDPR + auditedRequireRole)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/patient/modes/[type]` | GET/POST | NURSE+ ou VIEWER own | Activation mode (pédiatrique/Ramadan/voyage — US-2233/34/35) |
| `/api/patient/modes/[type]/deactivate` | POST | DOCTOR+ | Désactivation mode |
| `/api/patient/modes/[type]/history` | GET | VIEWER own | Historique versions mode |
| `/api/patient/modes/validate` | POST | DOCTOR+ | Validation médicale mode (force override chiffré) |
| `/api/patient/modes/travel/auto-protocol` | POST | NURSE+ | Basal protocol transitoire ATTD/EASD 2022 |
| `/api/patient/pregnancy-mode` | GET/PUT | auth | Toggle mode grossesse + auto-adapt GD defaults (US-2232) |
| `/api/patient/emergency-contacts` | GET/PUT | NURSE+ ou VIEWER own + GDPR | Contacts urgence (max 5/patient, PHI chiffré US-2218) |
| `/api/patient/escalation-rules` | GET/PUT | NURSE+ ou VIEWER own + GDPR | Patient → contact → doctor → SAMU (US-2219) |
| `/api/patients/[id]/third-party-share` | GET/PUT | NURSE+ (canAccessPatient) + GDPR | Partage tiers (FSM validation DOCTOR US-2240) |
| `/api/patients/[id]/share-audit` | GET | DOCTOR+ (canAccessPatient) | Audit partages temporaires (US-2239) |
| `/api/patients/[id]/shared-notifications` | GET/PUT | NURSE+ (canAccessPatient) + GDPR | Notifs multi-aidants matrice (US-2242) |
| `/api/patients/[id]/scheduled-messages` | GET/POST | NURSE+ (canAccessPatient) + GDPR | Messages programmés patient (US-2261) |
| `/api/patients/[id]/scheduled-messages/[notifId]` | DELETE | DOCTOR+ (canAccessPatient) | Cancel notification |

### 3.15 Admin (ADMIN-only)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/admin/users` | GET/POST | ADMIN | Gestion utilisateurs (anti-lockout Serializable US-2148) |
| `/api/admin/users/[id]` | GET/PUT/DELETE | ADMIN | Détail user + role/status update + JWT revocation atomique |
| `/api/admin/audit-logs` | GET | ADMIN | Audit logs (filtres userId/resource/action/from/to, GIN partial index) |
| `/api/admin/data-breaches` | GET/POST | ADMIN | Registre violations CNIL (US-2137 FSM 5 statuses) |
| `/api/admin/data-breaches/[id]` | GET/PUT | ADMIN | Détail breach (chiffrement AES) |
| `/api/admin/data-breaches/[id]/transition` | POST | ADMIN | Transition FSM (draft→under_assessment→notified→closed) |
| `/api/admin/system-health` | GET | ADMIN | Snapshot DB/Redis/CGM lag/backups/sessions (US-2150) |
| `/api/admin/backups` | GET/POST | ADMIN | Backup management (concurrency guard, BigInt-safe DTO US-2151) |
| `/api/admin/healthcare-services` | GET/POST | ADMIN | Liste/création cabinets |
| `/api/admin/healthcare-services/[id]` | GET/PUT/DELETE | ADMIN | Détail cabinet |
| `/api/admin/retention` | POST | ADMIN | Trigger rétention 6 ans audit logs (SQL SECURITY DEFINER) |
| `/api/admin/config-history` | GET | NURSE+ | Historique versions config patient (versioned trigger US-2221) |
| `/api/admin/config-history/[id]/validate` | POST | DOCTOR+ | Validation médicale version config |
| `/api/cabinet/[id]/settings` | GET/PUT | NURSE+ (manager-level)/ADMIN | Settings cabinet (régaliens siret/tva/iban=ADMIN-only US-2147) |
| `/api/cabinet/[id]/sms-config` | GET/PUT | ADMIN | Toggle SMS + crédits cabinet (US-2506) |

### 3.16 Cron (`Bearer CRON_SECRET`, pas user-role)

| Route | Verbe | Auth | Notes |
|-------|-------|------|-------|
| `/api/cron/appointments/reminders` | POST | CRON_SECRET | Rappels RDV multi-canal (push J-0 / SMS J-1 / email J-2 — US-2502) |
| `/api/cron/billing/reminders` | POST | CRON_SECRET | Relances factures J+7/15/30 via Resend (US-2108) |

### 3.17 Config référentielle (NURSE+ pour lecture, ADMIN pour mutations)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/config/currencies` | GET/POST | NURSE+ (POST=ADMIN) | Devises EUR/DZD (ISO 3166/4217 US-2113) |
| `/api/config/currencies/[id]` | PUT/DELETE | ADMIN | CRUD devise |
| `/api/config/tax-rules` | GET/POST | NURSE+ (POST=ADMIN) | Règles fiscales par pays (date-bounded US-2114) |
| `/api/config/tax-rules/active` | GET | NURSE+ | TVA active à un moment T (US-2110) |
| `/api/config/tax-rules/[id]` | PUT/DELETE | ADMIN | CRUD règle fiscale |
| `/api/config/regulations` | GET/POST | NURSE+ (POST=ADMIN) | Réglementation santé par pays (RPPS/ADELI/INS/HDS US-2116) |
| `/api/config/regulations/[id]` | PUT/DELETE | ADMIN | CRUD régulation |
| `/api/units` | GET | auth | Référentiel unités (15 codes) |

### 3.18 Médicaments (BDPM — ADMIN pour import, NURSE+ pour read)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/medications/search` | GET | auth | Recherche médicaments (trigram + DCI + CIP, ANSM) |
| `/api/medications/atc` | GET | auth (mutations=ADMIN) | Classification ATC |
| `/api/medications/import` | POST | ADMIN | Trigger import BDPM (ClamAV scan, rate-limit 1/h) |

### 3.19 Interop FHIR (ADMIN pour config, DOCTOR+ pour push)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/interop/fhir/push` | POST | DOCTOR+ (canAccessPatient) | Push FHIR R4 (US-2123 SSRF guard + DPA allowlist) |
| `/api/interop/fhir/sync-status` | GET | DOCTOR+ (canAccessPatient) ou ADMIN | Statut sync FHIR |
| `/api/interop/fhir/[id]/retry` | POST | ADMIN | Retry queue payload |
| `/api/interop/fhir/allowed-systems` | GET/POST | ADMIN | Allowlist systèmes FHIR autorisés |
| `/api/interop/fhir/allowed-systems/[id]` | PUT/DELETE | ADMIN | CRUD système FHIR |

### 3.20 Sync mobile (auth + GDPR)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/sync/pull` | GET | auth + GDPR | Pull data mobile (deltas depuis lastSync) |
| `/api/sync/push` | POST | auth + GDPR | Push data mobile (CGM/events bulk) |
| `/api/userdata` | GET | auth + GDPR | Export RGPD self-service patient |

### 3.21 Dashboards (auditedRequireRole)

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/dashboard/medecin/urgencies` | GET | NURSE+ | Card urgences en cours (polling 30s, US-2401) |
| `/api/dashboard/medecin/appointments` | GET | NURSE+ | Card RDV du jour (US-2402) |
| `/api/dashboard/medecin/patients-at-risk` | GET | DOCTOR+ | Card patients à suivre (US-2403) |
| `/api/dashboard/medecin/kpi` | GET | DOCTOR+ | KPI cabinet 14j (US-2404) |
| `/api/dashboard/infirmier/kpi` | GET | NURSE+ | KPI ma journée (US-2406) |
| `/api/dashboard/infirmier/todo` | GET | NURSE+ | To-do du jour (US-2407) |
| `/api/dashboard/infirmier/team-inbox` | GET | NURSE+ | Coordination équipe (US-2408) |
| `/api/dashboard/infirmier/recall-list` | GET | NURSE+ | Relances en attente (US-2409) |
| `/api/dashboard/admin/kpi` | GET | ADMIN | KPI cabinet admin (heuristique V1) |
| `/api/dashboard/admin/billing` | GET | ADMIN | Facturation à traiter (US-2412) |
| `/api/dashboard/admin/compliance` | GET | ADMIN | Conformité RGPD (heuristique V1) |
| `/api/cohort/analytics` | GET | DOCTOR+/ADMIN | Cohorte analytics (US-2228 vs benchmark) |
| `/api/cohort/risk-dashboard` | GET | DOCTOR+ | Détection patterns risque (US-2229) |

### 3.22 Import & autres

| Route | Verbe | Rôle min | Notes |
|-------|-------|----------|-------|
| `/api/import/mydiabby/connect` | POST | DOCTOR+ + GDPR | Connect MyDiabby account |
| `/api/import/mydiabby/disconnect` | POST | DOCTOR+ | Disconnect |
| `/api/import/mydiabby/accounts` | GET | DOCTOR+ | Liste comptes MyDiabby liés |
| `/api/import/mydiabby/sync` | POST | DOCTOR+ | Sync CGM/events depuis MyDiabby |
| `/api/health` | GET | public | Health check (DB ping) |
| `/api/openapi.json` | GET | public | Spec OpenAPI (TODO non implémenté) |

---

## 4. Capacités transversales

### 4.1 Scope patient (`canAccessPatient`)

Pour toutes les routes `/api/patients/[id]/*` et certaines `/api/patient/*` :

| Rôle | Scope autorisé |
|------|----------------|
| ADMIN | Tous les patients (sans restriction) |
| DOCTOR | Référent direct + patients du même cabinet (PatientService) |
| NURSE | Patients du même cabinet (PatientService) |
| VIEWER | Son propre patient uniquement (via `getOwnPatientId`) |

Tout accès cross-scope déclenche `auditService.accessDenied` (US-2265 burst detection 50/60s).

### 4.2 Consentement RGPD (`requireGdprConsent`)

Requis sur toutes routes manipulant des données de santé patient :
- `/api/cgm`, `/api/analytics/*`, `/api/events`, `/api/insulin-therapy/*`
- `/api/documents`, `/api/messages`, `/api/sync/*`
- `/api/patients/[id]/glycemia|cgm|analytics|adherence|...`

Lecture cachée en Redis 5min, fallback Prisma. 403 `gdprConsentRequired` si manquant.

> TODO V1.5 (M-5 review PR #426) : sémantique Art. 9.2.h vs 9.2.a — pour un pro
> qui lit des données patient, le check devrait être sur `patient.userId`, pas
> sur `user.id` (pro). Cf. JSDoc `src/lib/gdpr.ts`.

### 4.3 Audit (`auditService.log`)

Tout accès à une donnée patient (CREATE/READ/UPDATE/DELETE) génère un audit immuable :
- `userId`, `action`, `resource`, `resourceId` (ID natif US-2268)
- `metadata.patientId` (pivot forensique via GIN partial index)
- `ipAddress`, `userAgent`, `requestId`
- Trigger PG immuabilité (`audit_immutability.sql`)
- Rétention 6 ans (anonymisation PII, US-2133)

### 4.4 Chiffrement AES-256-GCM

PHI patient toujours chiffré before insert :
- User : `email`, `firstname`, `lastname`, `phone`, `address`, `nirpp`, `ins`
- Patient `MedicalData` : `historyMedical/Chirurgical/Family/Allergy/Vaccine/Life`
- `MessageBody`, `MessageRecipient`, `AppointmentReminder.sentToEnc`
- `Invoice.customerSnapshot.ibanEnc`, `SmsLog.toEnc`
- `MealPhoto`, `Document` (S3 SSE-S3)
- `EmergencyContact`, `EscalationRule`, `DataBreach.description`

### 4.5 Rate limiting

- Login : 3 fails → backoff 5/15/60min (in-memory dev, Upstash Redis prod)
- Push send : 50/h fail-closed
- BDPM import : 1/h
- Routes API analytics : burst détection US-2005

### 4.6 Cron secrets

Routes `/api/cron/*` :
- POST uniquement (H3 round 2 — pas de leak via GET access logs)
- `Authorization: Bearer ${CRON_SECRET}` timing-safe (`timingSafeEqual`)
- 503 si CRON_SECRET non configuré (ADR #20 early-fail)
- Headers ANSSI sur 200/401/503 (Cache-Control no-store + Referrer-Policy + nosniff)
- Audit `cron.auth.failed` sur Bearer invalide

---

## 5. Matrice de synthèse — fonctionnalités macro par rôle

| Domaine fonctionnel | VIEWER | NURSE | DOCTOR | ADMIN |
|---------------------|:------:|:-----:|:------:|:-----:|
| **Mon profil + préférences** | ✅ | ✅ | ✅ | ✅ |
| **Mes propres données médicales** | ✅ | — | — | — |
| **Export RGPD self-service** | ✅ | ✅ | ✅ | ✅ |
| **Liste patients (cabinet)** | — | ✅ | ✅ | ✅ |
| **Création / onboarding patient** | — | — | ✅ | ✅ |
| **Lecture CGM patients** | own | cabinet | cabinet | tous |
| **Analytics cabinet (TIR/AGP/cohortes)** | — | ✅ | ✅ | ✅ |
| **Création InsulinConfig (sans validation)** | — | ✅ | ✅ | ✅ |
| **Validation InsulinConfig (medical sign-off)** | — | — | ✅ | ✅ |
| **Calcul bolus + log immuable** | own | ✅ | ✅ | ✅ |
| **Propositions ajustement (accept/reject)** | — | — | ✅ | ✅ |
| **Devices pairing + supervision** | own (R) | ✅ | ✅ | ✅ |
| **Messagerie patient↔PS** | ✅ | ✅ | ✅ | ✅ |
| **Templates messages cabinet** | — | R | ✅ | ✅ |
| **Documents upload** | — | ✅ | ✅ | ✅ |
| **Documents download** | own | ✅ | ✅ | ✅ |
| **RDV CRUD + workflow cancel/propose** | — | ✅ | ✅ | ✅ |
| **RDV confirm (médical)** | — | — | ✅ | ✅ |
| **Facturation lecture** | — | ✅ | ✅ | ✅ |
| **Facturation émettre/payer** | — | — | ✅ | ✅ |
| **Urgences inbox + workflow** | — | ✅ | ✅ | ✅ |
| **Seuils alertes patient (config)** | — | — | ✅ | ✅ |
| **Modes patient (pédiatrique/Ramadan/voyage)** | own (R+POST) | ✅ | ✅ | ✅ |
| **Validation médicale mode + force override** | — | — | ✅ | ✅ |
| **Partage tiers temporaire** | — | ✅ | ✅ | ✅ |
| **Validation partage tiers (FSM DOCTOR)** | — | — | ✅ | ✅ |
| **Gestion utilisateurs (CRUD + role/status)** | — | — | — | ✅ |
| **Consultation audit logs** | — | — | — | ✅ |
| **Registre violations CNIL (FSM)** | — | — | — | ✅ |
| **System health + backups** | — | — | — | ✅ |
| **Config cabinet (régaliens siret/tva/iban)** | — | — | — | ✅ |
| **Config cabinet (manager-level)** | — | ✅ (manager) | ✅ (manager) | ✅ |
| **Config SMS cabinet (toggle + crédits)** | — | — | — | ✅ |
| **Config référentielle (devises/TVA/régulations)** | — | R | R | ✅ |
| **Import BDPM (référentiel médicaments)** | — | — | — | ✅ |
| **FHIR push (interop)** | — | — | ✅ | ✅ |
| **FHIR allowed-systems config** | — | — | — | ✅ |
| **Rétention 6 ans (trigger SQL)** | — | — | — | ✅ |

**Légende** :
- ✅ = accès direct
- `own` = uniquement ses propres données (VIEWER scope)
- `cabinet` = patients du même cabinet (NURSE/DOCTOR)
- `R` = lecture seule
- `manager` = manager-level subset (cabinet settings hors régaliens)
- `—` = pas d'accès

---

## 6. Notes de gouvernance

### 6.1 Bloqueurs pre-prod patients réels

Issues GitHub ouvertes (cf. ROADMAP) :
- #419 — Test E2E pool advisory lock staging Postgres
- #420 — EXPLAIN ANALYZE GIN runId dataset ≥ 1M
- #421 — Décision DPO `optOutSkipped` count
- #422 — Décision business V1.5 retrait mock SMS vs CGU
- #425 — Refonte routing dashboard pro vs patient (rename `/dashboard` → `/me/glycemia`)

### 6.2 V2 reportés (procurement bloqué)

Cf. ROADMAP §V2 : 19 US déplacées V1→V2 le 2026-05-15 (ANS / Mailiz / Sentry / Stripe / Medtronic / partenaire DZ). Voir liste complète dans `docs/ROADMAP.md` ligne 25.

### 6.3 Conventions d'audit (US-2268 ADR #18)

- `auditLog.resourceId` = ID natif (jamais composite)
- `metadata.patientId` = pivot pour forensique CNIL/ANS
- GIN partial index `audit_logs(metadata->'patientId') WHERE metadata ? 'patientId'`
- Helper `auditService.getByPatient(patientId)` < 100ms sur 10M rows

---

*Document généré 2026-05-23. Régénérable via greps sur `requireRole / auditedRequireRole / requireAuth` dans `src/app/api/**/route.ts` et `src/app/**/page.tsx`.*
