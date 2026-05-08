# Roadmap Diabeo Backoffice — User Stories intégrées

> Dernière mise à jour : 2026-05-08 — Mirror MVP livré (9 US, PR #343), 4 follow-ups Batch D ouverts (PR #348)
> Total : **268 US** (217 pro + 51 mirror) · MVP completion : **71%** (47/66 DONE)

---

## Taux de réalisation

| Priorité | Total | DONE | PARTIAL | NOT STARTED | % Done |
|----------|-------|------|---------|-------------|--------|
| **MVP**  | 66    | 47   | 6       | 13          | **71%** |
| **V1**   | 121   | 0    | 7       | 114         | **0%**  |
| **V2**   | 58    | 0    | 0       | 58          | **0%**  |
| **V3**   | 8     | 0    | 0       | 8           | **0%**  |
| **V4**   | 15    | 0    | 0       | 15          | **0%**  |
| **TOTAL**| **268** | **47** | **13**  | **208**     | **22%** |

> MVP scope original (63 US) → 47 DONE = **75%**. Avec ajout de 3 follow-ups MVP du Batch D → 66 US, 71%. Les 3 follow-ups MVP (US-2265/2266/2267) sont à traiter dans le sprint suivant.

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
| US-2025 | Invitation mobile QR code | NOT STARTED | — |
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
| US-2047 | Workflow ajustement 3 étapes | PARTIAL | `adjustment.service.ts` OK, UI validation médecin manquante |
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
| US-2266 | Email médecin sur alerte critique | NOT STARTED | Follow-up PR #343 — 3 SP. Issue [#345](https://github.com/freecompub/Diabeo-BackOffice/issues/345). Câbler `notifyDoctorEmail` (PHI-safe) sur emergency.service. |

### Domaine 07 — Équipe & Cabinet (2 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2081 | Cabinet multi-utilisateurs | DONE | `HealthcareService` + `HealthcareMember` |
| US-2082 | Affectation référent | DONE | `PatientReferent` |

### Domaine 08 — Dispositifs (2 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2089 | Pairing device | PARTIAL | `device.service.ts` CRUD OK, UI wizard manquant |
| US-2090 | Statut synchronisation | DONE | `DeviceDataSync`, `/api/devices/sync-status/` |

### Domaine 09 — i18n (2 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2112 | i18n FR/AR | PARTIAL | `src/i18n/config.ts` existe, next-intl + traductions manquants |
| US-2115 | Formats date/nombre | PARTIAL | Config locale existe, helpers formatage manquants |

### Domaine 10 — Entités organisationnelles (2 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2117 | Cabinets médicaux | PARTIAL | `HealthcareService` couvre partiellement |
| US-2118 | Praticiens libéraux | NOT STARTED | — |

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
| US-2265 | Événements `ACCESS_DENIED` audit | NOT STARTED | Follow-up PR #343 — 2 SP. Issue [#344](https://github.com/freecompub/Diabeo-BackOffice/issues/344). Origine : healthcare-security-auditor L-A. |
| US-2268 | Convention `auditLog.resourceId` normalisée | NOT STARTED | Follow-up PR #343 — 8 SP — **V1**. Issue [#347](https://github.com/freecompub/Diabeo-BackOffice/issues/347). Cross-cutting refacto ~30 call sites. |

### Domaine 12 — Documents (1 US)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2140 | Upload S3 documents | DONE | `src/lib/storage/s3.ts`, `src/app/api/documents/upload/route.ts`, `src/app/api/documents/[id]/download/route.ts`, `src/app/api/account/photo/route.ts`. SSE-S3, ClamAV, rate limit, RBAC, audit. PR #339. |

### Domaine 13 — Administration (3 US — 1 follow-up Mirror MVP)

| US | Titre | Statut | Fichiers clés |
|----|-------|--------|---------------|
| US-2148 | Admin gestion utilisateurs UI | NOT STARTED | Backend RBAC OK, page admin manquante |
| US-2151 | Backup management | NOT STARTED | — |
| US-2267 | Migrations Prisma versionnées | NOT STARTED | Follow-up PR #343 — 5 SP. Issue [#346](https://github.com/freecompub/Diabeo-BackOffice/issues/346). Bloquant audit HDS — `prisma migrate deploy` actuellement vide. |

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

### Follow-ups Mirror MVP (4 US — PR #348 mergée)

| US | Titre | Priorité | SP | Issue | Domaine roadmap |
|----|-------|----------|----|-------|------------------|
| US-2265 | Événements `ACCESS_DENIED` audit | MVP | 2 | [#344](https://github.com/freecompub/Diabeo-BackOffice/issues/344) | Domaine 11 (Conformité) |
| US-2266 | Email médecin sur alerte critique | MVP | 3 | [#345](https://github.com/freecompub/Diabeo-BackOffice/issues/345) | Domaine 06 (Messagerie) |
| US-2267 | Migrations Prisma versionnées | MVP | 5 | [#346](https://github.com/freecompub/Diabeo-BackOffice/issues/346) | Domaine 13 (Administration) |
| US-2268 | Convention `auditLog.resourceId` normalisée | V1 | 8 | [#347](https://github.com/freecompub/Diabeo-BackOffice/issues/347) | Domaine 11 (Conformité) |

**PR #348** — Spec markdown + issues GitHub + items board #2 en Backlog. Effort total : 18 SP (10 MVP + 8 V1).

---

## V1 — 120 US

### Groupe 1 — Glycémie & Analytics (13 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2031 | Ingestion Medtronic Guardian | NOT STARTED |
| US-2032 | Glycémies capillaires (BGM) | PARTIAL |
| US-2038 | Heat-map glycémique | NOT STARTED |
| US-2039 | Comparaison de périodes | NOT STARTED |
| US-2040 | Rapport AGP exportable PDF | NOT STARTED |
| US-2041 | Pattern detection | NOT STARTED |
| US-2094 | Tableau de bord population | NOT STARTED |
| US-2095 | Indicateurs qualité cabinet | NOT STARTED |
| US-2096 | Cohorte par pathologie | NOT STARTED |
| US-2098 | Export CSV / Excel | NOT STARTED |
| US-2243 | (Mirror) Supervision glycémie patient | NOT STARTED |
| US-2244 | (Mirror) Détection patterns par patient | NOT STARTED |

### Groupe 2 — Patients avancés (7 US)

| US | Titre | Statut |
|----|-------|--------|
| US-2019 | Recherche full-text patients | NOT STARTED |
| US-2021 | Transfert patient entre médecins | NOT STARTED |
| US-2022 | Tags & catégorisation patients | NOT STARTED |
| US-2024 | Historique modifications (UI audit) | PARTIAL |
| US-2026 | INS — Identité Nationale Santé | NOT STARTED |
| US-2028 | Dossier multi-praticiens | PARTIAL |

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

## V3 — 8 US

| US | Titre |
|----|-------|
| US-2155 | AI prédiction risque hypo |
| US-2156 | AI suggestions ajustement |
| US-2162 | Évaluation post-programme ETP |
| US-2163 | Certificat complétion ETP |
| US-2262 | Rapport activité ETP cabinet |
| US-2263 | Diffusion cohorte messages |
| US-2264 | Notifications proactives |
| US-2058 | Reconnaissance image repas AI |

---

## V4 — 15 US

| US | Titre |
|----|-------|
| US-2067 | Visioconférence intégrée |
| US-2069 | Prescription digitale |
| US-2075 | SMS critiques |
| US-2139 | Certification HDS éditeur |
| US-2172+ | LAP certifié HAS (module prescription complet) |
| US-2192+ | Signatures eIDAS qualifiées |
| US-2206+ | Transmission e-prescription nationale |

---

## Effort restant MVP

| Batch | Description | Story Points | Statut |
|-------|-------------|--------------|--------|
| A | Compléter 6 US PARTIAL | ~12 SP | À faire |
| B | 7 nouvelles US backoffice | ~22 SP | À faire |
| C | ~~9 US Mirror MVP~~ | ~~42 SP~~ | ✅ DONE (PR #343) |
| D | **3 follow-ups MVP Mirror** (US-2265/2266/2267) | **10 SP** | 🆕 À faire |
| **Total** | **16 US restantes (post-merge #343)** | **~44 SP** | |

> Compteurs post-merge : **47/63 = 75%** sur le MVP scope original. Batch D (3 follow-ups MVP US-2265/2266/2267) → cible **50/63 = 79%** au sprint suivant. Reste US-2268 (V1, 8 SP).

### US MVP récemment livrées

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
