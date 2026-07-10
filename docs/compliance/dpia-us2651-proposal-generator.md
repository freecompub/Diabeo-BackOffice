# DPIA — US-2651 Générateur automatisé de propositions d'ajustement (cron nocturne)

> **Statut** : V1 — décision DPO requise sur les risques résiduels (§3).
> **Traitement** : génération **automatisée systématique** de propositions d'ajustement
> d'insulinothérapie (chemin **ICR** livré ; ISF/basal/fixedDose à venir), exécutée **chaque nuit**
> sur l'ensemble du portefeuille patient actif. **Aucune proposition n'est appliquée automatiquement**
> (ADR #13) : chaque proposition est `pending` et validée par un **DOCTOR**.

---

## 1. Périmètre du traitement

- **Finalité** : proposer aux soignants des ajustements de ratio insuline/glucides (ICR) fondés sur les
  tendances glycémiques post-prandiales, pour accélérer la titration. **Suggestion, jamais exécution.**
- **Déclencheur** : cron `GET|POST /api/cron/generate-proposals` (OVH/Vercel/GitHub Action), schedule
  recommandé `0 2 * * *`. Auth **Bearer `CRON_SECRET`** (pas de JWT user).
- **Données lues** (Art. 9 — santé), par patient, sur **14 jours glissants** :
  - configuration d'insulinothérapie (créneaux ICR) — `InsulinTherapySettings`/`CarbRatio` ;
  - journal repas dérivé du CGM (PPG 2 h, nadir post-prandial, glucides, bolus, pré-repas) — agrégé,
    **lecture seule** ;
  - pathologie + `pregnancyMode` (pour la cible post-prandiale pathology/grossesse-aware).
- **Données écrites** : `AdjustmentProposal` (`source = algorithm`, `proposedByUserId = null`, statut
  `pending`). **Valeurs stockées = ratios ICR + agrégat `averageObservedValue`** (moyenne PPG), **pas**
  de série glycémique brute nouvelle.
- **Population** : patients **actifs et non supprimés** uniquement (`deletedAt: null` +
  `user.status = 'active'`) → exclusion RGPD Art. 17 (droit à l'effacement) et comptes inactifs.

## 2. Mesures techniques implémentées

- **Frontière dispositif médical (MDR / IEC 62304)** : un patient **non insuliné** ne reçoit **aucune**
  proposition de dose (refus serveur `nonInsulinNoDose`). Fail-closed sur config incohérente.
- **Garde-fous cliniques** (source unique `CLINICAL_BOUNDS`) : bornes dures ICR `[3,0 ; 30,0]` g/U,
  cap moteur ± 20 %, **garde hypo** (nadir post-prandial → suppression d'une baisse d'ICR si hypo
  sévère/niveau-1 récurrent), **deadband post-prandial** asymétrique pathology/grossesse-aware,
  portes qualité pré-repas. Détail : `docs/clinical-logic/algorithme-propositions-ajustement.md`.
- **Anti-emballement** : `createEngineProposal` re-dérive `currentValue` serveur, rejette si la base a
  dérivé (`baselineMovedAtPersist`), asservit `reason`↔direction, anti-spam `one_pending_per_slot`.
- **Idempotence + anti double-run** : verrou **advisory session** (`withSessionAdvisoryLock`) — deux
  runs concurrents (OVH + Vercel) → l'un skip (`skippedConcurrent`).
- **Traçabilité HDS** : audit **run-level immuable** (`proposal.generator.cron.run` + métriques +
  `durationMs` ; `skipped_locked` sur skip concurrent) ; **chaque lecture** de santé auditée
  (`READ INSULIN_THERAPY`, `READ DIABETES_EVENT`) ; **chaque `CREATE`** de proposition audité — tous
  attribués à l'**acteur système** (`userId: null`, sentinel FK-safe), avec `metadata.patientId` pivot
  forensique et `requestId` de run partagé.
- **Isolation** : erreur infra sur un patient → comptée (`errored`) sans arrêter le portefeuille.
- **PHI** : réponse HTTP = **compteurs seuls** (`processed/created/errored/skippedConcurrent`) ;
  logs sans valeur clinique (`patientId`/`bucket`/`failMode` codes) ; secret jamais logué.
- **Auth durcie** : `constantTimeEqual` (timing-safe), 503 sans secret, 401 générique + audit
  `cron.auth.failed` (burst SOC US-2265). `CRON_SECRET` validé au boot (≥ 64 hex + entropie).

## 3. Risques résiduels V1 (décision DPO requise)

### 3.1 MEDIUM — Acteur système `null` (vs compte de service dédié)
Les lectures de masse Art. 9 sont attribuées à `userId: null` (convention repo, partagée avec les crons
invoice/appointment). Le marqueur run-level (`proposal.generator.cron.run`) **ancre** le `requestId`
partagé → traçabilité suffisante à ce stade. **Amélioration tracée** : compte de service **non-login
identifiable** (`svc-proposal-generator`, sa propre ligne `User`) pour rendre les accès système
auto-identifiants. Décision DPO : `null` + marqueur run acceptable en V1 ?

### 3.2 MEDIUM — Art. 22 (décision automatisée)
La génération est **automatisée et systématique**, mais chaque proposition est **doctor-gated** (jamais
auto-appliquée) → **pas d'effet juridique ou significatif sans intervention humaine** → **Art. 22 strict
non applicable** (même raisonnement que `dpia-us2108`). Le gate DOCTOR **est** la garantie d'intervention
humaine. À confirmer DPO ; information patient (transparence Art. 13/14) sur l'aide algorithmique à revoir.

### 3.3 LOW — Minimisation (lecture nocturne de 14 j pour tout le portefeuille)
Lecture seule, agrégée, sans nouveau stockage brut, proportionnée à la finalité (titration ICR par
créneau). Pas de sur-collecte. Fréquence nocturne = hors pics d'usage.

### 3.4 LOW — Angles morts cliniques documentés
Resucrage tronquant le nadir, mean-vs-nadir (US-2653), basale stylo/MDI, régime hybride — tous
**fail-safe** (sous-action, jamais sur-dosage) et tracés dans le catalogue clinique.

### 3.5 LOW — Données de dosage numériques en clair applicatif (protection at-rest) — US-2652
Les **doses numériques** manipulées par les propositions reposent sur le chiffrement
**at-rest (pgcrypto) + RBAC**, PAS sur l'AES-256-GCM applicatif, par **contrainte de calculabilité** (le
moteur de titration doit lire/comparer les valeurs) :
- `fixed_dose_slots.value_u` (dose fixe en U), `insulin_sensitivity_factors`/`carb_ratios`/`pump_basal_slots`
  (ratios/débits), `adjustment_proposals.current_value`/`proposed_value`/`change_percent` ;
- `clinical_review_flags.type` — **health-adjacent** : un flag `tirBelowTarget`/`hba1cStale` implique une
  préoccupation clinique, donc traité comme donnée de santé pour l'at-rest + RBAC (pas exposé hors périmètre).
Mitigations : aucune de ces valeurs n'est journalisée en clair (audit sans PHI), ni renvoyée hors du
périmètre RBAC patient ; `proposer_comment` (texte libre) reste chiffré **AES-GCM applicatif** (jamais en
réponse/log/URL). Décision DPO : posture at-rest acceptée pour les valeurs numériques (calculabilité).

## 4. Procédures opérationnelles

- **Configuration cron** : `0 2 * * *`, header `Authorization: Bearer $CRON_SECRET`.
- **Désactivation en incident** : vider `CRON_SECRET` (route → 503) puis redéployer, **ou** feature-flag
  de désactivation (à prévoir). Note : `assertRequiredEnv` crashe au boot si `CRON_SECRET` absent →
  préférer un flag à la suppression du secret en prod.
- **Observabilité** : métriques de réponse + audit run-level (`kind: proposal.generator.cron.run`).

## 5. Validation

- [ ] Revue DPO — risques 3.1 (acteur système) et 3.2 (Art. 22 / information patient).
- [x] Revue sécurité (healthcare-security-auditor) — auth OK, filtre RGPD OK, audit run-level ajouté.
- [x] Revue médicale (medical-domain-validator) — bornes, deadband, garde hypo validés.
- [ ] Information patient (transparence aide algorithmique) — à intégrer aux CGU/politique.

---

*DPIA liée : [`dpia-us2605-consultation-review.md`](./dpia-us2605-consultation-review.md) (mode revue,
sans automatisation — périmètre distinct). Source de vérité algorithme :
`docs/clinical-logic/algorithme-propositions-ajustement.md`.*
