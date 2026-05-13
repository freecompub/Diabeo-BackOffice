# Roadmap Diabeo Backoffice — User Stories intégrées

> Dernière mise à jour : 2026-05-08 — Batch A livré + US-2267 (PR #352) + US-2268 (PR #353) → MVP scope original 100% + V1 pre-prod blocker LEVÉ.
> Total : **268 US** (217 pro + 51 mirror) · MVP completion : **100%** (63/63 DONE — scope original)

---

## Taux de réalisation

| Priorité | Total | DONE | PARTIAL | NOT STARTED | % Done |
|----------|-------|------|---------|-------------|--------|
| **MVP**  | 68    | 65   | 0       | 3           | **96%** |
| **V1**   | 143   | 15   | 4       | 124         | **10%** |
| **V2**   | 58    | 0    | 0       | 58          | **0%**  |
| **V3**   | 9     | 0    | 0       | 9           | **0%**  |
| **V4**   | 16    | 0    | 0       | 16          | **0%**  |
| **TOTAL**| **294** | **80** | **4**   | **210**     | **27%** |
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

### Groupe 1 — Glycémie & Analytics (13 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2031 | Ingestion Medtronic Guardian | NOT STARTED |
| US-2032 | Glycémies capillaires (BGM) | DONE (PR #388 — GET + rate-limit + decrypt) |
| US-2038 | Heat-map glycémique | DONE (PR #388 — TZ-pinned Europe/Paris) |
| US-2039 | Comparaison de périodes | DONE (PR #388 — half-open windows + delta) |
| US-2040 | Rapport AGP exportable PDF | DONE (PR #388 — pdf-lib + warning banner) |
| US-2041 | Pattern detection | NOT STARTED (V2 per spec) |
| US-2094 | Tableau de bord population | DONE (PR #388 — RBAC + p-limit + GDPR filter) |
| US-2095 | Indicateurs qualité cabinet | DONE (PR #388 — TIR/GMI distributions) |
| US-2096 | Cohorte par pathologie | DONE (PR #388 — DT1/DT2/GD breakdown) |
| US-2098 | Export CSV / Excel | DONE (PR #388 — CSV anti-injection + fail-closed) |
| US-2243 | (Mirror) Supervision glycémie patient | NOT STARTED |
| US-2244 | (Mirror) Détection patterns par patient | NOT STARTED |

**Batches 1+2 livrés** : 8 US (US-2032, 2038, 2039, 2040, 2094, 2095, 2096, 2098) — PR #388, ~21 SP, 1251 tests verts.

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

### Groupe 3 — Équipe & Communication (15 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2076 | Messagerie sécurisée patient↔PS | NOT STARTED |
| US-2077 | MSSanté intégration | NOT STARTED |
| US-2078 | Templates de messages | PARTIAL |
| US-2080 | Accusés de lecture | NOT STARTED |
| US-2083 | Délégation médecin → IDE | NOT STARTED |
| US-2084 | Remplacement / congés | NOT STARTED |
| US-2086 | Handoff entre soignants | NOT STARTED |
| US-2088 | Groupes patients par équipe | NOT STARTED |
| US-2065 | Accusé réception patient | NOT STARTED |
| US-2066 | Suivi application réelle | NOT STARTED |
| US-2068 | Notes consultation | NOT STARTED |
| US-2070 | Planification suivi | PARTIAL |
| US-2071 | Templates consultation | NOT STARTED |
| US-2072 | Facturation acte téléconsult | NOT STARTED |

### Groupe 4 — Devices & Sync (3 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2091 | Compatibilité matérielle | NOT STARTED |
| US-2092 | Désactivation / révocation | PARTIAL |
| US-2093 | Historique des dispositifs | NOT STARTED |

### Groupe 5 — Insuline & Repas (6 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2043 | Données pompe à insuline | PARTIAL |
| US-2050 | Templates ajustement | NOT STARTED |
| US-2053 | Saisie repas patient | NOT STARTED |
| US-2054 | Bibliothèque aliments France | NOT STARTED |
| US-2057 | Photos repas | NOT STARTED |

### Groupe 6 — Activité physique (3 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2059 | Journal activité | NOT STARTED |
| US-2060 | Apple HealthKit sync | NOT STARTED |
| US-2061 | Google Fit / Health Connect | NOT STARTED |

### Groupe 7 — Facturation (9 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2102 | Stripe Connect paiement | NOT STARTED |
| US-2103 | Virement bancaire | NOT STARTED |
| US-2104 | Abonnements | NOT STARTED |
| US-2105 | Factures PDF | NOT STARTED |
| US-2106 | Webhooks paiement | NOT STARTED |
| US-2107 | Tableau revenus | NOT STARTED |
| US-2108 | Rappels automatiques | NOT STARTED |
| US-2109 | TVA / fiscalité FR | NOT STARTED |
| US-2110 | Facturation DZ | NOT STARTED |

### Groupe 8 — i18n & Interopérabilité (8 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2113 | Devises multi-pays | NOT STARTED |
| US-2114 | Règles fiscales pays | NOT STARTED |
| US-2116 | Réglementation santé pays | NOT STARTED |
| US-2123 | HL7 FHIR R4 | NOT STARTED |
| US-2124 | DMP (Dossier Médical Partagé) | NOT STARTED |
| US-2125 | MSSanté backend | NOT STARTED |
| US-2126 | INS (API INSi) | NOT STARTED |
| US-2127 | Pro Santé Connect | NOT STARTED |

### Groupe 9 — Admin & Ops (8 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2004 | Captcha anti-bot | NOT STARTED |
| US-2007 | Sessions multiples UI | PARTIAL |
| US-2147 | Paramètres cabinet | NOT STARTED |
| US-2150 | Dashboard santé système | NOT STARTED |
| US-2153 | Backups automatisés | NOT STARTED |
| US-2164 | APM monitoring | NOT STARTED |
| US-2165 | Error tracking | NOT STARTED |
| US-2137 | Notification breach CNIL | NOT STARTED |

### Groupe 8 — Gestion des RDV (7 US, 49 SP — décision session Samir 2026-05-13 Q7)

> Module RDV complet, prérequis des dashboards US-2402 (médecin), US-2406 et
> US-2407 (infirmier). IDs frais US-2500-2506 pour éviter collision avec
> US-2070 "Planification suivi" PARTIAL et US-2071 "Templates consultation"
> NOT STARTED qui ont une sémantique différente.

| US | Titre | SP | Notes |
|----|-------|---:|-------|
| US-2500 | Calendrier RDV (jour/semaine/mois + drag&drop) | 13 | 3 vues commutables, drag&drop pour reprogrammer |
| US-2501 | Détail RDV (CRUD + note médicale chiffrée AES-256-GCM) | 8 | Champs : date+heure, patient, type, durée, note, motif, lieu (présentiel/visio) |
| US-2502 | Rappels RDV multi-canal (email J-2 / SMS J-1 / push J-0) | 8 | Patient choisit son canal préféré dans `UserNotifPreferences` |
| US-2503 | Annulation / report bilatéral | 5 | Patient ou médecin, délai 24h sans pénalité, si annulation médecin → proposition alternative |
| US-2504 | Plages indisponibles médecin | 5 | Congés, jours fériés FR/DZ, créneaux bloqués manuellement |
| US-2505 | Config prise de RDV (auto vs validation manuelle) | 5 | Toggle par médecin lors de la config de son calendrier |
| US-2506 | Option SMS payante cabinet | 5 | Provider SMS (Twilio/OVH/autre) + activation cabinet via admin UI |

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
| US-2400 | Dashboard médecin (page principale) | **MVP** | 8 | `medecin/US-2400-…` |
| US-2401 | Card urgences en cours (médecin) | **MVP** | 8 | `medecin/US-2401-…` |
| US-2402 | Card RDV du jour (médecin) | MVP | 5 | `medecin/US-2402-…` |
| US-2403 | Card patients à suivre (médecin) | V1 | 8 | `medecin/US-2403-…` |
| US-2404 | Section KPI cabinet 14j (médecin) | V1 | 5 | `medecin/US-2404-…` |
| US-2405 | Dashboard infirmier (page principale) | V1 | 8 | `infirmier/US-2405-…` |
| US-2406 | KPI ma journée (infirmier) | V1 | 5 | `infirmier/US-2406-…` |
| US-2407 | To-do du jour avec checkboxes (infirmier) | V1 | 8 | `infirmier/US-2407-…` |
| US-2408 | Coordination équipe (infirmier) | V1 | 5 | `infirmier/US-2408-…` |
| US-2409 | Relances en attente (infirmier) | V1 | 5 | `infirmier/US-2409-…` |
| US-2410 | Dashboard administrateur (page principale) | V1 | 8 | `admin/US-2410-…` |
| US-2411 | KPI activité cabinet (admin) | V1 → ⏸️ PAUSED | 5 | dep US-2150 (V3) + US-2200 (à clarifier) — session Samir 2026-05-13 |
| US-2412 | Facturation à traiter (admin) | V1 | 5 | dep remappée US-2170 → **US-2107** (Groupe 7 Facturation) |
| US-2413 | Conformité RGPD (admin) | V1 → ⏸️ PAUSED | 8 | deps US-2190/2191/2192 absentes du ROADMAP — session Samir 2026-05-13 |
| ~~US-2414~~ | ~~Santé système 6 services (admin)~~ | ❌ SUPPRIMÉE | — | Q6 session Samir 2026-05-13 — duplicate (`/api/health` couvre déjà) |
| US-2415 | Sidebar pilotage administration (admin) | V1 | 6 | `admin/US-2415-…` |

> **MVP dashboard** : US-2400, US-2401, US-2402 = 21 SP — critique pour
> démonstration produit (présentation cabinet médecin).
> **V1 dashboard** : US-2403, US-2404, US-2405-2415 = 81 SP.
>
> **Décisions archi temps réel (session Samir 2026-05-13)** :
>  - **US-2401 (urgences)** : **polling 30s** — WebSocket reporté V2/V3.
>    Le canal alerte instantané reste US-2230 (push FCM mobile, DONE).
>  - **US-2076 / US-2408 (messagerie)** : **approche combinée A+B** :
>    WebSocket pendant l'écran chat + polling 60s pour le badge unread
>    + FCM push (US-2073 DONE) pour mobile/offline. Pattern Slack/WhatsApp.
>    US-2076 SP bumpé 1 → 13 pour couvrir l'infra WS chat-only.

### Groupe 9c — Dashboards patient web (4 US — backoffice serves these)

> US patient-web sont incluses dans le scope backoffice car l'API patient
> est servie par ce repo. Numérotation conservée (US-3355-3363 sans conflit).

| US | Titre | Priorité | SP | Fichier |
|----|-------|---------:|---:|---------|
| US-3356 | Dashboard patient web (page principale) | V1 → ⏸️ PAUSED | 8 | Q10 session Samir 2026-05-13 — Auth patient web à concevoir |
| US-3361 | Section glycémie 24h détaillée (web) | V1 → ⏸️ PAUSED | 8 | idem |
| US-3362 | Section AGP 7 jours résumé (web) | V1 → ⏸️ PAUSED | 8 | idem |
| US-3363 | Panel actions rapides patient (web) | V1 → ⏸️ PAUSED | 5 | idem |

> US patient-mobile (US-3355, 3357-3360 = 39 SP) **hors scope** ce repo —
> iOS app séparée (cf. CLAUDE.md "on ne developpe pas les applications
> android et ios").

### Groupe 10 — Mirror V1 (20 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2218 | Config protocole resucrage avancé | NOT STARTED |
| US-2219 | Config contacts urgence (5 max) | NOT STARTED |
| US-2220 | Config par contexte (sport/école) | NOT STARTED |
| US-2221 | Config templates seuils | NOT STARTED |
| US-2227 | Rapport trimestriel urgences | NOT STARTED |
| US-2228 | Stats cohorte urgences | NOT STARTED |
| US-2229 | Détection patterns risque | NOT STARTED |
| US-2233 | Activation mode pédiatrique | NOT STARTED |
| US-2234 | Activation mode Ramadan | NOT STARTED |
| US-2235 | Activation mode voyage | NOT STARTED |
| US-2239 | Audit partages temporaires | NOT STARTED |
| US-2240 | Validation médicale aidants | NOT STARTED |
| US-2242 | Statut sync temps réel | NOT STARTED |
| US-2248 | Vue journal alimentaire patient | NOT STARTED |
| US-2250 | Bibliothèque ETP | NOT STARTED |
| US-2251 | Prescription programmes ETP | NOT STARTED |
| US-2252 | Suivi progression ETP | NOT STARTED |
| US-2253 | Templates messagerie pathologie | NOT STARTED |
| US-2260 | Messages programmés | NOT STARTED |
| US-2261 | Coordination multi-aidants | NOT STARTED |

---

## V2 — 58 US

| Domaine | US | Titre |
|---------|----|-------|
| Auth | US-2009 | Carte CPS |
| Auth | US-2014 | Notification breach |
| Auth | US-2010 | e-CPS |
| Patients | US-2027 | Import/export cohorte |
| Glycémie | US-2041 | Pattern detection AI |
| Insuline | US-2052 | Comparaison MDI vs pompe |
| Repas | US-2055 | Bibliothèque aliments DZ |
| Repas | US-2056 | Comptage glucides assisté |
| Analytics | US-2097 | Comparaison cabinets |
| Analytics | US-2099 | Rapports personnalisés |
| Analytics | US-2100 | Charge soignants |
| Entités | US-2119–2122 | Réseaux, mutuelles, hôpitaux |
| Interop | US-2128–2131 | e-prescription, Segur, HPRIM |
| Documents | US-2142–2146 | Versioning, eIDAS, OCR |
| Admin | US-2149, 2152 | Branding, DR |
| AI | US-2154–2159 | Pattern, prédiction, stratification |
| ETP | US-2160–2163 | Bibliothèque, programmes, quiz |
| Prescriptions | US-2169–2213 (sauf 2171) | Éditeur, templates, signatures, LAP |
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
