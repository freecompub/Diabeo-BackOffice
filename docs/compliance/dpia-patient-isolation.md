# DPIA — Isolation patient par médecin référent (US-2618 / F6)

**Statut** : Brouillon — à signer DPO + RSSI avant mise en service patients réels.
**Périmètre (PR3)** : bascule de l'enforcement clinique de « appartenance au service »
à « médecin référent » dans `src/lib/access-control.ts` (`canAccessPatient`,
`getAccessiblePatientIds`), alignement de la liste portefeuille (`patient.service`
`listForCaller`/`listByService`) + routes `/api/patients`, `/api/messaging/contacts`,
et backfill `PatientReferent`.
**Lié à** : `dpia-access-foundations.md` (socle), `dpia-patient-detail-dossier.md`.

## 1. Changement d'accès

| Rôle | Avant | Après (F6) |
|---|---|---|
| **DOCTOR** | tous les patients des services dont il est membre | **uniquement SES patients** (`PatientReferent.pro.userId`) |
| **NURSE** | patients de ses services | **inchangé** (périmètre service — il assiste les médecins du cabinet) |
| **ADMIN** | bypass PHI | bypass (inchangé — risque V1 accepté, levé en V4 / F1) |
| **VIEWER** | propre dossier | inchangé |

**Responsable de traitement (RGPD)** : médecins = **contrôleurs distincts** (chacun ses
patients via référent) ; hôpital = établissement (tenant) contrôleur. F6 matérialise
cette frontière entre médecins d'un même cabinet de groupe.

## 2. Décisions de design à valider DPO

- **2.1 — DOCTOR isolé par référent** : un médecin A ne voit plus les patients du médecin
  B du même service. Corrige une **incohérence préexistante** (la liste `listByDoctor`
  était déjà référent, mais `canAccessPatient`/`getAccessiblePatientIds` étaient
  service-larges → un médecin pouvait accéder en per-patient à un patient hors de son
  portefeuille). F6 ferme cette sur-exposition.
- **2.2 — NURSE conserve le périmètre service (décision actée)** : le référent étant un
  médecin, isoler l'infirmier par référent le priverait de tout patient. En V1 l'infirmier
  garde l'accès aux patients de son/ses service(s) (workflow préservé). **Résidu** : dans
  un cabinet de groupe, un infirmier partagé voit les patients de **tous** les médecins du
  service → à raffiner via une affectation infirmier↔médecin (post-V1).
- **2.3 — Backfill** : pour ne pas rendre invisible un patient déjà suivi, un
  `PatientReferent` est créé pour les patients sans référent à partir du membre assigné
  (`PatientService.member_id`). **Patients sans référent NI membre assigné** → **fail-closed**
  (invisibles aux médecins, seulement `ADMIN`) : ils devront être affectés via la gestion
  (PR4). Migration data-only, idempotente.

## 3. Mesures techniques

- Enforcement **serveur** unique (`access-control.ts`) branché par rôle ; aucune
  dérogation dans les routes. `resolvePatientForConsent` (anti-énumération) hérite
  automatiquement du nouveau `canAccessPatient`.
- Index `PatientReferent(proId)` (déjà présent) → pas de seq-scan sur `listByDoctor` /
  `getAccessiblePatientIds(DOCTOR)`.
- Consentement RGPD (`PROVIDER_VISIBLE_USER_WHERE`) conservé sur les listes (opt-out
  Art. 21 honoré dès qu'une row privacy existe).
- Audit inchangé (lecture portefeuille `READ PATIENT resourceId="list"` + metadata
  acteur/scope).

## 4. Risques résiduels

- **Patients orphelins** (sans référent ni membre assigné) invisibles aux médecins après
  bascule → atténué par le backfill ; les cas restants relèvent de l'affectation (PR4).
  **Fail-closed assumé** (sécurité > disponibilité).
- **Infirmier partagé** (cabinet de groupe) voit tous les médecins du service (§2.2).
- **ADMIN PHI** : inchangé, V4 (F1).

## 5. Tests

- `tests/unit/access-control.test.ts` — DOCTOR référent (accès + isolation A≠B, ne
  retombe pas sur le service) ; NURSE service ; ADMIN/VIEWER inchangés ;
  `getAccessiblePatientIds` par rôle.
- `tests/unit/f6-backfill-referent-sql.test.ts` — garde du backfill (idempotent, data-only).
- Consommateurs migrés (device-supervision/sync-status/lifecycle) : DOCTOR via référent.
- Backfill vérifié en base (recréation d'un référent supprimé depuis `member_id`).
- Non-régression : suite complète verte.

## 6. Validations à obtenir

- [ ] DPO : isolation DOCTOR par référent (§2.1) + responsable de traitement (§1) ;
  NURSE service-scope V1 + résidu infirmier partagé (§2.2).
- [ ] RSSI : fail-closed orphelins (§2.3/§4), enforcement serveur unique.
- [ ] Direction Médicale : un médecin ne voit que ses patients ; l'infirmier assiste le
  cabinet (workflow).

---

*Dernière mise à jour : 2026-06-17 — DPIA initiale isolation par référent (PR3 / F6).*
