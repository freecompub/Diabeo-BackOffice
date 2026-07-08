# DPIA — Auto-application experte des ajustements d'insulinothérapie (US-2657)

**Statut** : Brouillon — **à signer DPO + RSSI + responsable qualité/réglementaire (MDR) avant toute
activation en production**. Tant que non signée : `AUTO_APPLY_GLOBALLY_ENABLED` = OFF, tous les
`Patient.autoApply` = OFF.
**Périmètre (slice C1 — socle gouvernance & persistance, additif)** : champ `Patient.autoApply` (OFF par
défaut), modèles `GovernanceApproval` et `AutoApplyEvent`, service `governanceService.setAutoApply`
(ADMIN + approbation), route `PATCH /api/governance/auto-apply`, kill-switch global
`AUTO_APPLY_GLOBALLY_ENABLED` (`src/lib/env.ts`). **Le harnais qui applique effectivement n'est PAS livré
en C1** (slices C2/C3) ; l'auto-application reste **inopérante** tant que les deux verrous ne sont pas ON.
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
  patient et son médecin peuvent à tout moment revenir en voie proposition (désactivation du flag, toujours
  permise) ; (c) **transparence & traçabilité** — chaque auto-application est auditée (`before → after`,
  paramètre, créneau, décision d'enveloppe) et journalisée (`AutoApplyEvent`).
- **MDR — frontière dispositif médical.** Faire varier une dose sans clinicien dans la boucle relève du
  marquage. **L'activation en production est une décision de gouvernance qualité/réglementaire, jamais une
  décision de développement.** Ce document et le code n'**autorisent** rien : ils **outillent** une bascule
  qui reste subordonnée à signature.

## 3. Garde-fous (défense en profondeur)

1. **Double verrou OFF par défaut** : kill-switch **global** `AUTO_APPLY_GLOBALLY_ENABLED` (env, fail-safe
   sur valeur absente/malformée) **ET** flag **par patient** `Patient.autoApply`. Le harnais n'auto-applique
   que si les **deux** sont ON.
2. **Activation gouvernée** : poser `autoApply = true` exige le rôle **ADMIN** **et** un artefact
   `GovernanceApproval` (référence de décision + lien DPIA) créé dans la même transaction. **Désactivation
   toujours permise, sans approbation** (kill direction fail-safe).
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

## 5. Décision

Traitement **à haut risque** justifiant cette DPIA. **Non activable** avant signature conjointe DPO + RSSI +
responsable MDR. Le socle (C1) est livré **inerte** (double verrou OFF) pour permettre l'instruction et les
tests sans exposer aucun patient.
