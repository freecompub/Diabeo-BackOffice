# DPIA — Mode revue de consultation (US-2605) : `Encounter` + `ConsultationReportAddendum`

**Statut** : Brouillon — à signer DPO + RSSI avant mise en service patients réels.
**Périmètre (PR1 — modèles + service)** : les modèles `Encounter` (séance de revue,
brouillon de compte rendu) et `ConsultationReportAddendum` (compte rendu finalisé,
**immuable**), le service `encounterService` (`openOrResume` / `saveDraft` /
`finalizeReport` / `listReports`), le trigger PG d'immuabilité
`consultation_report_addenda_immutable`, et l'intégration RGPD Art. 17
(`deletion.service`). L'UI (stepper) et les routes API sont en PR2.
**Lié à** : `dpia-patient-detail-dossier.md` (dossier patient), `hds-rgpd.md`.

## 1. Données traitées

| Donnée | Catégorie RGPD | Chiffrée applicatif ? | Modèle |
|---|---|---|---|
| `Encounter.draftReportEnc` (brouillon de compte rendu) | **Art. 9 — santé** | oui (AES-256-GCM base64) | `Encounter` |
| `Encounter.openedById` (PS auteur), `openedAt/closedAt`, `status` | métadonnée de séance | non | `Encounter` |
| `Encounter.period` / `dataAsOf` (ancrage version des données) | métadonnée | non | `Encounter` |
| `ConsultationReportAddendum.content` (compte rendu finalisé) | **Art. 9 — santé** | oui (AES-256-GCM base64) | addendum |
| `period` / `dataAsOf` (ancrage), `authorId`, `createdAt` | métadonnée | non | addendum |

**Jamais exposé** : le contenu chiffré (blob base64) n'est jamais renvoyé tel quel ;
déchiffrement **strictement serveur**, fail-soft (contenu corrompu → `null`, jamais
d'exception). Aucun PHI en clair dans les logs ni dans `metadata` d'audit (ADR #18 :
pivot `metadata.patientId` uniquement).

## 2. Bases légales

- **PRO (NURSE/DOCTOR/ADMIN)** : RGPD Art. 9.2.h — prise en charge médicale par
  professionnel soumis au secret. Le mode revue est **réservé aux PRO**.
- **Sans IA** : aucune logique de décision automatisée (Art. 22 non applicable). Le
  Résumé est une **projection serveur déterministe** ; les décisions thérapeutiques
  (étape 5) restent le workflow `AdjustmentProposal` existant (DOCTOR-only, jamais
  auto-appliqué).

## 3. Décisions de design à valider DPO

### 3.1 Compte rendu **immuable** (append-only) — trigger PG

`ConsultationReportAddendum` est **append-only** via le trigger
`consultation_report_addenda_immutable` (`BEFORE UPDATE OR DELETE`) :
- tout `DELETE` → `RAISE EXCEPTION` (interdit, même en SQL brut / console DB) ;
- tout `UPDATE` est rejeté **sauf** la transition soft-delete (seule la colonne
  `deleted_at` peut changer ; trigger *column-scoped*).

**Justification** : un compte rendu finalisé est un **acte médical** ; son intégrité
et sa traçabilité sont exigées (HDS / dossier médical). La défense est en base, pas
seulement applicative (Prisma 7 a retiré `$use()` — cf. ADR #10). Copie de référence
ré-appliquable : `prisma/sql/consultation_report_immutability.sql`.

### 3.2 RGPD Art. 17 (effacement) ↔ immuabilité — **rétention actée**

Lors d'un effacement de compte (`deletion.service.deleteUserAccount`) :
- **Brouillons** (`Encounter.draftReportEnc`) : **purgés** (UPDATE → `null`). État
  transitoire, pas un acte médical à conserver. La row `Encounter` est conservée
  (valeur d'audit de séance + FK `Restrict` depuis les comptes rendus retenus).
- **Comptes rendus finalisés** : **conservés** au titre du **dossier médical**
  (CSP R.1112-7 — conservation 20 ans). RGPD **Art. 17.3.b** (obligation légale)
  dispense l'effacement ; l'immuabilité (§3.1) les rend de toute façon non
  supprimables. La rétention est **auditée** explicitement (Art. 30) avec
  `reason: "CSP_R1112_7_medical_record_20y_retention"` — même pattern que les
  factures conservées (CGI/LPF).

> **Cascade vs immuabilité** : le patient est **soft-deleted** (UPDATE `deletedAt`),
> jamais hard-deleted — donc le FK `onDelete: Cascade` sur `patientId` **ne se
> déclenche pas** et le trigger ne bloque pas l'effacement. Le nettoyage des
> brouillons et l'audit de rétention sont donc **explicites** dans `deletion.service`.

**Décision DPO requise** : valider la conservation des comptes rendus finalisés
au-delà de l'effacement de compte (base légale Art. 17.3.b / CSP R.1112-7), et la
purge des brouillons. Acter que la durée de conservation effective relève de la
politique « dossier médical » (hors du périmètre de suppression à la demande).

### 3.3 Ancrage « version des données » (honnêteté clinique)

Le compte rendu fige `period` (ex. `14d`) + `dataAsOf` (instant de calcul du Résumé)
— **pas un snapshot** des données. L'UI (PR2) doit rappeler dans le corps « calculé
le {dataAsOf} sur {period} » pour **ne pas laisser croire à un gel des données**
sous-jacentes.

## 4. Mesures techniques en place (PR1)

- Accès `canAccessPatient` (défense en profondeur) **avant** lecture/écriture sur
  `openOrResume` et `listReports` ; refus → `EncounterError("forbidden")` (mappé par
  les routes PR2 + `auditService.accessDenied`).
- Propriétaire-only sur `saveDraft`/`finalizeReport` (le PS qui a ouvert la séance) ;
  écriture refusée hors statut `draft`.
- Contenus chiffrés **AES-256-GCM** (`@/lib/crypto/fields`) ; lecture fail-soft.
- `finalizeReport` atomique (`$transaction`) : addendum + clôture séance + brouillon
  vidé + 2 audits pivot (`CREATE CONSULTATION_REPORT`, `UPDATE ENCOUNTER`).
- Brouillon vide → colonne `draftReportEnc` remise à `NULL` (pas de chiffré d'une
  chaîne vide) ; finalisation d'un compte rendu vide **refusée** (`invalidState`).
- Audit per-opération (ADR #18, pivot `metadata.patientId`) : `ENCOUNTER`
  (READ resume / CREATE / UPDATE) et `CONSULTATION_REPORT` (CREATE / READ).
- `« aujourd'hui »` = TZ cabinet (Europe/Paris), helper partagé `@/lib/cabinet-time`.

## 5. Tests (PR1)

- `tests/unit/encounter.service.test.ts` — open/resume idempotent, propriétaire-only,
  finalize transactionnel + audits, brouillon vide → NULL, finalize vide refusé,
  `listReports` fail-soft + garde `canAccessPatient`.
- `tests/unit/consultation-report-immutability-sql.test.ts` — garde anti-régression
  statique du trigger (présent dans migration + copie de référence ; soft-delete non
  gelé). Enforcement réel vérifié en base (`pg_trigger`).

## 6. Risques résiduels / à traiter en PR2

- **Race resume** (m2) : pas d'unique partiel « brouillon du jour » (fragile/TZ) ;
  find-or-create transactionnel, doublon rare bénin (finalize en clôt un ; sweep
  `abandoned` ultérieur).
- **Gouvernance NURSE** (MEDIUM medical) : `content` est en texte libre ; un NURSE
  pourrait y écrire un contenu à tonalité thérapeutique. À encadrer en PR2
  (label/avertissement ; `reportType` éducation/suivi vs thérapeutique → V2).
- **Garde route** : `listReports` doit aussi être gardé RBAC à la route (PR2), en
  plus de la défense en profondeur en service.
- **Rappel d'ancrage dans le corps** (§3.3) : à implémenter dans l'UI (PR2).

## 7. Validations à obtenir

- [ ] DPO : approbation §3.2 (rétention des comptes rendus finalisés au-delà de
  l'effacement Art. 17 ; purge des brouillons).
- [ ] DPO : approbation §3.1 (immuabilité append-only en base).
- [ ] RSSI : revue du trigger PG + chiffrement + audit pivot.
- [ ] Direction Médicale : revue §3.3 (ancrage version des données) et §6
  (gouvernance NURSE, sans IA).

---

*Dernière mise à jour : 2026-06-16 — DPIA initiale US-2605 (PR1 : modèles + service +
immuabilité + intégration RGPD Art. 17).*
