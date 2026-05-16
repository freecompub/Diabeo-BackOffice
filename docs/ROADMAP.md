# Roadmap Diabeo Backoffice — User Stories intégrées

> **Mise à jour 2026-05-15 (post-PR #409) — Reclassification V1→V2 (15 US)** : décision Samir de déplacer en V2 toutes les US bloquées par procurement externe (ANS / Mailiz / Sentry / Stripe / Medtronic / partenaire bancaire DZ) ou par dépendances internes V3 (US-2150/US-2200), pour clarifier le scope V1 livrable sans dépendance non maîtrisée. **US reclassées** : US-2031 (Medtronic), US-2041 (Pattern AI), US-2077 (MSSanté UX, dep US-2125), US-2104 (Abonnement DZ), US-2106 (Stripe webhooks), US-2109 (Remboursements), US-2124 (DMP), US-2125 (MSSanté backend), US-2126 (INSi), US-2127 (PSC), US-2153 (Logs), US-2164 (APM), US-2165 (Error tracking), US-2411 (KPI cabinet admin), US-2413 (Conformité RGPD admin). **Impact stats** : V1 141→126 (% DONE 59→66), V2 58→73. Total 292 inchangé. Cf. tableau V1 + V2 ci-dessous.

> Précédente mise à jour : 2026-05-15 — Groupe 9 Admin & Ops Batch 1 livré (PR #409, 4 US internes US-2007/2137/2147/2150, ~4 SP, option A). Migration `20260515400000_groupe9_admin_ops` : Session enrichi (createdAt/ipAddress/userAgent/lastSeenAt + index user+createdAt) + nouveau model `DataBreach` (RGPD Art. 33 registre violations) + 2 enums (DataBreachSeverity low/medium/high/critical, DataBreachStatus FSM `draft→under_assessment→notified_cnil→notified_users→closed` terminal). 4 services : `session-management.service` (listOwn isCurrent flag / revokeOne self-only avec accessDenied audit US-2265 sur cross-user / revokeOthers preserve current via WHERE not in), `data-breach.service` (declare + transition FSM avec ALLOWED_TRANSITIONS + chiffrement AES-256-GCM description/remediation/cnilCaseNumber + `cnilDeadlineHoursRemaining` cap 0 + flag `cnilDeadlineExceeded` + heuristique anti-PHI title regex NIRPP/téléphone/email), `cabinet-settings.service` (manager-level subset vs ADMIN full CRUD US-2117/2118, openingHoursSchema validation typed CabinetSettingsValidationError 422), `system-health.service` (snapshot Promise.all DB+Redis+CGM lag+backups freshness+active sessions+unauthorizedAttempts24h + per-check withTimeout 2000ms + pingRedis distingue not_configured/ok/down). 10 nouvelles routes : 3 sessions (/api/account/sessions + [id]) + 4 data-breaches (/api/admin/data-breaches + [id] + [id]/transition) + 2 cabinet-settings (/api/cabinet/[id]/settings GET+PUT) + 1 system-health (/api/admin/system-health). touchSession câblé Node `/api/auth/refresh` (~15min cycle) + lazy bump `listOwn` (middleware Edge incompatible Prisma). AuthUser.sessionId injecté via x-session-id header middleware. AuditResource enum +3 : DATA_BREACH / SYSTEM_HEALTH / CABINET_SETTINGS. Audit kinds typés unions + AUDIT_KIND const satisfies. **2 rounds review** (code-reviewer) : 19 findings (4H + 8M + 7L) — 0 résiduel Critical/High. NEW-M2 PHI heuristic regex sans ReDoS + cap 200c title + JSDoc ⚠️ schema. NEW-M3 backup freshness 30h→36h. NEW-M4 metrics rename recentErrors24h→unauthorizedAttempts24h (sémantique honnête RBAC fail). NEW-L1 audit metadata.fields noms business (description vs descriptionEnc). NEW-L5 detectedAt window 1y→5y. V1 79 → 83 DONE (59%). Total 147/292 → 151/292 (**52%**). 1887/1887 tests verts. ⚠️ Batch 2 Groupe 9 (4 US ⏳ Blocked procurement) : US-2004 Cloudflare Turnstile, US-2153 Logs Loki/OVH, US-2164 APM Sentry, US-2165 Error Sentry. V1 follow-ups : touchSession Redis throttle > 50k users actifs, pingRedis memoize 30s, OpenAPI doc anti-PHI title contract.

> Précédente mise à jour : 2026-05-15 — Groupe 1 Devices supervision + sync status livré (PR #408, 2 US US-2243/2244, ~8 SP). Étend `PatientDevice` avec 3 colonnes (`batteryLevel` 0-100%, `sensorExpiresAt`, `lastSyncAt`) + 2 indexes (cohort filter + sensor expiration). Migration `NOT VALID + VALIDATE` (zero-downtime). 2 services : `device-supervision.service` (listByPatient/listCohort/recordSyncPing) avec DTO computed (`batteryLow <20%`, `sensorExpired <now`, `sensorExpiringSoon now..now+3j`) + `device-sync-status.service` (computeStatus pure helper + getStatus aggregate MAX(lastSyncAt) + cohortStatus avec merge accessibleIds → patients sans devices = `never_synced`). 5 routes API : GET `/api/patients/[id]/devices/{supervision,sync-status}` (VIEWER own / NURSE+ cabinet) + GET `/api/devices/{supervision,sync-status}/cohort` (NURSE+) + POST `/api/patients/[id]/devices/[deviceId]/sync-ping` (alimente lastSyncAt + optional batteryLevel/sensorExpiresAt). `requireGdprConsent` partout + `accessDenied` audit US-2265. SyncStatus enum ok/late/critical/never_synced avec seuils 5min/30min. **2 rounds review** (code-reviewer) : 18 findings (12 round-1 + 6 round-2) — 0 résiduel Critical/High. NEW-H1 sensorExpiresAt borné [2020-01-01, now+365j] (anti patient-safety bypass via VIEWER mobile). NEW-M2 soft-cap MAX_ACCESSIBLE_COHORT_PATIENTS=2000 (anti-OOM gros cabinets). Constantes partagées `COHORT_RESOURCE_ID`, `SUPERVISION_BOUNDS`, `SYNC_STATUS_BOUNDS`. AuditResource = `DEVICE` existant. V1 77 → 79 DONE (56%). Total 145/292 → 147/292 (50%). 1835/1835 tests verts. ⚠️ US-2031 Medtronic Guardian ⏳ bloqué partenariat CareLink. US-2041 Pattern detection AI ⏸️ V2. V2 follow-ups : refactor DB-side LEFT JOIN cohort (pagination > 2000 patients), filtre `sensorStale` (expiré > N jours), Zod `pipe(z.array(z.enum))` idiomatic refactor.

> Précédente mise à jour : 2026-05-15 — Groupe 6 Activité physique livré (PR #407, 3 US US-2059/2060/2061, ~7 SP). Étend `DiabetesEvent` avec 7 colonnes typées (activityIntensity / activitySteps / activityDistanceM / activityCalories / activityHeartRateAvg / activitySource / externalSyncId) + 2 enums `ActivityIntensity` (light/moderate/intense) + `ActivitySource` (manual/healthkit/google_fit/health_connect) + 6 CHECK constraints `NOT VALID + VALIDATE` (zero-downtime) + UNIQUE PARTIAL `(activitySource, externalSyncId) WHERE externalSyncId IS NOT NULL` (idempotence sync). Service `activity.service.ts` (list/create/update/delete/bulkSync) avec **comment chiffré AES-256-GCM** symétrique `eventsService` (anti data-corruption cross-service) + Zod whitelist 10 codes (`walk/run/bike/swim/hike/yoga/elliptical/rowing/strength/other`) + bornes cliniques (HR 30-250, steps ≤100k, distance ≤300km, duration ≤24h, eventDate ∈ [-2y, +5min]) + sensor entries immutables (PUT/DELETE bloqués si `activitySource ≠ manual` → forensique préservée). **bulkSync** via `createManyAndReturn` Prisma 7 atomic (1 query race-free, dedup PG ON CONFLICT) + audit metadata `insertedIds[]` granulaire + transaction timeout 30s. 5 routes `/api/patients/[id]/activity[/activityId|/sync]` (NURSE+ cabinet / VIEWER own) + `requireGdprConsent` RGPD Art. 9 + `assertJsonContentType` 415 + `assertBodySize` 413 (1MB/200KB/5MB). Helper `auditService.accessDenied` émis sur `ActivityAccessError` (US-2265 burst detection). AuditResource enum +1 : `ACTIVITY`. **3 rounds review** code-reviewer : 40 findings (29 round-1 + 7 round-2 + 4 round-3) — 0 résiduel Critical/High/Medium. Script backfill `scripts/backfill-encrypt-event-comments.ts` (dry-run + --apply, audit per-row). Doc runbook `docs/runbook/infra-body-limits.md` (nginx/Traefik/OVH LB caps). V1 74 → 77 DONE (55%). Total 142/292 → 145/292 (50%). 1782/1782 tests verts. ⚠️ V2 follow-ups : OpenAPI doc `activityType` write/read asymmetry, advisory lock concurrent sync (theoretical), partitioning `diabetes_events` si volume > 50M rows.
> Total : **268 US** (217 pro + 51 mirror) · MVP completion : **100%** (63/63 DONE — scope original)

---

## Taux de réalisation

| Priorité | Total | DONE | PARTIAL | NOT STARTED | % Done |
|----------|-------|------|---------|-------------|--------|
| **MVP**  | 68    | 68   | 0       | 0           | **100%** |
| **V1**   | 126   | 89   | 0       | 37          | **71%** |
| **V2**   | 74    | 0    | 0       | 74          | **0%**  |
| **V3**   | 9     | 0    | 0       | 9           | **0%**  |
| **V4**   | 16    | 0    | 0       | 16          | **0%**  |
| **TOTAL**| **293** | **157** | **1**   | **135**     | **54%** |

> **Reclassification 2026-05-15** : 15 US déplacées V1 → V2 (V1 141→126, V2 58→73). Motifs : procurement externe bloqué (ANS / Mailiz / Sentry / Stripe / Medtronic / partenaire bancaire DZ), deps internes V3 (US-2150/US-2200), spec V2 (AI pattern). US déplacées : US-2031, US-2041, US-2077, US-2104, US-2106, US-2109, US-2124, US-2125, US-2126, US-2127, US-2153, US-2164, US-2165, US-2411, US-2413.
> Note (2026-05-13 session Samir) : Q6 US-2414 supprimée (V1 −1), Q7 module
> RDV ajouté V1 (+7 US US-2500-2506 = +49 SP), Q8 US-2800 ajoutée V4 (+1).
> Total : 286 → 294 (+8).

> ⚠️ +20 US ajoutées suite au commit `f6700a0` (dashboards). 16 backoffice
> renumérotées `US-2400-2415` (conflit `US-2265-2280` ↔ batch audit déjà
> livré PR #349/#352/#354). 4 patient-web (US-3356/3361/3362/3363) gardent
> leur numéro. Les 5 patient-mobile (US-3355/3357-3360, 39 SP) restent
> hors scope ce repo (iOS app séparée).

> MVP scope original (63 US) → **63/63 = 100%** ✅. Avec Batch D1 (US-2265+US-2266) → **65/65**.
> US-2267 (Migrations Prisma versionnées) ✅ DONE PR #352 — pre-prod blocker levé.
> US-2268 (auditLog.resourceId convention) ✅ DONE PR #353 — forensics CNIL/ANS opérationnel.

---

## Décisions architecturales (conflits résolus)

| Sujet | Décision | US concernées |
|-------|----------|---------------|
| CGM Ingestion | MyDiabby seul pour MVP, API Dexcom/Abbott en V1 | US-2029, US-2030 |
| Push Notifications | Firebase FCM (iOS + Android + Web) | US-2073 |
| Prescriptions (45 US) | Reporter en V2+. Seul US-2171 (BDPM) en MVP | US-2169→US-2213 |
| Upload Documents | OVH S3 immédiat (retirer 501) | US-2140 |

## Fusions (redondances)

| Doublon | Résolution |
|---------|------------|
| US-2132 = US-2011 | US-2132 alias de US-2011 (audit log). DONE. |
| US-2026 ↔ US-2126 | US-2026 = modèle patient INS, US-2126 = API INSi. Liés. |
| US-2077 ↔ US-2125 | US-2077 = UX MSSanté, US-2125 = backend. Liés. |
| US-2008 ↔ US-2127 | US-2008 = login PSC, US-2127 = intégration technique. Liés. |
| US-2148 ↔ US-2012 | US-2012 DONE (backend RBAC), US-2148 = UI admin. |
| US-2024 ↔ US-2011 | US-2024 = UI consultation audit log, pas nouveau système. |

---

## MVP — 63 US

### Domaine 01 — Auth & Sécurité (10 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2001 | Login JWT RS256 | DONE | `src/lib/auth/jwt.ts`, `src/app/api/auth/login/` |
| US-2002 | 2FA TOTP | DONE | `src/lib/services/mfa.service.ts`, `src/app/api/auth/mfa/*` |
| US-2003 | Reset password | DONE | `src/app/api/auth/reset-password/` |
| US-2005 | Rate limiting login | DONE | `src/lib/auth/rate-limit.ts`, `src/lib/auth/api-rate-limit.ts` |
| US-2006 | Politique mot de passe | DONE | Validation dans auth services |
| US-2011 | Audit log immuable | DONE | `src/lib/services/audit.service.ts`, `prisma/sql/audit_immutability.sql` |
| US-2012 | RBAC 4 rôles | DONE | `src/lib/auth/rbac.ts` |
| US-2013 | Consentement RGPD | DONE | `src/lib/gdpr.ts`, `src/app/api/account/privacy/` |
| US-2015 | Chiffrement AES-256-GCM | DONE | `src/lib/crypto/health-data.ts` |
| US-2132 | Audit log RGPD (alias US-2011) | DONE | Alias |

### Domaine 02 — Patients (7 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2016 | Liste patients filtrable | DONE | `src/app/(dashboard)/patients/page.tsx`, `src/app/api/patients/` |
| US-2017 | Création / onboarding patient | DONE | Wizard 2 étapes (identité + pathologie), `src/app/(dashboard)/patients/new/page.tsx`, bouton "Nouveau patient" dans la liste. PR #341. |
| US-2018 | Fiche patient complète | DONE | `src/app/(dashboard)/patients/[id]/page.tsx` (4 tabs) |
| US-2020 | Archivage / soft delete | DONE | `deletion.service.ts`, trigger PostgreSQL |
| US-2023 | Notes cliniques | DONE | Intégré dans patient service |
| US-2025 | Invitation mobile QR code | DONE | PR #350 — JWT court 15min, audience dédiée, deep link diabeo:// + fallback HTTPS |
| US-2082 | Affectation soignant référent | DONE | `PatientReferent` modèle, `/api/patient/referent/` |

### Domaine 03 — Glycémie & CGM (7 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2029 | Ingestion CGM Dexcom | DONE | Via MyDiabby (décision MVP) |
| US-2030 | Ingestion FreeStyle Libre | DONE | Via MyDiabby (décision MVP) |
| US-2033 | Temps dans la cible (TIR) | DONE | `analytics.service.ts`, `statistics.ts`, `TimeInRangeChart` |
| US-2034 | Profil AGP | DONE | `computeAgp`, `/api/analytics/agp/` |
| US-2035 | GMI / HbA1c estimée | DONE | `glucoseManagementIndicator` dans statistics |
| US-2036 | Coefficient de variation | DONE | `coefficientOfVariation` dans statistics |
| US-2037 | Détection hypo/hyper | DONE | `detectHypoEpisodes`, `HypoglycemiaWidget` |

### Domaine 04 — Insulinothérapie (9 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2042 | Schéma basal/bolus | DONE | `insulin.service.ts`, `insulin-therapy.service.ts` |
| US-2044 | Ratios glucides (ICR) | DONE | `CarbRatio`, `/api/insulin-therapy/carb-ratios/` |
| US-2045 | Facteur sensibilité (ISF) | DONE | `InsulinSensitivityFactor`, `/api/insulin-therapy/sensitivity-factors/` |
| US-2046 | Profils basaux pompe | DONE | `BasalConfiguration` + `PumpBasalSlot` |
| US-2047 | Workflow ajustement 3 étapes | DONE | PR #351 — UI `/adjustment-proposals` (list pending + accept/reject), backend OK |
| US-2048 | Bornes sécurité cliniques | DONE | `src/lib/clinical-bounds.ts` |
| US-2049 | Calcul de bolus | DONE | `/api/insulin-therapy/calculate-bolus/`, `BolusCalculationLog` |
| US-2051 | Historique modifications | DONE | AuditLog + service tracking |
| US-2063 | Création proposition ajustement | DONE | `adjustment.service.ts`, `/api/adjustment-proposals/*` |

### Domaine 05 — Téléconsultation (2 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2063 | Proposition ajustement | DONE | (voir Domaine 04) |
| US-2064 | Notification patient proposition | DONE | `adjustment.service.ts:notifyPatient()` FCM push on accept/reject, returns `{ notified }`. PR #341. |

### Domaine 06 — Messagerie & Notifications (4 US — 1 follow-up Mirror MVP)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2073 | Push notifications mobile (FCM) | DONE | `src/lib/firebase/admin.ts`, `src/lib/services/fcm.service.ts`, `src/app/api/push/send/route.ts`. Firebase Admin SDK, retry retriable-only, canAccessPatient authz, rate limit fail-closed 50/h, no cleartext in logs, locale-aware templates, 20 tests. PR #340. |
| US-2074 | Email transactionnel (Resend) | DONE | `src/lib/services/email.service.ts`. Reset password, welcome, proposal notification. HTML escaping, no PII. PR #341. |
| US-2079 | Préférences notifications | DONE | `UserNotifPreferences`, `/api/account/notifications/` |
| US-2266 | Email médecin sur alerte critique | DONE | 3 SP — PR #349. `emailService.sendDoctorEmergencyAlert` (PHI-safe, deep link), `notifyCriticalAlert` parallèle push+email avec timeout 5s, audit `EMAIL_SUBMITTED` (HDS-truthful), `CONFIG_ERROR` sur déchiffrement échoué. |

### Domaine 07 — Équipe & Cabinet (2 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2081 | Cabinet multi-utilisateurs | DONE | `HealthcareService` + `HealthcareMember` |
| US-2082 | Affectation référent | DONE | `PatientReferent` |

### Domaine 08 — Dispositifs (2 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2089 | Pairing device | DONE | PR #351 — UI `/devices/pair` 3-step wizard (catégorie+modèle, série+connexion, confirm) |
| US-2090 | Statut synchronisation | DONE | `DeviceDataSync`, `/api/devices/sync-status/` |

### Domaine 09 — i18n (2 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2112 | i18n FR/EN/AR | DONE | PR #351 — LocaleSwitcher + PUT `/api/account/locale` cookie, `<html dir="rtl">` pour AR, 3 fichiers messages |
| US-2115 | Formats date/nombre | DONE | PR #351 — `src/lib/intl/formatters.ts` (date, time, relativeTime, number, percent, currency, glucose, insulin, carbs) + `useFormatters` hook |

### Domaine 10 — Entités organisationnelles (2 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2117 | Cabinets médicaux | DONE | PR #351 — Schema enrichi (adresse complète, contact, openingHours JSON, specialties, capacity, managerId FK) + validation Zod + service.update |
| US-2118 | Praticiens libéraux | DONE | PR #350 — `ServiceType` enum + RPPS/ADELI Luhn validation + unique constraint |

### Domaine 11 — Conformité & RGPD (9 US — 2 follow-ups Mirror MVP)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2132 | Audit log (alias US-2011) | DONE | Alias |
| US-2133 | Rétention 6 ans audit logs | DONE | `retention.service.ts`, SQL function SECURITY DEFINER, `POST /api/admin/retention` (ADMIN). Anonymise PII sans supprimer les rows. PR #342. |
| US-2134 | Export RGPD Art.15 | DONE | `export.service.ts` |
| US-2135 | Suppression RGPD Art.17 | DONE | `deletion.service.ts` |
| US-2136 | Pseudonymisation HMAC | DONE | `hmacField()` générique, `firstnameHmac`/`lastnameHmac` dans User, index composite, user.service auto-compute. PR #342. |
| US-2138 | Hébergement HDS | DONE | OVHcloud GRA (décision archi) |
| US-2141 | Catégorisation documents | DONE | `DocumentCategory` enum |
| US-2265 | Événements `ACCESS_DENIED` audit | DONE | 2 SP — PR #349. `auditService.accessDenied` + burst RBAC (50/60s, cooldown, atomic transaction, LRU cap), helper `auditForbiddenInRoute` (jamais 403→500), wired sur 7 routes Mirror MVP. |
| US-2268 | Convention `auditLog.resourceId` normalisée | DONE | PR #353 — 8 SP — V1. Helper `getByPatient` via `$queryRaw` + GIN partial index `jsonb_path_ops` (vérifié EXPLAIN ANALYZE 200k rows : 0.28ms vs 45ms seq scan). 26 sites refactorés + 15 sites missing pivots ajoutés (documents, events, patient CRUD, bolus, mydiabby). Backfill idempotent bypass trigger via `session_replication_role = 'replica'`. RETENTION enum wiring + audit_log_apply_retention preserves patientId post-anonymisation. |

### Domaine 12 — Documents (1 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2140 | Upload S3 documents | DONE | `src/lib/storage/s3.ts`, `src/app/api/documents/upload/route.ts`, `src/app/api/documents/[id]/download/route.ts`, `src/app/api/account/photo/route.ts`. SSE-S3, ClamAV, rate limit, RBAC, audit. PR #339. |

### Domaine 13 — Administration (2 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2148 | Admin gestion utilisateurs UI | DONE | PR #350 — `userManagementService` (list/getById/updateRole/setStatus), anti-lockout Serializable, session+JWT revocation atomique |
| US-2151 | Backup management | DONE | PR #350 — `BackupLog` model + `backupService` (list/trigger/updateStatus), concurrency guard, BigInt-safe DTO, errorMessage sanitization |

### Domaine 14 — Prescriptions (1 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2171 | Base médicamenteuse BDPM | DONE | `bdpm.service.ts`, `atc.service.ts`, modèles Prisma |

### Mirror MVP (9 US — DONE PR #343)

| US | Titre | Statut | Domaine |
|----|-------|--------|---------|
| US-2214 | Config cibles glycémiques par patient | DONE | Config seuils |
| US-2215 | Config seuils hypo/hyper alertes | DONE | Config seuils — `AlertThresholdConfig`, cooldown sévérité-aware capé à 15 min sur critique |
| US-2216 | Seuils cétones | DONE | Config seuils — `KetoneThreshold`, defaults ISPAD 0.6/1.5/3.0 mmol/L, validateur strict |
| US-2217 | Protocole resucrage | DONE | Config seuils — `HypoTreatmentProtocol`, rule of 15/15, allergies/instructions chiffrées |
| US-2224 | Inbox alertes urgence | DONE | Urgences — `EmergencyAlert` + RBAC `getAccessiblePatientIds` |
| US-2225 | Timeline urgence | DONE | Urgences — snapshot CGM 30 min chiffré base64+AES-256-GCM |
| US-2226 | Workflow réaction médecin | DONE | Urgences — `EmergencyAlertAction` append-only, transitions ack/resolve race-safe |
| US-2230 | Push temps réel urgence | DONE | Urgences — FCM data-only payload, pas de PHI lockscreen |
| US-2232 | Toggle mode grossesse | DONE | Modes contextuels — `Patient.pregnancyMode` + auto-adapt CGM defaults GD, garde active-pregnancy + forceOverride chiffré |

**PR #343** — 1093 tests verts · branch coverage 78% · CI green · 5 critical + 10 high fixés en re-review (5 agents).

### Follow-ups Mirror MVP (4 US — Batch D)

| US | Titre | Priorité | SP | Issue | Statut |
|----|-------|----------|----|-------|--------|
| US-2265 | Événements `ACCESS_DENIED` audit | MVP | 2 | [#344](https://github.com/freecompub/Diabeo-BackOffice/issues/344) | ✅ DONE PR #349 |
| US-2266 | Email médecin sur alerte critique | MVP | 3 | [#345](https://github.com/freecompub/Diabeo-BackOffice/issues/345) | ✅ DONE PR #349 |
| US-2267 | Migrations Prisma versionnées | V1 + `blocker-pre-prod` | 5 | [#346](https://github.com/freecompub/Diabeo-BackOffice/issues/346) | ✅ DONE PR #352 — pre-prod blocker LEVÉ |
| US-2268 | Convention `auditLog.resourceId` normalisée | V1 | 8 | [#347](https://github.com/freecompub/Diabeo-BackOffice/issues/347) | ✅ DONE PR #353 |

**PR #349** — US-2265 + US-2266 livrés (5 SP MVP). 1102 tests verts, branch coverage maintenue, 3 agents re-review (READY/FIX-MEDIUM tous résolus avant merge).
**PR #348** mergée — Spec markdown des 4 US + issues GitHub + items board #2.

**Batch D MVP** : ✅ 100 % livré (5/5 SP). US-2267 + US-2268 V1 livrés (PR #352 + #353) = **13 SP V1**.

---

## V1 — 120 US

### Groupe 1 — Glycémie & Analytics (13 US — 11/11 DONE V1, 2 reclassées V2)

| US | Titre | Statut |
|----|-------|--------|
| US-2031 | Ingestion Medtronic Guardian | ⏸️ **V2** — bloqué partenariat CareLink (procurement) |
| US-2032 | Glycémies capillaires (BGM) | ✅ DONE PR #388 — GET + rate-limit + decrypt |
| US-2038 | Heat-map glycémique | ✅ DONE PR #388 — TZ-pinned Europe/Paris |
| US-2039 | Comparaison de périodes | ✅ DONE PR #388 — half-open windows + delta |
| US-2040 | Rapport AGP exportable PDF | ✅ DONE PR #388 — pdf-lib + warning banner |
| US-2041 | Pattern detection AI | ⏸️ **V2** per spec |
| US-2094 | Tableau de bord population | ✅ DONE PR #388 — RBAC + p-limit + GDPR filter |
| US-2095 | Indicateurs qualité cabinet | ✅ DONE PR #388 — TIR/GMI distributions |
| US-2096 | Cohorte par pathologie | ✅ DONE PR #388 — DT1/DT2/GD breakdown |
| US-2098 | Export CSV / Excel | ✅ DONE PR #388 — CSV anti-injection + fail-closed |
| US-2243 | Supervision dispositifs (CGM/pompe/lecteur) | ✅ DONE PR #408 — patient + cohort + battery/expiry/sync |
| US-2244 | Statut sync temps-réel | ✅ DONE PR #408 — OK <5min / late 5-30min / critical >30min + cohort tri critical-first |

**Batches livrés** : 8 US PR #388 (~21 SP) + 2 US PR #408 (~8 SP). Total 10 US V1 DONE.

> ⏸️ **US-2031 Medtronic Guardian — reclassée V2** (décision 2026-05-15) : bloqué partenariat Medtronic CareLink, hors scope V1.
> ⏸️ **US-2041 Pattern detection — V2** (V2 per spec — AI pattern recognition).

### Groupe 2 — Patients avancés (7 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2019 | Recherche full-text patients | DONE (PR #389 — HMAC exact + Pathology + consent filter) |
| US-2021 | Transfert patient entre médecins | DONE (PR #389 — ADMIN/référent/self-claim only) |
| US-2022 | Tags & catégorisation patients | DONE (PR #389 — 2 modèles Prisma + 4 routes + anti-PII) |
| US-2024 | Historique modifications (UI audit) | DONE (PR #389 — PHI redacted, DOCTOR+ only) |
| US-2026 | INS — Identité Nationale Santé | NOT STARTED (V1, 8 SP — Batch 3 standalone) |
| US-2028 | Dossier multi-praticiens | DONE (PR #389 — referents view) |

**Batches 1+2 livrés** : 5 US (US-2019, 2021, 2022, 2024, 2028) — PR #389, ~5 SP,
1282 tests verts, 35 findings de review traités (3 Critical + 11 High + 15 Medium + 8 Low).

### Groupe 3 — Équipe & Communication (12 US — US-2070/2071 dédoublonnés vers Groupe 8 RDV)

| US | Titre | Statut |
|----|-------|--------|
| US-2076 | Messagerie sécurisée patient↔PS (REST + polling 60s + FCM, **sans WS**) | ✅ **DONE PR #412 (2026-05-16)** — 6 rounds review (3 agents en parallèle), 1957/1957 tests, HMAC pepper + audit accessDenied + DPIA livré |
| US-2076bis | Messagerie realtime layer (WS/SSE chat-only) | ⏸️ **V2** — scope B reporté, gain UX marginal en contexte médecin↔patient (~5 SP) |
| US-2077 | MSSanté intégration | ⏸️ **V2** — dep US-2125 backend (Mailiz/Apicrypt) lui-même V2 |
| US-2078 | Templates de messages | DONE (PR #390) |
| US-2080 | Accusés de lecture | DONE (PR #390 — ReadReceipt générique + H9 access check) |
| US-2083 | Délégation médecin → IDE | DONE (PR #390 — IDE→DOCTOR workflow + colleague enforcement) |
| US-2084 | Remplacement / congés | DONE (PR #390 — cabinet-scoped + audit READ) |
| US-2086 | Handoff entre soignants | DONE (PR #390 — chiffré + consent filter) |
| US-2088 | Groupes patients par équipe | DONE (PR #390 — cohortes cabinet + M:N) |
| US-2065 | Accusé réception patient | DONE (PR #390 — patient ack avec auditUserId) |
| US-2066 | Suivi application réelle | DONE (PR #390 — verifiedVia + overwrite guard) |
| US-2068 | Notes consultation | DONE (PR #390 — chiffré + appointment-patient guard) |
| US-2072 | Facturation acte téléconsult | DONE (PR #390 — billing acte + double-invoice guard) |
| ~~US-2070~~ | ~~Planification suivi~~ | **DÉDOUBLONNÉ → US-2500** (Groupe 8 RDV, PR #388 DONE) |
| ~~US-2071~~ | ~~Templates consultation~~ | **DÉDOUBLONNÉ → US-2501** (Groupe 8 RDV, PR #388 DONE) |

**Batch 1 livré** — PR #390 mergée. Review multi-agent (4 agents) a identifié 44 findings
(5 Critical BOLA/fraude/forensic + 12 High RGPD/HDS + 15 Medium + 12 Low) → tous corrigés
avant merge. Suite 1345 tests verts, branches 76.64%, migration `groupe3_refinements`
ajoutée (FK adjustment_proposal_acks.patient_id + 2 indexes performance).
Total V1 effectif Groupe 3 : 12 US (vs 15 affiché initialement).

### Groupe 4 — Devices & Sync (3 US, 100% DONE)

| US | Titre | Statut |
|----|-------|--------|
| US-2091 | Compatibilité matérielle | ✅ DONE PR — `SupportedDevice` whitelist + search NURSE+ + CRUD ADMIN |
| US-2092 | Désactivation / révocation | ✅ DONE PR — soft-revoke atomic CAS + raison chiffrée AES + idempotent |
| US-2093 | Historique des dispositifs | ✅ DONE PR — `listHistory` (incl. revoked) + pivot patientId US-2268 |

### Groupe 5 — Insuline & Repas (5 US, V1 100% DONE)

| US | Titre | Statut |
|----|-------|--------|
| US-2043 | Données pompe à insuline | DONE (PR #391 — bulkSync + dedup cross-batch) |
| US-2050 | Templates ajustement insuline | DONE (PR #391 — cabinet-scoped BASAL/ISF/ICR) |
| US-2053 | Saisie repas patient (validation soignant) | DONE (PR #391 — DiabetesEvent.validatedAt) |
| US-2054 | Bibliothèque aliments CIQUAL ANSES | DONE (PR #391 — HMAC search + NFC norm) |
| US-2057 | Photos repas | DONE (PR #391 — S3 + ClamAV + EXIF strip via sharp) |

**Groupe 5 livré intégralement** — PR #391 mergée le 2026-05-13. Review 4-agents
identifié 41 findings (4 Critical EXIF/TOCTOU/bulkSync/tsc + 10 High RGPD/HDS + 15 Medium + 12 Low)
tous corrigés. Migration `20260513230000_groupe5_review_fixes` (FK + unique + partial index).

### Groupe 6 — Activité physique (3 US, 100% DONE PR #407)

> Batch unique livré PR #407 (~7 SP). Extension `DiabetesEvent` avec
> 7 colonnes typées + 2 enums + endpoint sync mobile bulk dedup.
> App iOS/Android hors scope (per CLAUDE.md) — on livre le contrat API.

| US | Titre | Statut |
|----|-------|--------|
| US-2059 | Journal activité | ✅ DONE PR #407 — CRUD `/api/patients/[id]/activity` + comment chiffré AES-256-GCM + 10 codes whitelist + bornes cliniques |
| US-2060 | Apple HealthKit sync | ✅ DONE PR #407 — endpoint backend `/sync` (source `healthkit`) avec dedup UNIQUE PARTIAL `(activitySource, externalSyncId)` |
| US-2061 | Google Fit / Health Connect | ✅ DONE PR #407 — même endpoint, source `google_fit` / `health_connect`, `createManyAndReturn` atomic race-free |

### Groupe 7 — Facturation (9 US — 5 DONE / 1 V1 restant / 3 reclassées V2) — Batches 1+2 DONE PR #406 + PR #414

> Libellés alignés sur les specs réelles (`docs/UserStory/pro-user-stories/12-facturation/`).
> Batch 1 (Foundation, 11 SP) — DONE PR #406 : Invoice/InvoiceItem/InvoiceSequence + 3 triggers PG.
> Batches 2-4 à suivre : PDF+TVA, Stripe webhooks, Refunds.

| US | Titre | Statut |
|----|-------|--------|
| US-2102 | Virement bancaire + facture PDF | ✅ **DONE PR #414** — pdf-lib multi-page + IBAN chiffré HSA H-3 + Intl FR + status banner + atomic CAS race-safe + Art. 17/20 RGPD invoices |
| US-2103 | Facturation au patient FR | ✅ DONE PR #406 — Invoice service + customerSnapshot AES-256-GCM + audit US-2268 pivot |
| US-2104 | Abonnement DZ | ⏸️ **V2** — bloqué partenariat bancaire DZ |
| US-2105 | Numérotation séquentielle pays | ✅ DONE PR #406 — InvoiceSequence gap-less FOR UPDATE + format `FR-2026-000001` + Luhn SIRET |
| US-2106 | Webhooks idempotents Stripe | ⏸️ **V2** — bloqué provision Stripe Connect |
| US-2107 | Versioning facture immuable | ✅ DONE PR #406 — 3 triggers PG (enforce_invoice_immutability + DELETE-block + items-lock) + FSM atomique |
| US-2108 | Relances automatiques | NOT STARTED (Batch 4 — cron J+7/15/30 via Resend US-2074) |
| US-2109 | Remboursements | ⏸️ **V2** — dépend US-2106 webhooks Stripe (lui-même V2) |
| US-2110 | TVA multi-pays | ✅ **DONE PR #414** — `countryTaxRuleService.getActiveAt` + route `/api/config/tax-rules/active` (NURSE+, audit READ) |

### Groupe 8 — i18n & Interopérabilité (8 US, 33 SP — 4 DONE V1 / 4 reclassées V2)

> **Batch 1 (4 US, 6 SP) — DONE PR #393** : US-2113 + US-2114 + US-2116 + US-2123 scaffold.
> Batch 2 (4 US, 27 SP) — bloqué procurement (habilitations ANS, contrats Mailiz/Apicrypt).

| US | Titre | SP | Statut |
|----|-------|---:|--------|
| US-2113 | Devises EUR/DZD (CountryCurrency, CRUD ADMIN, ISO 3166/4217 CHECK) | 1 | ✅ DONE |
| US-2114 | Règles fiscales par pays (CountryTaxRule, date-bounded, overlap-rejected) | 1 | ✅ DONE |
| US-2116 | Réglementation santé par pays (HealthcareRegulation : RPPS/ADELI/INS/HDS/RGPD/MSSANTE) | 1 | ✅ DONE |
| US-2123 | HL7 FHIR R4 scaffold (FhirInteroperability + FhirAllowedSystem + retry queue + AES-256-GCM payload + SSRF guard + DPA allowlist + kill-switch) | 3 | ✅ DONE |
| US-2124 | DMP / Mon Espace Santé | 8 | ⏸️ **V2** — bloqué ANS habilitation (10-30k€) |
| US-2125 | MSSanté backend | 3 | ⏸️ **V2** — bloqué contrat Mailiz/Apicrypt |
| US-2126 | INSi (API identité nationale) | 8 | ⏸️ **V2** — bloqué ANS habilitation (5-10k€) |
| US-2127 | Pro Santé Connect (OIDC) | 8 | ⏸️ **V2** — bloqué ANS homologation (5-15k€) |

### Groupe 9 — Admin & Ops (8 US — 4 DONE V1 / 1 V1 restant US-2004 / 3 reclassées V2)

> **Batch 1 internes (~4 SP) — DONE PR #409** : 4 US sans dep procurement.
> Batch 2 externes (~12 SP) — bloqué procurement Sentry / Cloudflare / Logs.

| US | Titre | Statut |
|----|-------|--------|
| US-2004 | Captcha anti-bot | ⏳ Blocked procurement (Cloudflare Turnstile / hCaptcha) |
| US-2007 | Sessions multiples UI | ✅ DONE PR #409 — 3 routes `/api/account/sessions` + touchSession (refresh+listOwn) + Session enrichi (createdAt/ipAddress/userAgent/lastSeenAt) |
| US-2137 | Notification breach CNIL | ✅ DONE PR #409 — model DataBreach + FSM 5 statuses + chiffrement AES + cnilDeadlineHoursRemaining + PHI heuristic anti-leak title |
| US-2147 | Paramètres cabinet | ✅ DONE PR #409 — manager-level CRUD `/api/cabinet/[id]/settings` (régaliens siret/tva/iban restent ADMIN-only) |
| US-2150 | Dashboard santé système | ✅ DONE PR #409 — `/api/admin/system-health` (DB/Redis/CGM lag/backups freshness + per-check timeout 2s + pingRedis distingue not_configured/down) |
| US-2153 | Logs centralisés | ⏸️ **V2** — bloqué procurement (Loki / Datadog / OVH Logs) |
| US-2164 | APM monitoring | ⏸️ **V2** — bloqué procurement (Sentry / Datadog) |
| US-2165 | Error tracking | ⏸️ **V2** — bloqué procurement (Sentry self-hosted HDS) |

### Groupe 8 — Gestion des RDV (7 US, 49 SP — décision session Samir 2026-05-13 Q7)

> Module RDV complet, prérequis des dashboards US-2402 (médecin), US-2406 et
> US-2407 (infirmier). IDs frais US-2500-2506 pour éviter collision avec
> US-2070 "Planification suivi" PARTIAL et US-2071 "Templates consultation"
> NOT STARTED qui ont une sémantique différente.
>
> **Batch 1 (CRUD core, 36 SP) — DONE PR #392** : US-2500/2501/2503/2504/2505.
> Batch 2 (notifications, 13 SP) — TODO : US-2502 + US-2506.

| US | Titre | SP | Status | Notes |
|----|-------|---:|:------:|-------|
| US-2500 | Calendrier RDV (list + range query, sécurisé scope) | 13 | ✅ DONE | `listInRange` scope obligatoire (patient/member), soft-delete filter, cross-midnight overlap, truncated flag — PR #392 |
| US-2501 | Détail RDV (CRUD + note/motif/cancelReason chiffrés AES-256-GCM) | 8 | ✅ DONE | 5 endpoints API (list, detail, create, update, cancel), DTO split list/detail (pas de bulk decrypt) — PR #392 |
| US-2502 | Rappels RDV multi-canal (email J-2 / SMS J-1 / push J-0) | 8 | ⏳ Batch 2 | Provider SMS dépend US-2506 |
| US-2503 | Annulation / report bilatéral | 5 | ✅ DONE | State machine cancel/propose/accept, TTL 7j sur alternative, audit `actor`+`callerRole`, EXCLUDE overlap re-check — PR #392 |
| US-2504 | Plages indisponibles médecin | 5 | ✅ DONE | `MemberUnavailability` table, EXCLUDE GiST constraint (btree_gist), reason chiffrée, audit US-2265 — PR #392 |
| US-2505 | Config prise de RDV (auto vs validation manuelle) | 5 | ✅ DONE | `HealthcareMember.bookingMode` enum, `confirm` route DOCTOR, default duration 15-240 — PR #392 |
| US-2506 | Option SMS payante cabinet | 5 | ⏳ Batch 2 | Provider SMS (Twilio/OVH) + activation admin UI |

> **Dépendances** :
>  - US-2074 (Email Resend, DONE) pour rappels email
>  - US-2073 (Push FCM, DONE) pour rappels J-0
>  - US-2002 (MFA) + US-2012 (RBAC) pour CRUD RDV
>  - US-2079 (Préférences notifs, DONE) pour le choix canal patient
>
> **Téléconsultation (Q7.5)** : reportée — pas d'intégration visio MVP, à voir
> plus tard avec la décision ADR existante du domaine 05.

### Groupe 9b — Dashboards backoffice (16 US — renumérotés depuis dashboard-us/)

> Suite au commit `f6700a0`, 16 US dashboard ont été renumérotées de
> US-2265-2280 vers **US-2400-2415** (la plage initiale collisionait avec
> les US auth/Prisma déjà livrées en PR #349/#352/#354). Cf.
> `docs/UserStory/dashboard-us/`.

| US | Titre | Priorité | SP | Fichier |
|----|-------|---------:|---:|---------|
| US-2400 | Dashboard médecin (page principale) | ✅ DONE PR #399 | 8 | Server-component /medecin + role-based redirect |
| US-2401 | Card urgences en cours (médecin) | ✅ DONE PR #399 | 8 | Polling 30s, two-pass critical+recent, criticity sort |
| US-2402 | Card RDV du jour (médecin) | ✅ DONE PR #399 | 5 | Today bounds Europe/Paris, max 3, badge imminent <30min |
| US-2403 | Card patients à suivre (médecin) | ✅ DONE PR #399 | 8 | DOCTOR-only, on-demand (hypos 7j + silence 5j), exclut urgences ouvertes |
| US-2404 | Section KPI cabinet 14j (médecin) | ✅ DONE PR #399 | 5 | 4 MetricCard, Promise.all 8 queries, trend up/down/flat |
| US-2405 | Dashboard infirmier (page principale) | ✅ DONE PR #401 | 8 | `/infirmier` server-component + redirect split NURSE |
| US-2406 | KPI ma journée (infirmier) | ✅ DONE PR #401 | 5 | 4 metrics on-demand Promise.all (RDV/events/urgences/proposals) |
| US-2407 | To-do du jour avec checkboxes (infirmier) | ✅ DONE PR #401 (READ-ONLY) | 8 | Compute 3 sources Appointment+Event+Proposal ; ⚠️ checkbox completion deferred V2 (NurseTaskItem table) |
| US-2408 | Coordination équipe (infirmier) | ✅ DONE PR #401 (workflow) | 5 | DelegationRequest inbox + cabinet scope ; ⚠️ libre chat deferred V2 (TeamMessage table) |
| US-2409 | Relances en attente (infirmier) | ✅ DONE PR #401 (heuristique) | 5 | silentMonitoring+apptUnconfirmed+neverSynced + tel:/sms: URI ; ⚠️ Twilio + PatientRecallLog deferred V2 |
| US-2410 | Dashboard administrateur (page principale) | ✅ DONE PR #403 | 8 | `/admin` server-component + redirect split + 3 cards (KPI/Billing/Compliance) |
| US-2411 | KPI activité cabinet (admin) | ⏸️ **V2** | 5 | dep US-2150 (V3) + US-2200 (à clarifier) — reclassée V2 2026-05-15 |
| US-2412 | Facturation à traiter (admin) | ✅ DONE PR #403 (heuristique) | 5 | TeleconsultationActe.invoicedAt IS NULL fallback ; ⚠️ Invoice table V2 (US-2107) |
| US-2413 | Conformité RGPD (admin) | ⏸️ **V2** | 8 | deps US-2190/2191/2192 absentes du ROADMAP — reclassée V2 2026-05-15 |
| ~~US-2414~~ | ~~Santé système 6 services (admin)~~ | ❌ SUPPRIMÉE | — | Q6 session Samir 2026-05-13 — duplicate (`/api/health` couvre déjà) |
| US-2415 | Sidebar pilotage administration (admin) | ✅ DONE PR #403 (existant) | 6 | NavigationShell déjà gated minRole ADMIN sur /users + /audit ; ⚠️ badges count V2 |

> **MVP dashboard** : US-2400, US-2401, US-2402 = 21 SP — critique pour
> démonstration produit (présentation cabinet médecin).
> **V1 dashboard** : US-2403, US-2404, US-2405-2415 = 81 SP.
>
> **Décisions archi temps réel (session Samir 2026-05-13)** :
>  - **US-2401 (urgences)** : **polling 30s** — WebSocket reporté V2/V3.
>    Le canal alerte instantané reste US-2230 (push FCM mobile, DONE).
>  - **US-2076 / US-2408 (messagerie)** : décision archi temps réel
>    initialement **A+B** (WS + polling + FCM, 13 SP). **Révision 2026-05-15** :
>    livraison V1 en **scope A** uniquement (REST + polling 60s badge
>    + FCM push, ~8 SP) — gain UX du WS marginal en contexte médecin↔
>    patient (réponses non-instantanées). Scope B (WS/SSE chat-only,
>    ~5 SP) reporté V2 en `US-2076bis`.

### Groupe 9c — Dashboards patient web (4 US — backoffice serves these)

> US patient-web sont incluses dans le scope backoffice car l'API patient
> est servie par ce repo. Numérotation conservée (US-3355-3363 sans conflit).

| US | Titre | Priorité | SP | Fichier |
|----|-------|---------:|---:|---------|
| US-3356 | Dashboard patient web (page principale) | ✅ DONE | 8 | PR #394 — (patient) layout + role-based redirect + `<main>` via NavigationShell |
| US-3361 | Section glycémie 24h détaillée (web) | ✅ DONE | 8 | PR #394 — CgmChart réutilisé + 4 KPI MetricCards (TIR, moy, CV, GMI) |
| US-3362 | Section AGP 7 jours résumé (web) | ✅ DONE | 8 | PR #394 — nouveau AgpPercentileChart (Recharts stacked Area p10/p25/p50/p75/p90) + sr-only table WCAG AA |
| US-3363 | Panel actions rapides patient (web) | ✅ DONE | 5 | PR #394 — QuickActionsPanel scaffold ; modal wiring Batch 2 |

> US patient-mobile (US-3355, 3357-3360 = 39 SP) **hors scope** ce repo —
> iOS app séparée (cf. CLAUDE.md "on ne developpe pas les applications
> android et ios").

### Groupe 10 — Mirror V1 (20 US)

> Batches A+B livrés PR #395 (7 US ~30 SP). Batches C/D/E restants
> (modes spéciaux, partage aidants, ETP) = 13 US ~55 SP.

| US | Titre | Statut |
|----|-------|--------|
| US-2218 | Emergency contacts (max 5/patient, PHI chiffré) | ✅ DONE PR #395 |
| US-2219 | Escalation rules (patient → contact → doctor → SAMU) | ✅ DONE PR #395 |
| US-2220 | Alert threshold templates (bibliothèque cabinet) | ✅ DONE PR #395 |
| US-2221 | ConfigVersion history versionnée (immutable trigger) | ✅ DONE PR #395 |
| US-2227 | Rapport trimestriel urgences (cache + recompute) | ✅ DONE PR #395 |
| US-2228 | Stats cohorte urgences (vs benchmark national) | ✅ DONE PR #395 |
| US-2229 | Détection patterns risque (score 0-100, 3 facteurs) | ✅ DONE PR #395 |
| US-2233 | Activation mode pédiatrique (multi-aidants PHI chiffrée, permissionLevel propose) | ✅ DONE PR #396 |
| US-2234 | Activation mode Ramadan (29-30j, sahur/iftar, ISF/ICR multipliers, warnings IDF-DAR) | ✅ DONE PR #396 |
| US-2235 | Activation mode voyage (tz offset, basal protocol transitoire ATTD/EASD 2022) | ✅ DONE PR #396 |
| US-2239 | Audit partages temporaires | ✅ DONE PR #405 | AuditLog SQL filter OR-kinds + scanned/truncated metadata |
| US-2240 | Validation médicale partage tiers | ✅ DONE PR #405 | ConfigVersionType.third_party_share + patientModeWorkflow.validate DOCTOR |
| US-2242 | Notifications partagées multi-aidants | ✅ DONE PR #405 | ConfigVersionType.shared_notifications + matrice alertType×caregivers + FK check User.status=active |
| US-2248 | Vue journal alimentaire patient | ✅ DONE PR #404 | DiabetesEvent insulinMeal + MealPhoto count + comment truncate 500c |
| US-2250 | Validation comptage glucides patient | ⏸️ V2 (FSM table) | Workflow validation deferred — exige nouvelle table |
| US-2251 | Suivi adhésion thérapeutique | ✅ DONE PR #404 | Score 0.6 régularité Paris-tz + 0.4 bolus coverage |
| US-2252 | Alerte non-saisie depuis X jours | ⏸️ V2 (orchestration) | Cron + OrchestrationLog table deferred |
| US-2253 | Contextualisation glycémie-repas | ✅ DONE PR #404 | CGM ±2h pre/post + sample counts |
| US-2260 | Templates messagerie pathologie | ✅ DONE PR #404 (existant) | `/api/team/templates` (US-2078) ; ⚠️ pathology column V2 |
| US-2261 | Messages programmés patient | ✅ DONE PR #405 | Wrapper PushScheduledNotification (schedule/list/cancel) + cancel.notFound audit + scheduledAt cap 1y + templateVariables 4KB |

---

## V2 — 74 US

| Domaine | US | Titre |
|---------|----|-------|
| Auth | US-2009 | Carte CPS |
| Auth | US-2014 | Notification breach |
| Auth | US-2010 | e-CPS |
| Patients | US-2027 | Import/export cohorte |
| Glycémie | US-2031 | Ingestion Medtronic Guardian (reclassée V1→V2 — partenariat CareLink) |
| Glycémie | US-2041 | Pattern detection AI (V2 per spec) |
| Insuline | US-2052 | Comparaison MDI vs pompe |
| Repas | US-2055 | Bibliothèque aliments DZ |
| Repas | US-2056 | Comptage glucides assisté |
| Analytics | US-2097 | Comparaison cabinets |
| Analytics | US-2099 | Rapports personnalisés |
| Analytics | US-2100 | Charge soignants |
| Entités | US-2119–2122 | Réseaux, mutuelles, hôpitaux |
| Facturation | US-2104 | Abonnement DZ (reclassée V1→V2 — partenaire bancaire DZ) |
| Facturation | US-2106 | Webhooks idempotents Stripe (reclassée V1→V2 — provision Stripe) |
| Facturation | US-2109 | Remboursements (reclassée V1→V2 — dep US-2106) |
| Interop | US-2077 | MSSanté intégration UX (reclassée V1→V2 — dep US-2125 backend) |
| Messagerie | US-2076bis | Messagerie realtime layer WS/SSE chat-only (scope B reporté V1→V2 2026-05-15, ~5 SP) |
| Interop | US-2124 | DMP / Mon Espace Santé (reclassée V1→V2 — ANS 10-30k€) |
| Interop | US-2125 | MSSanté backend (reclassée V1→V2 — contrat Mailiz/Apicrypt) |
| Interop | US-2126 | INSi (reclassée V1→V2 — ANS 5-10k€) |
| Interop | US-2127 | Pro Santé Connect (reclassée V1→V2 — ANS 5-15k€) |
| Interop | US-2128–2131 | e-prescription, Segur, HPRIM |
| Documents | US-2142–2146 | Versioning, eIDAS, OCR |
| Admin | US-2149, 2152 | Branding, DR |
| Admin | US-2153 | Logs centralisés (reclassée V1→V2 — Loki/Datadog/OVH) |
| Admin | US-2164 | APM monitoring (reclassée V1→V2 — Sentry/Datadog) |
| Admin | US-2165 | Error tracking (reclassée V1→V2 — Sentry) |
| AI | US-2154–2159 | Pattern, prédiction, stratification |
| ETP | US-2160–2163 | Bibliothèque, programmes, quiz |
| Prescriptions | US-2169–2213 (sauf 2171) | Éditeur, templates, signatures, LAP |
| Dashboards admin | US-2411 | KPI activité cabinet (reclassée V1→V2 — dep US-2150/US-2200) |
| Dashboards admin | US-2413 | Conformité RGPD admin (reclassée V1→V2 — deps US-2190/91/92 absentes) |
| Mirror V2 | US-2236–2241, 2245–2249, 2254–2259 | Transition adulte, PAI, révocation, dispositifs avancés |

---

## V3 — 9 US

| US | Titre |
|----|-------|
| US-2150 | Analytics cabinet (agrégats KPI multi-patients) — décision session Samir 2026-05-13 |
| US-2155 | AI prédiction risque hypo |
| US-2156 | AI suggestions ajustement |
| US-2162 | Évaluation post-programme ETP |
| US-2163 | Certificat complétion ETP |
| US-2262 | Rapport activité ETP cabinet |
| US-2263 | Diffusion cohorte messages |
| US-2264 | Notifications proactives |
| US-2058 | Reconnaissance image repas AI |

---

## V4 — 16 US

| US | Titre |
|----|-------|
| US-2067 | Visioconférence intégrée |
| US-2069 | Prescription digitale |
| US-2075 | SMS critiques |
| US-2139 | Certification HDS éditeur |
| US-2172+ | LAP certifié HAS (module prescription complet) |
| US-2192+ | Signatures eIDAS qualifiées |
| US-2206+ | Transmission e-prescription nationale |
| US-2800 | Algorithme détection patients à risque (TIR critique, alertes répétées, gap CGM, etc.) — décision session Samir 2026-05-13 |

---

## Effort restant MVP

| Batch | Description | Story Points | Statut |
|-------|-------------|--------------|--------|
| A | ~~5 US PARTIAL (US-2047, US-2089, US-2112, US-2115, US-2117)~~ | ~~15 SP~~ | ✅ DONE (PR #351) |
| B | ~~4 nouvelles US backoffice~~ | ~~18 SP~~ | ✅ DONE (PR #350) |
| C | ~~9 US Mirror MVP~~ | ~~42 SP~~ | ✅ DONE (PR #343) |
| D1 | ~~US-2265 + US-2266~~ | ~~5 SP~~ | ✅ DONE (PR #349) |
| **Total restant** | **MVP 100% + V1 pre-prod blocker LEVÉ — go-live ready** | **0 SP** | |

**Pre-prod blocker** : ✅ LEVÉ. US-2267 (Migrations Prisma versionnées) livré PR #352. Voir checklist 1er deploy prod : `docs/runbook/migrations.md` §7.3.

> Compteurs : **63/63 = 100%** scope original, **65/65 = 100%** scope étendu (avec Batch D1). Plus US-2267 + US-2268 V1 livrés. Le backoffice est techniquement go-live ready.

### US MVP / V1 récemment livrées

- [x] **US-2268** (V1) — `auditLog.resourceId` plat + `metadata.patientId` pivot pour forensics CNIL/ANS. Helper `getByPatient` via `$queryRaw` + GIN partial index `jsonb_path_ops` (vérifié EXPLAIN 200k rows : 0.28ms vs 45ms seq scan). 26 sites refactorés + 15 sites missing pivots ajoutés (documents, events, patient CRUD, bolus, mydiabby). PR #353, 2026-05-08, 1184 tests, 8 SP. Re-review 5 agents (1 critical + 5 high + 4 medium fixés).
- [x] **US-2267** (V1 `blocker-pre-prod` LEVÉ) — Migrations Prisma versionnées remplaçant `db push`. Baseline (1723 lignes) + post_deploy (DDL non-modélisables : trigger immutability HDS, fonction rétention 6y SECURITY DEFINER, CHECK constraints) + drift gate CI. deploy.sh preflight `_prisma_migrations`. Runbook complet (§7.3 checklist 1er deploy prod). PR #352, 2026-05-08, 1182 tests, 5 SP. Re-review 5 agents (5 critical + 5 high fixés).
- [x] **Batch A (5 US)** — US-2047 (UI workflow ajustement), US-2089 (UI wizard pairing device), US-2112 (i18n FR/EN/AR + RTL switcher), US-2115 (formatters Intl complet), US-2117 (cabinet enrichi adresse/contact/openingHours/specialties/manager) (PR #351, 2026-05-08, 1177 tests, 15 SP)
- [x] **Batch B (4 US)** — US-2025 (QR invite mobile), US-2118 (praticiens libéraux + RPPS Luhn), US-2148 (admin users + anti-lockout), US-2151 (backup management) (PR #350, 2026-05-08, 1141 tests, 18 SP, 3 agents review)
- [x] **US-2265 + US-2266** (Batch D1) — Audit `ACCESS_DENIED` + email médecin alerte critique (PR #349, 2026-05-08, 1102 tests, 5 SP, 3 agents review)
- [x] **Mirror MVP batch (9 US)** — US-2214/2215/2216/2217/2224/2225/2226/2230/2232 (PR #343, 2026-05-08, 1093 tests, coverage 78%)
- [x] US-2133 — Rétention 6 ans audit logs (PR #342, 2026-05-02)
- [x] US-2136 — Pseudonymisation HMAC firstname/lastname (PR #342, 2026-05-02)
- [x] US-2017 — Patient onboarding wizard (PR #341, 2026-05-02)
- [x] US-2064 — Notification patient propositions (PR #341, 2026-05-02)
- [x] US-2074 — Email transactionnel Resend (PR #341, 2026-05-02)
- [x] US-2073 — Push notifications FCM (PR #340, 2026-05-02)
- [x] US-2140 — Upload documents OVH S3 (PR #339, 2026-05-02)

---

## Dépendances API pour l'app patient (US-3xxx)

### Contrats API satisfaits
Auth (login/MFA/refresh), Profil patient, CGM data, Insulin therapy, Objectives, Push (registration + envoi FCM + templates + scheduled), Sync pull/push, Devices CRUD, Documents (upload multipart + download stream), Events, Medications, Appointments, Healthcare team, Photo avatar.

### Contrats API manquants (MVP patient)
- Self-registration patient (onboarding)
- Meal logging API
- Activity logging API
- Journal agrégé (timeline)
- Emergency procedures API
- Offline sync robuste

---

*Dernière mise à jour : 2026-05-02 — US-2140 DONE (PR #339) · source : `docs/UserStory/pro-user-stories/`, `docs/UserStory/user-stories-patient-management/`*
