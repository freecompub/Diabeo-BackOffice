# DPIA — Auto-application experte des ajustements d'insulinothérapie (US-2657)

**Statut** : Brouillon — **à signer DPO + RSSI + responsable qualité/réglementaire (MDR) avant toute
activation en production**. Tant que non signée : `AUTO_APPLY_GLOBALLY_ENABLED` = OFF, tous les
`Patient.autoApply` = OFF.
**Périmètre (slices A→C2b + durcissement)** : champ `Patient.autoApply` (OFF par défaut) + `maturityLevel`,
modèles `GovernanceApproval` et `AutoApplyEvent`, service `governanceService.setAutoApply` (ADMIN + `reference`
+ `dpiaRef` obligatoires + `maturityLevel === EXPERT`), route `PATCH /api/governance/auto-apply`, kill-switch
global `AUTO_APPLY_GLOBALLY_ENABLED` (`src/lib/env.ts`). **Le harnais d'application `applyExpertEditGoverned`
EST livré** (`src/lib/services/auto-apply.service.ts` : enveloppe C1–C8 + application `updateIsf/Icr/PumpSlot`).
⚠️ **Il n'a pas encore d'appelant** (l'orchestrateur groupé C3b n'est pas livré) et, même une fois câblé, reste
**inopérant en production tant que le kill-switch global est OFF** (défaut) — c'est aujourd'hui le seul rempart
d'exécution restant, avec `Patient.autoApply` OFF et cette DPIA non signée. L'activation est donc **strictement
subordonnée à la signature ci-dessus**.
**Lié à** : `docs/UserStory/insulinotherapie-edition/US-2657-maturite-autonomie-graduee.md`,
`docs/clinical-logic/regles-et-constantes-diabete.md` (enveloppe C1–C8 + C6b),
`src/lib/insulin/auto-apply-envelope.ts`.

## 1. Finalité & nature du traitement

Permettre qu'un ajustement de configuration d'insulinothérapie proposé par un **patient EXPERT** (niveau
de maturité le plus élevé, US-2657 A) s'applique à sa configuration active **sans validation médicale
préalable, événement par événement**, lorsqu'il reste dans une **enveloppe de sécurité** stricte
(conditions C1–C8 + C6b). Hors enveloppe → proposition soumise au médecin (comportement actuel). Reproduit
l'autonomie réelle d'un patient expert tout en traçant chaque décision.

## 2. Qualification réglementaire

- **RGPD Art. 9** — données de santé (glycémies, cétonémie, doses). Chiffrement AES-256-GCM at-rest inchangé.
- **RGPD Art. 22 — décision individuelle automatisée.** L'auto-application est une décision automatisée
  produisant des effets sur la personne. Garanties : (a) **périmètre volontaire et gradué** (opt-in
  gouvernance + niveau EXPERT posé par un médecin) ; (b) **droit à l'intervention humaine préservé** — le
  retour en voie proposition est possible à tout moment par plusieurs voies fail-safe : le **médecin**
  (retrait du niveau EXPERT via `PATCH /api/patients/maturity`, qui **remet `autoApply = false`** dans la
  même transaction) ; la **gouvernance plateforme** (`ADMIN`, désactivation du flag, toujours permise sans
  approbation) ; le **kill-switch global** (arrêt immédiat, tous patients). *(Il n'existe pas de voie
  d'auto-désactivation par le patient lui-même : le patient passe par son médecin ; l'action de gouvernance
  est plateforme, cf. ADR #22.)* ; (c) **transparence & traçabilité** — chaque auto-application est auditée
  via une action dédiée (`AUTO_APPLIED_SETTING` / `AUTO_APPLY_FALLBACK` / `AUTO_APPLY_REJECTED`,
  `before → after`, paramètre, créneau) et journalisée (`AutoApplyEvent`).
- **MDR — frontière dispositif médical.** Faire varier une dose sans clinicien dans la boucle relève du
  marquage. **L'activation en production est une décision de gouvernance qualité/réglementaire, jamais une
  décision de développement.** Ce document et le code n'**autorisent** rien : ils **outillent** une bascule
  qui reste subordonnée à signature.

## 3. Garde-fous (défense en profondeur)

1. **Triple verrou OFF par défaut** : kill-switch **global** `AUTO_APPLY_GLOBALLY_ENABLED` (env, fail-safe
   sur valeur absente/malformée) **ET** flag **par patient** `Patient.autoApply` **ET** existence d'une
   `GovernanceApproval` active (re-vérifiée **à l'exécution** par le harnais, pas seulement le booléen). Le
   harnais n'auto-applique que si les **trois** sont réunis.
2. **Activation gouvernée (plateforme)** : poser `autoApply = true` exige le rôle **ADMIN** (autorité
   gouvernance plateforme — DPO/RSSI/MDR, cf. ADR #22), **`maturityLevel === EXPERT`**, **et** un artefact
   `GovernanceApproval` avec **`reference` ET `dpiaRef` obligatoires** (fail-closed : sans DPIA référencée,
   la bascule est refusée). Un **downgrade** de maturité remet `autoApply = false`. **Désactivation toujours
   permise, sans approbation** (kill direction fail-safe).
3. **Enveloppe de sécurité C1–C8 + C6b** (slice B, validée medical) : type de changement (valeur seule),
   amplitude (≤ 10 % / ≤ 1 U), bornes cliniques absolues (sinon rejet dur), délivrabilité, garde hypo (hausse),
   **garde hyper/cétose asymétrique** (baisse — plancher de suffisance de données, cétonémie, TAR), anti-cliquet
   (72 h + 15 %/7 j), **fail-closed** sur tout doute. Hors enveloppe → proposition.
4. **Traçabilité HDS/CNIL** : audit `UPDATE PATIENT` de chaque décision de gouvernance (`from → to` +
   référence, sans PHI — **chaque re-approbation est tracée**, même sur un patient déjà activé) ;
   `AutoApplyEvent` append-only pour l'anti-cliquet et la reconstitution forensique. Les tables
   `governance_approvals`/`auto_apply_events` sont **anti-altération** (trigger PG bloquant UPDATE,
   `prisma/sql/audit_immutability.sql`) ; DELETE reste permis pour l'effacement RGPD Art. 17 (l'action
   demeure dans `audit_logs`, immuable et non cascadé).
5. **Réversibilité** : désactivation immédiate (par patient ou globale via kill-switch) ; aucune donnée
   patient supprimée.

## 4. Risques résiduels & mesures

| Risque | Mesure |
|---|---|
| Sur-dosage / hypo par auto-hausse | Garde C6 (hypo) + amplitude C3 + anti-cliquet C7 ; hors enveloppe → proposition. |
| Sous-dosage / acidocétose par auto-baisse | Garde **C6b** : plancher de données (14 j/70 %/≥100 relevés), cétonémie ≥ seuil, TAR>180/250 → proposition. |
| Activation par erreur | Double verrou OFF + approbation gouvernance + audit + kill-switch global. |
| Dérive lente (cliquet) | C7 : cooldown 72 h + cumul 15 %/7 j par (paramètre × créneau). |
| Donnée manquante/corrompue | C8 fail-closed → proposition, jamais d'auto-application sur doute. |
| **Dérive de base : acceptation d'une proposition d'ensemble périmée (C3d)** — ✅ *FERMÉ (grouped-only, ADR #26)* | Une `SlotSetProposal` pending est un **cliché figé du jeu complet**. Le risque venait des **routes d'écriture par-créneau DOCTOR** : un médecin baissant *un* créneau (ex. post-hypo) **ne supersédait pas** la proposition pending → l'accepter ensuite ré-introduisait l'insuline coupée. **Résolution** : les écritures par-créneau (`POST`/`PATCH`/`DELETE` ISF/ICR/basal) sont **retirées** ; l'unique voie d'écriture est le remplacement **GROUPÉ** (`replaceSlotSet`/`replacePumpSlotSet`), qui **supersède** les propositions `pending` du paramètre → toute modification de la base périme les propositions d'ensemble à la source. Défense en profondeur conservée : re-validation clinique + frontière MDR `nonInsulin` à l'acceptation, écran `/patients/[id]/review`, acceptation atomique fail-closed. |
| **Effet cumulé co-directionnel d'un GROUPE auto-appliqué (C3b)** — *risque résiduel ASSUMÉ* | L'orchestrateur groupé `applyExpertGroupGoverned` plafonne le **nombre** de créneaux auto-modifiés par session (`AUTO_APPLY_MAX_GROUP_SLOTS = 2`, borne l'attribuabilité/périmètre) et l'ampleur **par créneau** (C3 ±10 %, C7). **Il ne borne PAS l'ampleur cumulée co-directionnelle** : 2 créneaux dans le même sens à −10 % ≈ +11 % d'insuline prandiale **par créneau/repas** (pas un total de session) ; l'anti-cliquet C7 étant par-créneau, un groupe N=2 co-directionnel répété peut dériver le profil jusqu'à **~2× le plafond C7 hebdo** sur la portion de journée couverte. **Décision produit US-2657** : cap par nombre retenu, garde d'ampleur groupe (`AUTO_APPLY_MAX_GROUP_CUMULATIVE_PERCENT`) **non implémentée** — angle mort instruit ici. Mitigations en place : tout-ou-rien (un créneau hors enveloppe → groupe entier en proposition), gardes C6/C6b globales patient, kill-switch. À reconsidérer avant activation production. |

## 5. Décision

Traitement **à haut risque** justifiant cette DPIA. **Non activable** avant signature conjointe DPO + RSSI +
responsable MDR. Le socle (C1) est livré **inerte** (double verrou OFF) pour permettre l'instruction et les
tests sans exposer aucun patient.
