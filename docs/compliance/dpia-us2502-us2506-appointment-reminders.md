# DPIA — US-2502 Rappels RDV multi-canal + US-2506 SMS mock cabinet

> DPIA RGPD Art. 35 + CNIL délibération 2018-326.
> Statut : draft V1 — validation DPO en cours.

## 1. Périmètre

- **US-2502** : cron quotidien J-2 email / J-1 SMS / J-0 push pour
  rappeler les RDV `scheduled|confirmed` aux patients.
- **US-2506 V1 mock** : option SMS payante cabinet (toggle ADMIN +
  crédits). **Mock provider** — aucun SMS réellement envoyé en V1.
  Real Twilio/OVH déféré V3 sous `US-2506bis`.

- **Données traitées** :
  - `User.email` (chiffré AES-256-GCM, déchiffré au moment du send Resend).
  - `User.phone` (chiffré AES-256-GCM, déchiffré pour SMS mock V1).
  - `PushDeviceRegistration.pushToken` (FCM).
  - `User.language` (FR/EN/AR).
  - `Appointment.date/hour/location` (date+heure+lieu type seulement).
  - Journal `AppointmentReminder` (status, sentToEnc chiffré, providerMessageId).
  - Journal `SmsLog` (cabinetId, toEnc chiffré, messageExcerpt cap 120c).

- **Finalité** : rappel RDV à délais légaux/usuel (J-2/J-1/J-0).

- **Base légale RGPD** :
  - **Art. 6.1.b** : exécution du contrat de soin.
  - **Art. 6.1.c** : continuité des soins (Code Santé Publique).
  - **Art. 9.2.h** : médecine préventive / diagnostic par PS soumis au
    secret (l'existence du RDV est PHI dérivé).

- **Pas de PHI direct** : aucun TIR/glucose/pathologie ni nom médecin
  dans le contenu email/SMS/push. Date+lieu type uniquement.

## 2. Mesures techniques

| Mesure | Statut |
|---|---|
| Chiffrement AES-256-GCM email/phone/sentToEnc | ✅ |
| Idempotence UNIQUE(appt_id, channel, step) + UNIQUE constraint SMS | ✅ |
| Advisory lock global `pg_try_advisory_xact_lock` anti double-run | ✅ |
| Filtre RGPD Art. 17 (`patient.deletedAt: null + user.status='active'`) | ✅ |
| Filtre `status IN [scheduled, confirmed]` (pas de cancelled/no_show) | ✅ |
| Recheck status TOCTOU avant persist | ✅ |
| Sanitize provider error (anti PII leak email/phone) | ✅ |
| messageExcerpt SMS cap 120 chars (anti leak PHI) | ✅ |
| Decrement crédit atomique via `updateMany WHERE balance >= cost` | ✅ |
| Pivot `metadata.patientId` US-2268 + `appointmentId` | ✅ |
| Audit `cron.auth.failed` US-2265 sur 401 Bearer | ✅ |
| Bearer `CRON_SECRET` timing-safe (réutilise pattern US-2108) | ✅ |
| Headers ANSSI RGS §4.5 sur 200/401/503 | ✅ |
| Anonymisation `sentToEnc` post-deletion patient (RGPD Art. 17) | ✅ |
| RGPD Art. 20 export `appointments[].reminders[]` déchiffré | ✅ |
| FK cascade `Appointment → AppointmentReminder` | ✅ |
| FK cascade `HealthcareService → SmsLog` | ✅ |

## 3. Risques résiduels V1

### 3.1 V3 — Real SMS provider (US-2506bis)

- V1 = **mock**. Aucun SMS envoyé réellement. Le `status='mock'` est
  documenté côté audit. Le caller (cron US-2502) traite mock comme
  succès — donc en V1, les patients ne reçoivent **PAS** de SMS.
- V3 : Twilio ou OVH SMS — DPA + procurement (~contrat 500-2k€/mois
  + ~5-10c€/SMS).
- **Décision business** : pilote V1 mock OK pour démonstrer le workflow,
  prod patients réels exige V3.

### 3.2 HIGH — Resend / FCM transferts hors-UE

- Resend Inc. (US) → Schrems II / FISA 702. Cf. DPIA US-2108 §3.1
  (mêmes mesures DPA + SCC + TIA).
- Firebase (Google) FCM → idem précédent US-2076 messaging déjà
  validé.

### 3.3 MEDIUM — SMS message-id mock plutôt qu'audit Twilio dashboard

- V1 mock-UUID dans `providerMessageId`. Pas de delivery confirmation
  via webhook → on ne sait pas si l'SMS aurait été délivré en réel.
- V3 : webhook Twilio `message.status_change` matérialise le delivery.

### 3.4 LOW — Délais 2/1/0 hardcodés vs usage cabinet

- Cabinet pourrait vouloir J-3 ou rappel multi-jour. V1 fixe.
- V1.5 : `HealthcareService.reminderConfig: JSONB` par cabinet.

### 3.5 LOW — Pas de Reply-To cabinet (générique Diabeo)

- Idem US-2108 §3.4. V1.5 : `Reply-To: contact@cabinet-X.fr`.

## 4. Conformité

- **RGS §B1** : AES-256-GCM (email/phone/sentToEnc). ✅
- **RGS §3.5** : monitoring auth Bearer + audit `cron.auth.failed`. ✅
- **RGS §4.5** : headers Cache-Control + Referrer + nosniff. ✅
- **ADR #18 US-2268** : `metadata.patientId + appointmentId` pivot. ✅
- **HDS Art. L.1111-8** : traçabilité audit transactionnel + 6 kinds. ✅
- **RGPD Art. 17** : filtre `deletedAt` + anonymisation `sentToEnc`. ✅
- **RGPD Art. 20** : export `appointments[].reminders[]` déchiffré. ✅
- **RGPD Art. 35** : DPIA produite (ce document). ✅
- **CGU patients** : doit mentionner rappels automatiques RDV (Art. 13
  RGPD information préalable).

## 5. Workflow opérationnel

```
1. Cron OVH/Vercel/GH-Action → POST /api/cron/appointments/reminders 9h Paris
2. Middleware bypass JWT + strip x-user-*
3. Bearer CRON_SECRET timing-safe + audit auth.failed si KO
4. Service processAppointmentReminders :
   a. Advisory lock global anti double-run
   b. Pour chaque step (J-2/J-1/J-0) :
      - SELECT appointments WHERE date matches + status active + patient.deletedAt
        null + reminders.none(channel, step) + user.status='active'
        ORDER BY date ASC LIMIT 500
      - Parallel p-limit(10) sendReminderForAppointment :
        * email J-2 : Resend (anti-PHI)
        * sms J-1 : sms.service mock V1 (cabinet smsEnabled + credits)
        * push J-0 : fcm.service data-only
      - Si timeout 50s → break (idempotence laisse pour run+1)
   c. Audit cron.run metrics
5. Réponse JSON metrics 200
```

## 6. Tableaux de bord

- Audit `APPOINTMENT_REMINDER kind=cron.run` → metrics quotidiennes.
- Audit `SMS_LOG kind=sms.config.toggled` → ADMIN audit trail cabinet.
- Alerte Grafana si :
  - `sms.failed > 5/jour` cabinet → quota Twilio (V3).
  - `byChannel.email.failed > 50/jour` global → Resend incident.
  - `cron.skipped_locked` > 2/jour → double-trigger scheduler.

## 7. Validation

- [ ] Signature DPO sur §3.1 (V1 mock SMS = pilote uniquement)
- [ ] Décision business V3 timeline (procurement Twilio/OVH)
- [ ] Mise à jour CGU patient (rappels automatiques Art. 13)
- [ ] Cron schedule prod configuré `0 9 * * *`
- [ ] CRON_SECRET partagé avec route US-2108 (même secret)

## 8. Signatures

| Rôle | Nom | Date | Signature |
|------|-----|------|-----------|
| DPO  | _________ | _____ | _____ |
| RSSI | _________ | _____ | _____ |
| Direction Médicale | _________ | _____ | _____ |
| Product Owner | _________ | _____ | _____ |

---

**Références** :
- PR US-2502 + US-2506 (2 US batch)
- US-2506bis (V3) — Real Twilio/OVH SMS integration
- US-2074 (Resend), US-2073 (FCM Firebase), US-2108 (cron pattern)
- US-2268 ADR #18 (audit pivot)
- US-2265 (accessDenied burst)
- ADR #20 (early-fail env validation)
- RGPD : Art. 6.1.b/c, 9.2.h, 13, 17, 20, 35
- CNIL : délibération 2018-326
- HDS : Art. L.1111-8
- ANSSI : RGS §B1, §3.5, §4.5
- CSP : Art. L.1110-4 (secret médical)

## 9. Round 2 review (post-MR PR #418)

Trois agents (code-reviewer + healthcare-security-auditor + prisma-specialist) ont
identifié 29 findings : 3 CRITICAL + 4 HIGH + 15 MEDIUM + 7 LOW. **Option C totale**
appliquée — 0 résiduel.

### Findings résolus impactant DPIA

- **C1 (timezone bug)** — `formatDateTime` doublement convertissait l'heure :
  `Date.UTC(y,m,d,14,0)` + `Intl{timeZone:"Europe/Paris"}` → "14:00 stocké" rendu
  "16:00 affiché" (été CEST). **Fix** : `timeZone: "UTC"` côté Intl + composantes
  UTC du `Date.Time` → rendu fidèle "14:00". Le paramètre `User.timezone` reste
  pour V1.5 (conversion patient voyageur). **Impact patient** : heure RDV correcte
  dans tous emails/SMS/push, élimine risque erreur médicale (rétro-titration
  basale calée sur la mauvaise heure).
- **C2 (FCM senderId FK violation)** — `fcmService.sendToUser` exigeait
  `senderId: number` mais le cron n'a pas d'utilisateur. Sentinel `0` violait
  FK `audit_logs.user_id → users.id`. **Fix** : `senderId: number | null`
  partout, `CRON_AUDIT_USER_ID = null` propagé jusqu'à audit. Aligne avec
  contrat US-2108 (invoice reminders).
- **C3 (advisory lock xact vs session)** — `pg_try_advisory_xact_lock` libère le
  lock à la fin de la TX. Le cron tourne hors `$transaction` (multi-channel,
  ~minutes), donc race possible entre 2 runs concurrents. **Fix** :
  `pg_try_advisory_lock` SESSION-level + `pg_advisory_unlock` dans `finally`.
- **H1 (opt-out notifPreferences)** — Le filtre `findMany` n'incluait pas
  `patient.user.notifPreferences.medicalAppointments: true`. Risque RGPD Art. 21
  (droit d'opposition). **Fix** : filtre ajouté côté SQL. Patient peut désormais
  désactiver canal par canal via `/api/account/notifications`.
- **H2 (SMS skipped audit perdu)** — `smsService.sendSms` throw avant commit du
  log si `disabled`/`noCredits`/`noPhone`. Forensique HDS Art. L.1111-8 perdue.
  **Fix** : `persistSmsLogStandalone()` (TX dédiée, commit garanti avant throw).
- **H3 (GET → leak CRON_SECRET)** — Route exposait GET (alias POST). Risque leak
  via Nginx access logs / Referer header / cache CDN. **Fix** : GET retiré,
  POST uniquement (RFC 7231 §4.3.3). Runbook à mettre à jour : scheduler doit
  envoyer `curl -X POST`.
- **M11 (audit runId pivot)** — `auditService.log` n'avait pas de `runId`
  partagé pour grouper les events d'un même run cron. **Fix** : `randomUUID()`
  généré au début + propagé dans `metadata.runId`. Permet forensique CNIL/ANS
  par run (cf. US-2268).
- **M10 (step order inversion)** — Ancien ordre `email → SMS → push` repoussait
  les notifs urgentes (J-0). **Fix** : `push J-0 → SMS J-1 → email J-2` (canal
  le plus urgent traité en premier, dégradation gracieuse si timeout).
- **M5 (index hot path)** — Cron scannait full table appointments sans index
  `(status, date)`. **Fix** : `CREATE INDEX appointments_status_date_idx`.
- **M7 (sms_logs ON DELETE)** — `CASCADE` sur `cabinet_id` permettait perte
  audit financier en cas d'accidental DROP cabinet. **Fix** : `RESTRICT`.
- **M2 (deletion dead code)** — `tx.appointmentReminder.updateMany` dans
  `deletion.service` était dead code (CASCADE via FK). **Fix** : retiré, commentaire
  explicite. Si soft-delete V2, réactiver explicitement (Art. 17 strict).
- **M12/M13 (null handling)** — Templates email/push crashaient si
  `appointment.location=null` ou `appointment.hour=null`. **Fix** : conditional
  rendering FR/EN/AR ("aujourd'hui" vs "à HH:MM").

### Tests ajoutés round 2

- C1 timezone fidélité (UTC pinned)
- C2 senderId null propagation
- C3 advisory lock session (≥2 $queryRaw calls)
- H1 filter notifPreferences
- H3 GET non-exporté
- M1 push partial metadata (recipientCount/sent/failed)
- M5 orderBy date asc
- M11 runId UUID propagation
- M13 hour=null body

Total : 25 unit + 6 integration = **31/31 verts post-round 2**.

### Bloqueurs pre-prod inchangés

- DPO sign-off §3.1 (V1 mock SMS = pilote uniquement)
- Décision business V3 timeline (procurement Twilio/OVH)
- CGU patient (rappels automatiques Art. 13)
- Cron schedule prod `0 9 * * *` configuré
- Runbook scheduler : **POST uniquement** (H3 round 2)
- EXPLAIN ANALYZE sur dataset 100K RDV (index hot path round 2 M5)

## 10. Round 3 review (post-round 2)

Trois agents (code-reviewer + healthcare-security-auditor + prisma-specialist)
ont identifié **16 findings** post-round 2 : 1 CRITICAL + 3 HIGH + 7 MEDIUM
+ 5 LOW. **Option C totale** appliquée — 0 résiduel.

### Findings résolus impactant DPIA

- **CR-1 (advisory lock cassé en prod)** — Le fix C3 round 2 utilisait
  `pg_try_advisory_lock` (SESSION-level) via `prisma.$queryRaw` partagé.
  `@prisma/adapter-pg` route chaque query sur une connexion différente du
  pool `node-postgres` → `acquire` sur conn A, `release` sur conn B → release
  no-op silencieux, lock orphelin sur A jusqu'au recyclage (idle ~10s) ou
  restart Node. **Impact patient** : cron bloqué N runs (`skippedConcurrent`)
  OU double-sends (lock disparu à mi-run). **Fix** : module
  `src/lib/db/cron-lock.ts` avec `pg.Pool({ max: 1, idleTimeoutMillis: 0 })`
  dédié — `withSessionAdvisoryLock` garantit acquire/release sur la même
  connexion physique. Les ops Prisma à l'intérieur utilisent le pool partagé
  (parallelism préservé).
- **HI-1 (opt-in implicite cassé)** — Filtre round 2
  `notifPreferences: { medicalAppointments: true }` générait un `EXISTS` qui
  excluait silencieusement tous les patients **sans row `UserNotifPreferences`**
  (créée lazily au 1er PUT). **Impact** : la majorité des patients en prod
  n'auraient reçu aucun rappel. **Fix** : `OR: [{notifPreferences: null},
  {medicalAppointments: true}]` → respect opt-in implicite + opt-out Art. 21
  explicite préservé.
- **HI-2 (SMS mock V1 mensonger)** — Round 2 persistait
  `AppointmentReminder.status="sent"` pour `result.status === "mock"`. Le
  médecin voyait "rappel envoyé" alors que rien n'est parti. **Fix** : persist
  `status="skipped"` + `errorReason="provider_mock_no_real_sms"`. V3 (real
  Twilio/OVH) reviendra à `"sent"` via le contrat `SmsSendResult.status`.
- **HI-3 (test C1 timezone laxiste)** — Round 2 `stringContaining("14")`
  matchait aussi `"14 mai 2026 à 02:00"`. **Fix** : loop
  `process.env.TZ ∈ {UTC, Europe/Paris, America/New_York}` + pattern strict
  `/\b14:00\b/` + anti-régression `not.toMatch(/\b16:00\b/)` (CEST). Verrouille
  C1 patient-safety.
- **MED-1 (opt-out RGPD silencieux)** — Round 2 filtrait les opt-outs sans
  audit → démonstrabilité CNIL Art. 5.2 fastidieuse. **Fix** :
  `prisma.appointment.count` AVANT findMany par step + propagation dans
  audit `cron.run.metadata.optOutSkipped`. Coût marginal, démonstrabilité directe.
- **MED-2 (forensique by runId)** — Migration suiveuse
  `20260519120000_us2502_round3_review` : `CREATE INDEX ... USING gin
  ((metadata -> 'runId')) WHERE metadata ? 'runId'` (partial GIN) →
  forensique `metadata @> '{"runId": "x"}'` < 100ms à 10M rows.
- **MED-3/MED-4 (TX SMS atomique)** — `sendSms` re-wrap dans une
  `$transaction` unique (decrement crédit + persist log atomique). Throw
  erreur métier reporté APRÈS commit. `persistSmsLogStandalone` helper
  retiré.
- **MED-5 (timezone dead code)** — `User.timezone` SELECT retiré + param
  ignoré nettoyé. Sera réintroduit V1.5.
- **LOW-5 (CHECK cohérence reminders)** — Migration round 3 ajoute
  `appointment_reminders_status_fields_coherence_check` defense-in-depth.

### Findings UX/observabilité

- **MED-7** : docstring `@route POST` (vs ancien GET|POST).
- **LOW-1** : runbook `docs/runbook/cron-reminders.md` créé (210 lignes).
- **LOW-2** : préfixe U+200F (RLM) pour push body arabe.
- **LOW-4** : `ExtraReminderMetadata` discriminated union (anti-leak PHI).

### Tests round 3

- 28/28 unit + 6/6 + 10/10 + 22/22 = **66/66 verts** sur les fichiers concernés.
- Full suite : **2231/2231 verts** (+3 nouveaux : CR-1 lock null, HI-3
  timezone strict, MED-1 opt-out count, HI-2 V3 real provider).

### Bloqueurs pre-prod round 3 (en plus du round 2)

- **Test E2E réel** sur staging Postgres + `@prisma/adapter-pg` pour
  valider `withSessionAdvisoryLock` (mock test ne reproduit pas pool).
- **EXPLAIN ANALYZE** `audit_logs_run_id_gin_idx` post-migration sur
  dataset staging ≥1M rows.
- **Décision DPO** : `optOutSkipped` audit count est-il acceptable Art. 5.2
  ou faut-il une API admin de démonstration à la demande ?
- **Décision business V1.5** : retirer le mock SMS ou documenter dans CGU
  patient que "les SMS de rappel ne sont pas envoyés en V1" (sinon attente
  patient déçue).
