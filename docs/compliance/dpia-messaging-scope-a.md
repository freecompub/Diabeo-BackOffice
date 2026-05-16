# DPIA — US-2076 scope A Messagerie sécurisée

> Document Privacy Impact Assessment pour la messagerie 1↔1
> patient↔PS et staff↔staff (RGPD Art. 35).
> Statut : draft V1 — validation DPO en cours.

## 1. Périmètre du traitement

- **Données** : contenu des messages échangés (texte libre potentiellement
  PHI), métadonnées (expéditeur/destinataire, horodatage, lu/non-lu).
- **Personnes concernées** : patients diabétiques, médecins, infirmiers,
  admins de la plateforme Diabeo.
- **Finalité** : coordination clinique (questions patient↔soignant,
  handoff staff↔staff, prescriptions, ajustements de traitement).
- **Base légale** :
  - Art. 9(2)(a) RGPD : consentement explicite du patient (gdprConsent)
    pour le stockage et le traitement de messages contenant PHI.
  - Art. 9(2)(h) : envisageable pour soins de santé entre PS, mais
    Diabeo a choisi le modèle de consentement unilatéral V1.

## 2. Mesures techniques implémentées

| Mesure | Référence | Statut |
|---|---|---|
| Chiffrement AES-256-GCM corps de message | `crypto/health-data.ts` | ✅ |
| HMAC-SHA256 + pepper `conversation_key` (HIGH-2 round 5) | `messaging.service.ts:96` | ✅ |
| Anti-énumération routes `/messages/**` | 404 sur non-participant | ✅ |
| Consentement émetteur ET destinataire | `requireGdprConsent` 4 routes | ✅ |
| Audit log immuable HDS Art. L.1111-8 | trigger PG | ✅ |
| Pivot `metadata.patientId` singulier (US-2268) | listThreads N rows | ✅ |
| FCM data payload sans PHI/identifier | `nonce: randomUUID()` | ✅ |
| Soft-delete RGPD Art. 17 + purge user | `deletion.service.ts` | ✅ |
| Export RGPD Art. 20 + flag truncated | `export.service.ts` | ✅ |
| Cache-Control: no-store toutes routes | 4/4 routes | ✅ |
| Rate-limit 100 msgs/min/user | in-memory POC | ⚠️ V1 |
| Decrypt-fail SOC alerting throttled | per-user + cumulative | ✅ |

## 3. Risques résiduels acceptés V1 (avec décision DPO requise)

### 3.1 HIGH — Rétention messages absente (issue GH #413)

- **Risque** : Conservation indéfinie viole RGPD Art. 5(1)(e).
- **Mitigation V1** : aucune purge automatique. Suppression Art. 17 sur
  demande user uniquement.
- **Plan** : Issue GH #413 (`US-2076-bis-retention`). Proposition 36 mois
  (ANS-aligned) ou 6 ans (audit-aligned). **Décision DPO requise avant
  pre-prod.**
- **Acceptabilité** : OK pour dev/recette, **bloquant** pre-prod patients réels.

### 3.2 HIGH — Posture consent destinataire bloque l'envoi

- **Risque** : Si Bob (patient ou PS) révoque son consent, Alice ne peut
  plus lui envoyer de message. Tension avec Art. 9(2)(h) "soins de santé"
  qui pourrait justifier un envoi PS→patient même sans consent actif.
- **Mitigation V1** : Posture conservatrice — blocage uniforme.
  L'audit `accessDenied` (kind `message.send.recipientConsentRevoked`)
  préserve la forensique CNIL.
- **Plan** : statu quo V1 conservateur. Reconsidérer en V2 selon retours
  métier.
- **Décision DPO** : valider la posture V1 et documenter.

### 3.3 MEDIUM — Write amplification 8 indexes par INSERT message

- **Risque** : Bloat sous CHURN (read_at flip NULL→timestamp).
- **Mitigation V1** : REINDEX trimestriel recommandé, monitoring
  `pg_stat_user_indexes.idx_scan`.
- **Acceptabilité** : OK pour POC 50K patients, à monitorer scale.

### 3.4 MEDIUM — `conversation_key` HMAC-SHA256 dans 4 indexes B-tree

- **Risque** : Même avec pepper HMAC, l'index leak partiel + accès au
  pepper (env var compromise) reconstruit le graphe bipartite.
- **Mitigation V1** : Pepper stocké hors DB (env var), rotation possible.
  Chiffrement at-rest pgcrypto.
- **Plan V2** : envisager `pgcrypto`-encrypted column ou view matérialisée
  hashée à la lecture seule.

### 3.5 MEDIUM — Rate-limit in-memory (1 VPS POC)

- **Risque** : Scale-out horizontal sans config Redis → 100 msg/min × N
  instances effectif.
- **Mitigation V1** : Documenté dans `messaging.service.ts:27-29`. Boot
  assert single-instance en V1.
- **Plan V2** : Migration `@upstash/redis` atomic INCR+EXPIRE quand >1 VPS.

### 3.6 MEDIUM — FCM `nonce` sans mapping → notif fantôme post-crash app

- **Risque** : Si app iOS crashe avant fetch inbox, notification système
  reste sans contenu fetchable directement.
- **Mitigation V1** : Client iOS doit refetch inbox sur tap notification
  (pattern documenté `docs/runbook/messaging-mobile-contract.md`).
- **Acceptabilité** : Trade-off UX vs anti-corrélation Google Cloud Act.

## 4. Conditions GO production patients réels

- [ ] Issue GH #413 livrée (rétention messages).
- [ ] Décision DPO #1 (consent destinataire posture V1).
- [ ] Décision DPO #2 (durée rétention 36 mois ou 6 ans).
- [ ] DPIA validée signed-off par DPO.
- [ ] Monitoring `pg_stat_user_indexes` en place.
- [ ] Test EXPLAIN ANALYZE sur dataset 100K messages.

## 5. Historique des revues

| Round | Date | Verdict | Issues |
|---|---|---|---|
| 1 | 2026-05-15 | NO-GO | 5 Critical + 9 High |
| 2 | 2026-05-15 | NO-GO | 1 Medium (CHECK 8192) |
| 3 | 2026-05-15 | NO-GO | 1 Critical + 8 High |
| 4 | 2026-05-15 | NO-GO | 1 Critical (audit recipientConsent) + 3 High |
| 5 | 2026-05-16 | GO HDS dev/recette | Tous résolus sauf décisions DPO |

## 6. Références

- `docs/runbook/messaging-mobile-contract.md` — Contract API mobile/web.
- Issue GH #413 — `US-2076-bis-retention`.
- ADR #18 CLAUDE.md — Convention audit `metadata.patientId` pivot.
- CLAUDE.md §"Sécurité des données de santé" — Patterns crypto.
