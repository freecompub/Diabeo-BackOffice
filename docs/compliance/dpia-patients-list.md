# DPIA — Patient list endpoint (`GET /api/patients`) + PatientReferent creation

**Statut** : Brouillon — à signer DPO + RSSI avant mise en service patients réels.
**Périmètre** : la route `GET /api/patients`, le service `patientService.{listByDoctor,getOwnSummary,createWithNewUser}`, le composant page `/patients` côté frontend.

## 1. Données traitées

| Donnée | Catégorie RGPD | Décryptée côté serveur ? | Surface API |
|---|---|---|---|
| `Patient.id` | Identifiant interne | n/a | toujours |
| `Patient.pathology` (DT1/DT2/GD) | **Art. 9 — santé** | non chiffré (low entropy) | toujours |
| `User.firstname / lastname` | PII | oui (AES-256-GCM) | DTO `PatientListItemDto.user.firstname/lastname` |
| `User.birthday` (date-only YYYY-MM-DD) | PII | non chiffré (low entropy + needed pour calcul d'âge UI) | DTO `PatientListItemDto.user.birthday` |

**Données NON exposées** par cet endpoint (réservées aux détail-routes `/api/patients/[id]/*`) : `User.email`, `User.phone`, `User.address*`, `User.nirpp`, `User.ins`, `PatientMedicalData.*`, `Treatment.*`, `Device.*`, `Glycemia*`, `Cgm*`, `MedicalDocument.*`, `Appointment.*`.

## 2. Bases légales

- **PRO (NURSE/DOCTOR/ADMIN)** : RGPD Art. 9.2.h — prise en charge médicale par professionnel soumis au secret. Filtre `PatientReferent` garantit que seuls les patients explicitement assignés au PS sont accessibles.
- **VIEWER (patient lui-même)** : RGPD Art. 15 — droit d'accès du sujet à ses propres données.

## 3. Décisions de design à valider DPO

### 3.1 Minimisation `getOwnSummary` côté VIEWER (M1 review HSA)

Le DTO `PatientListItemDto` est **identique** pour les deux branches (VIEWER et PRO). Conséquence : le VIEWER reçoit `firstname + lastname + birthday` alors qu'il s'agit de ses propres données qu'il connaît déjà.

**Justification Art. 5.1.c (minimisation)** : un DTO unifié permet de mutualiser le composant React `<PatientsList>` sans branchement conditionnel par rôle (réduction du risque de bug d'affichage). Côté VIEWER, le `birthday` permet le calcul d'âge cohérent avec la branche PS. Les données envoyées sont déjà connues du sujet → atteinte à la minimisation jugée acceptable.

**Décision DPO requise** : approuver ou demander un DTO scindé (`VIEWER → {id, pathology}` uniquement, label statique "Mon dossier" côté UI).

### 3.2 Asymétrie audit log listing (M2 review HSA)

| Rôle | Pattern audit |
|---|---|
| PRO listing portefeuille | 1 row `READ PATIENT resourceId="list" metadata={doctorUserId, count}` agrégé |
| VIEWER own-summary | 1 row `READ PATIENT resourceId="own-summary" metadata.patientId={id}` par visite |

**Conséquence forensique** : `auditService.getByPatient(patientId)` retrouvera la consultation VIEWER mais **PAS** les listings PRO qui ont surfacé le patient. Un PS pourrait techniquement consulter quotidiennement la liste pour faire de la veille comportementale sans qu'aucune trace par-patient ne soit générée.

**Posture** : cohérente avec `messaging/contacts/route.ts` (même pattern agrégé). Coût d'un changement = stockage explose (1 PS × 500 patients × 1 visite/jour = 500 rows/jour/PS).

**Décision DPO requise** : valider la posture "le listing portefeuille n'est pas traçable par-patient ; seuls les accès nominatifs `getById` le sont". Si refus → migration vers `metadata.patientIds: number[]` + extension du GIN partial index (à valider avec sql-pro).

### 3.3 Filtre `gdprConsent + shareWithProviders` actif (H1 review HSA — FIXED)

Depuis le commit en cours, `listByDoctor` filtre `patient.user.privacySettings.{gdprConsent: true, shareWithProviders: true}`. Conséquence : un patient qui révoque l'un des deux flags via `PUT /api/account/privacy` disparaît du portefeuille de TOUS les PS au refresh suivant (RGPD Art. 7.3 — révocation effective).

**Question DPO ouverte** : un patient VIEWER qui révoque son `gdprConsent` doit-il continuer à voir son propre profil via `getOwnSummary` ?
- Art. 15 (droit d'accès) → oui, accès à ses données toujours possible.
- Art. 7.3 (révocation) → la révocation ne s'applique pas à l'auto-consultation, seulement au partage tiers.
- **Recommandation** : oui, conserver l'accès. Filtre NON-appliqué côté VIEWER (statu quo actuel).

### 3.4 Audit silent skip "patient.created_without_referent" (M4 review HSA — FIXED)

Quand un ADMIN sans `HealthcareMember` crée un patient, aucun `PatientReferent` n'est lié → le patient devient invisible du `listByDoctor` du créateur. Un audit info-only est désormais émis (`metadata.kind = "patient.created_without_referent" + reason = "creator_has_no_healthcare_member"`) pour traçabilité.

**Décision opérationnelle** : prévoir un dashboard admin listant les patients orphelins (patients sans `PatientReferent`) pour qu'un PS puisse les adopter. Pas dans le scope de ce ticket — follow-up V1.5.

## 4. Mesures techniques en place

- AES-256-GCM (IV+TAG+CIPHERTEXT base64) sur firstname/lastname/email.
- HMAC-SHA256 (emailHmac) pour lookup unique sans exposer email chiffré.
- Audit immuable via trigger PG `audit_immutability.sql` (INSERT-only).
- Convention US-2268 : `resourceId = ID natif`, `metadata.patientId` pivot pour forensique CNIL/ANS.
- Headers ANSSI RGS §4.5 sur réponses 200 PHI (Cache-Control no-store, Referrer-Policy no-referrer, nosniff) — H2 fix.
- Signal SOC sur échec décryption massif (`ENCRYPTION_FAILURE` audit + `logger.error` au seuil 10/min) — H3 fix.
- Banner front patient-safety si 3+ patients d'affilée ont des identités null — H3 fix.
- Filtre `gdprConsent + shareWithProviders` côté `listByDoctor` — H1 fix.

## 5. Tests

- Integration self-contained `tests/integration/api-patients-create-with-referent.test.ts` : fixture User+HealthcareService+HealthcareMember si absente, 2 tests (creation OK, conflict no orphan referent).
- Unit `tests/unit/patient-create-with-user.service.test.ts` : 3 nouveaux tests sur la branche `if (member)` (skip si pas de member, create+audit, serviceId null).

## 6. Risques résiduels

- **Asymétrie audit listing** (§3.2) → forensique listing PS lossy.
- **Pas de pagination** sur `listByDoctor` → OOM théorique sur portefeuille > 5000 patients (V1.5 cf. L4 review code-reviewer).
- **DPO décision §3.1 + §3.2 + §3.3** en attente.

## 7. Validations à obtenir

- [ ] DPO : approbation §3.1 (DTO unifié firstname/lastname/birthday VIEWER).
- [ ] DPO : approbation §3.2 (asymétrie audit listing).
- [ ] DPO : confirmation §3.3 (VIEWER auto-consultation post-révocation).
- [ ] RSSI : revue H3 (signal SOC `ENCRYPTION_FAILURE` aggregable).
- [ ] Direction Médicale : revue §3.4 (procédure adoption patient orphelin).

---

*Dernière mise à jour : 2026-06-07*
