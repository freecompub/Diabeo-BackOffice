# DPIA — Groupe 4 Devices & Sync (US-2091 / US-2092 / US-2093)

> Document Privacy Impact Assessment pour la gestion du parc de
> dispositifs médicaux patient (capteurs CGM, pompes, lecteurs BGM,
> applis santé) — RGPD Art. 35.
> Statut : draft V1 — validation DPO en cours.

## 1. Périmètre du traitement

- **Données** :
  - **Whitelist `SupportedDevice`** (référentiel ADMIN) : marque, modèle,
    catégorie, identifiant technique (USB VID:PID / BLE UUID), connexions
    supportées, durée de vie capteur, certification HDS, notes.
    Non-PHI direct mais infrastructure clinique.
  - **`PatientDevice`** (liaison patient ↔ device) : pivot du parc patient
    avec brand/model/sn, date de pairing, supervision (batterie, expiration
    capteur, dernière sync).
  - **`PatientDevice.revokedReasonEnc`** (US-2092) : raison libre chiffrée
    AES-256-GCM, **peut contenir PHI indirect** :
    - "remplacé par Dexcom G7 suite à dysfonctionnement répété" → contexte
      clinique implicite (changement de stratégie thérapeutique).
    - "perdu pendant l'hospitalisation" → révèle un séjour hospitalier.
    - "explant suite à infection site sous-cutané" → événement clinique direct.

- **Personnes concernées** : patients diabétiques (data subjects),
  médecins/infirmiers (acteurs de révocation), ADMIN (mainteneurs whitelist).

- **Finalité** :
  - Validation pre-pairing : seuls les devices testés/conformes HDS sont
    autorisés (US-2091).
  - Soft-revocation traçable : préserve l'historique pour audit forensique
    sans perdre la chronologie patient (US-2092).
  - Consultation historique multi-rôle : timeline complète actifs+révoqués
    avec masquage `revokedReason` pour le patient lui-même (US-2093 + CR C2).

- **Base légale** :
  - **Art. 9(2)(a) RGPD** : consentement explicite du patient (`gdprConsent`)
    pour le stockage et traitement des données device + raison de révocation
    contenant PHI indirect.
  - **Art. 9(2)(h)** : **non invoqué** dans Diabeo V1 (cf. §3.2 ci-dessous).
    Posture conservatrice — toute action sur les données device exige le
    consentement actif du patient.

## 2. Mesures techniques implémentées

| Mesure | Référence | Statut |
|---|---|---|
| Chiffrement AES-256-GCM `revokedReasonEnc` | `crypto/health-data.ts` + `encryptField` | ✅ |
| Cap byte-length UTF-8 reason (defense-in-depth) | `MAX_REASON_BYTES = 500` | ✅ round 2 M1 |
| Colonne VARCHAR(2816) anti-truncation UTF-8 | migration `20260516120000` §3 | ✅ round 2 M1 |
| CHECK SQL coherence revoked_reason_enc NOT NULL | migration `20260516120000` §1 | ✅ round 2 H2 |
| Anti-énumération routes `/devices/**` | helper `resolvePatientForConsent` | ✅ round 2 H2 |
| RBAC AVANT lecture patient (canAccessPatient) | `access-control.ts` | ✅ round 2 H2 |
| Consentement data subject (pas caller) RGPD Art. 9 | helper unifié | ✅ round 2 CR H4 |
| Cross-actor PHI masking : VIEWER ne lit pas revokedReason | `toHistoryDTOForRole` | ✅ round 1 CR C2 |
| Audit log immuable HDS Art. L.1111-8 (revoke transactionnel) | `logWithTx` | ✅ round 1 CR H1 |
| Pivot `metadata.patientId` (US-2268) | revoke + history | ✅ |
| Cursor pagination keyset-safe `(createdAt, id)` | `device-lifecycle.service:474-485` | ✅ round 2 H1 |
| createdAt immutable pour chronologie déterministe | migration §2 + backfill | ✅ round 2 HSA M1 + H3 |
| Connectiontypes whitelist enum | `compatibility/route.ts:30-32` | ✅ round 2 CR M7 |
| Auth AVANT Zod (anti-énumération category enum) | `compatibility/route.ts:54` | ✅ round 2 CR M3 |
| Trigger updated_at search_path verrouillé | migration §5 | ✅ round 2 M2 |
| Cache-Control: no-store sur routes patient | revoke + history | ✅ |
| Soft-delete RGPD Art. 17 cascade | `deletion.service.ts` | ✅ existant |
| Export RGPD Art. 20 inclut `revokedReason` déchiffré | `export.service.ts:197-203` | ✅ round 1 HSA H1 |
| Decrypt-fail logging structuré | `device-lifecycle.service:312-326` | ✅ round 1 HSA L2 |
| Cache GDPR invalidation failure log | `gdpr.ts:61-77` | ✅ round 2 M3 |

## 3. Risques résiduels acceptés V1 (décision DPO requise)

### 3.1 MEDIUM — Posture Art. 9(2)(a) exclusive (pas 9(2)(h) bypass urgence)

- **Risque** : Si un patient révoque son `gdprConsent` ou ne l'a jamais
  donné, **aucune action device** n'est possible — même par un PS soumis
  au secret professionnel agissant dans le cadre de soins de santé.
  Tension opérationnelle avec :
  - Urgence vitale Art. 9(2)(c) : un PS doit pouvoir révoquer un device
    défaillant sans attendre.
  - Patient mineur ou incapable Art. 9(2)(h) : suivi médical obligatoire
    sans consent recueilli.
- **Mitigation V1** : Posture uniforme — blocage. L'audit `accessDenied`
  (kind `device.revoke.accessDenied`) trace toute tentative pour
  forensique CNIL/ANS.
- **Plan** : statu quo V1. Reconsidérer en V2 selon retours métier
  (partenariats hospitaliers urgences). Si bypass à terme, prévoir un
  flag `is_emergency` avec audit-trail dédié + justification obligatoire.
- **Décision DPO** : valider la posture V1 exclusivement consensuelle.

### 3.2 MEDIUM — `revokedReasonEnc` PHI indirect — clé chiffrement unique

- **Risque** : La raison de révocation chiffrée peut révéler du contexte
  clinique en cas de fuite (DB dump, backup compromis). Toutes les raisons
  partagent la même clé `HEALTH_DATA_ENCRYPTION_KEY` (variable d'env).
- **Mitigation V1** :
  - Clé 32 bytes hex (256 bits) hors DB.
  - Rotation prévue runbook (à doc).
  - VIEWER ne déchiffre jamais (cross-actor PHI protection round 1 CR C2).
- **Plan V2** : envelopper avec une KMS (OVH KMS) — `revokedReasonEnc`
  chiffré avec data-key + data-key chiffrée avec master-key KMS.
- **Décision DPO** : valider que clé applicative + envelope crypto futur
  est acceptable post-go-live.

### 3.3 LOW — `nextCursor = PatientDevice.id` brut

- **Risque** : Le cursor retourné est l'auto-increment global. Par
  inférence sur 2 cursors espacés dans le temps, un attaquant
  authentifié peut estimer le volume de devices créés sur le parc Diabeo
  (signal business agrégé, pas PHI direct).
- **Mitigation V1** : pas de mitigation (acceptable pour V1 backoffice).
- **Plan V2** : cursor opaque HMAC-signé `{id, createdAt}` si exposition
  publique.
- **Acceptabilité** : OK V1.

### 3.4 LOW — Rétention `PatientDevice` non plafonnée

- **Risque** : Conservation indéfinie devices révoqués viole RGPD Art.
  5(1)(e). HDS Art. L.1110-4 exige 20 ans post-dernier soin pour le DMP,
  mais le seuil sur les devices reste à définir.
- **Mitigation V1** : aucune purge automatique. Suppression Art. 17 sur
  demande user (cascade via `deletion.service.ts`).
- **Plan** : Issue GH `US-2093-bis-retention` à créer. Proposition
  alignée sur durée de garde DMP ou 6 ans audit (US-2133).
- **Décision DPO** : durée de rétention devices à arbitrer (3 ans / 6 ans /
  20 ans DMP).
- **Acceptabilité** : OK dev/recette, **bloquant pre-prod patients réels**.

### 3.5 LOW — `created_at` backfill imparfait pour rows pré-migration

- **Risque** : Les `PatientDevice` créés avant la migration round 2
  reçoivent `created_at = COALESCE(date, '2024-01-01')` — pour les rows
  sans `date` (rare mais possible), c'est un fallback synthétique.
  Forensique RGPD Art. 5.1.d légèrement dégradée pour le legacy.
- **Mitigation V1** : tie-breaker `id DESC` du orderBy listHistory
  préserve l'ordre relatif d'insertion.
- **Plan** : aucun (legacy data, acceptable).
- **Acceptabilité** : OK.

## 4. Conformité ANSSI / HDS

- **RGS §B1 (chiffrement)** : AES-256-GCM, 12-byte IV random, 16-byte TAG,
  base64 storage. ✅
- **RGS §4.5 (durcissement SGBD)** : trigger `set_updated_at` avec
  `SET search_path = pg_catalog, public` (round 2 M2 — CWE-426). ✅
- **HDS § Art. L.1111-8 (traçabilité)** : CHECK SQL `revoked_reason_enc
  NOT NULL` quand `revoked_at NOT NULL` enforce la complétude du motif
  (round 2 H2). Audit transactionnel garantit l'atomicité commit DB +
  audit log (round 1 CR H1). ✅
- **HDS § Art. L.1110-4 (secret médical)** : `revokedReason` masqué
  cross-actor VIEWER (round 1 CR C2). PHI indirect non exposé au data
  subject (clinician-only). ✅

## 5. Workflow patient

```
1. Patient acquiert un Dexcom G7 via prescription
2. Patient ouvre l'app Diabeo → pre-pairing UI cherche dans la whitelist
   `SupportedDevice` (US-2091, NURSE+ ou ADMIN si non listé)
3. Si non listé → demande ADMIN d'ajouter au référentiel
4. Pairing réussi → `PatientDevice` créé (date pairing + supervision)
5. 14 jours plus tard, sensor défaillant → patient ou PS révoque (US-2092)
   - `revokedReasonEnc` chiffré stocké
   - Audit `device.revoked` + pivot patientId
6. Patient consulte son history (US-2093) → voit le device révoqué SANS
   `revokedReason` (clinician-only PHI protection)
7. DOCTOR/NURSE consulte history → voit `revokedReason` déchiffré
   pour comprendre l'historique clinique
8. Si patient demande export RGPD Art. 20 → toutes les raisons
   déchiffrées dans le JSON (intelligible Art. 20)
9. Si patient supprime son compte → cascade soft-delete + chiffrement
   key destruction de fait (clé applicative reste, mais row anonymisée)
```

## 6. Procédures opérationnelles (runbook)

### 6.1 Rollback humain d'une révocation accidentelle

Le CHECK SQL `revoked_coherence_check` impose que `(revoked_at, revoked_by,
revoked_reason_enc)` soient soit **tous null** soit **tous NOT NULL**.
Pour "déspoiler" une révocation accidentelle :

```sql
-- Audit la raison du rollback dans audit_logs avant l'UPDATE.
INSERT INTO audit_logs (user_id, action, resource, resource_id, metadata, ...)
VALUES (
  <admin_user_id>, 'UPDATE', 'DEVICE', '<deviceId>',
  jsonb_build_object(
    'kind', 'device.revoke.manual_rollback',
    'reason', 'Erreur de saisie PS du <date>',
    'patientId', <patientId>
  ), ...
);

-- Rollback atomique (passe le CHECK : tous NULL).
UPDATE patient_devices
SET revoked_at = NULL, revoked_by = NULL, revoked_reason_enc = NULL
WHERE id = <deviceId>;
```

### 6.2 Rotation clé `HEALTH_DATA_ENCRYPTION_KEY`

À documenter dans `docs/runbook/encryption-key-rotation.md` (V2).

## 7. Validation

- [ ] Revue par DPO sur §3.1 (posture Art. 9.2.a stricte)
- [ ] Revue par DPO sur §3.2 (KMS envelope V2)
- [ ] Décision rétention §3.4 (3a / 6a / 20a)
- [ ] Issue GitHub follow-up rétention créée
- [ ] Runbook rotation clé chiffrement (V2)
- [ ] Runbook rollback humain révocation (§6.1)

---

**Références**
- US-2091 / US-2092 / US-2093 (`docs/UserStory/pro-user-stories/`)
- PR #415 (rounds 1+2 review multi-agents)
- RGPD : Art. 5(1)(d) intégrité, Art. 5(1)(e) limitation conservation,
  Art. 9 catégories particulières, Art. 17 droit à l'effacement,
  Art. 20 portabilité, Art. 35 DPIA
- HDS : Art. L.1110-4 secret médical, Art. L.1111-8 traçabilité
- ANSSI : RGS §B1 cryptographie, RGS §4.5 durcissement SGBD
- CWE-426 untrusted search path (PostgreSQL plpgsql)
