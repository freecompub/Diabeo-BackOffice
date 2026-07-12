# US-2663 — ÉPIC « Proposition GROUPÉE intégrale » (grouped-only pour tous, algorithme compris)

> 📌 Épic · **back + front + iOS** · Taille **XL** (multi-slices) · dépend de : US-2657 (`SlotSetProposal`),
> US-2645→2662 (moteur par-valeur), ADR #13/#21/#23/#26/#27/#29
>
> **Statut** : 🟡 **design validé** (architect-reviewer + medical-domain-validator + swift-expert, 2026-07-12) —
> **avant tout code**. Décisions produit ouvertes flaggées ci-dessous.

## Décision produit (utilisateur)

Toute proposition d'ajustement d'insuline — **quelle que soit l'origine (patient, infirmière, médecin,
ALGORITHME), et même si un seul créneau change** — porte la **disposition entière** du levier (jeu de créneaux
complet). Un **composant visuel unique** l'affiche pour tous, en **surlignant les lignes modifiées** (diff
ancien→nouveau). La voie par-valeur (`AdjustmentProposal`) est retirée **en écriture** comme voie de proposition.

## Constats de code fondateurs (vérifiés — au-delà du cadrage initial)

1. **La voie groupée est aujourd'hui MOINS sûre que la voie par-valeur.** `slotSetProposalService.acceptSetProposal`
   (`slot-set-proposal.service.ts:156`) fait `replaceSlotSet` (`deleteMany`+`createMany`) **sans aucun contrôle
   de dérive de base** ; l'accept par-valeur (`adjustment.service.ts`) porte le CAS `baselineMoved` par créneau
   (US-2649b/US-2660). ⇒ Généraliser le groupé **tel quel** = **retrait d'un garde-fou MDR** (NO-GO clinique).
   **R1 = invariant central de l'épic, actuellement non résolu même pour ISF/ICR.**
2. **`SlotSetProposal` est invisible sur l'écran de revue.** `review/page.tsx:141` ne lit que
   `adjustmentService.list` (`AdjustmentProposal`). Une proposition groupée patient n'apparaît **pas** dans
   `/patients/[id]/review` → trou fonctionnel à refermer **avant** que le moteur bascule.
3. **Couplage caché de l'anti-cliquet.** `lastAcceptedChangeAt`/`deescalationTiming`
   (`proposal-generator.service.ts:104-143`) datent le dernier changement en lisant **`AdjustmentProposal`
   `accepted`**. Si l'accept groupé cesse d'écrire ce registre, **le cooldown anti-empilement (US-2653/2662) et
   la porte post-changement se défont silencieusement** (invisible aux tests unitaires).

## Architecture cible (validée)

- **Modèle : Option A — généraliser `SlotSetProposal`** (recommandé architect ; PAS un nouveau modèle) :
  `parameterType` est déjà `AdjustableParameter` ; l'index « 1 pending / (patient × levier) » existe. Migration
  **additive** : `source` (`ProposalSource`, dérivé serveur, ADR #27), `proposedSlots` en **union discriminée par
  levier**, et surtout **`baselineSlots` (snapshot de base PAR créneau à la génération)** — pièce maîtresse du CAS.
  `AdjustmentProposal` **conservé en lecture** (historique) + comme **registre des changements acceptés** (cooldown).
- **Typage hétérogène** (union discriminée `z.discriminatedUnion` par `parameterType`) :
  | Levier | Clé de diff | Slot |
  |---|---|---|
  | ISF / ICR | `startHour` | `{ startHour, endHour, value, baselineValue }` (g/L·U / g/U) |
  | basale pompe | `startTime` | `{ startTime, endTime, rate, baselineRate }` (U/h) |
  | basale stylo | `basalDoseKind` | `{ kind: daily/morning/evening, value, baselineValue }` (**U totales**) |
  | dose fixe | `moment` | `{ moment, value, baselineValue }` (U) |
- **R1 — CAS par créneau dans une transaction verrouillée** : à l'accept, `tryLockInsulinSlots` (existe) sérialise ;
  relecture live ; comparer live vs `baselineSlots` (comparaison JS **tolérante** — pas d'égalité DB exacte sur du
  JSON float). Un créneau **modifié** dont la base a bougé → `baselineMoved` (409, régénérer). Un créneau **non
  modifié** dont la base a bougé → laissé **intact** (la modif médecin concurrente survit — merge). **Dérive de
  STRUCTURE** (créneau ajouté/supprimé/déplacé) → **full-replace + CAS d'ensemble fail-closed**. *S1 livre d'abord
  le CAS d'ensemble fail-closed (le plus simple/sûr) ; le diff-merge valeur-seule est une optimisation S1bis.*
- **Placement gates/flags** : `source`/DKA-ack/cooldown-churn au niveau **proposition** ; `changePercent`/risque/
  `highDoseWarning`/gate-baisse-patient (maturité/mode/cap-delta) au niveau **créneau modifié** (itère sur le
  diff). Hold zone/deadband restent dans le moteur ; `ClinicalReviewFlag` restent des objets **séparés**.
  **Tout-ou-rien** : une violation de gate sur un seul créneau → rejette la disposition entière (jamais d'apply
  partiel).
- **Diff calculé SERVEUR** (`changed` + `currentValue` live par entrée) — iOS/front n'infèrent pas depuis un
  snapshot périmé. Payload versionné (`schemaVersion`), `source` jamais acceptée du body (anti-usurpation).

## Garde-fous cliniques NON NÉGOCIABLES (medical)

1. Snapshot de base **par créneau** stocké à la génération (prérequis S0). 2. **CAS par créneau** à l'accept
(modifié OU porté-inchangé). 3. **Blocage fail-closed sur dérive de structure**. 4. **Re-sourcer l'anti-ratchet**
(`lastAcceptedChangeAt`/cooldown/porte post-changement) sur le groupé, **même slice** que la bascule moteur — test
d'**intégration** exigé. 5. **Fail-loud sous 1-pending** : un signal de sécurité (dé-escalade / hypo sévère) bloqué
par le verrou est **toujours** flaggé ; la disposition prioritaire supersède la pending périmée. 6. **Gating patient
par créneau modifié, tout-ou-rien** ; amplitude sur le **vrai delta** ; DKA/maturité/mode par dose ciblée (stylo).
7. **Flags ouverts surfacés en tête de revue, jamais masqués** ; badges %/risque masqués si base dérivée (parité
stricte avec l'écran par-valeur). 8. Frontière MDR : `nonInsulin` refusé création ET accept ; bornes re-vérifiées
à l'apply ; `pending` obligatoire. **DPIA** : garde-fous `baselineMoved`/anti-ratchet **déplacés, pas supprimés**
(IEC 62304).

## Découpage en slices (réordonné — sûreté & revue AVANT bascule moteur)

- **S0 — Modèle + baseline** : généraliser `SlotSetProposal` (`source`, JSON discriminé par levier, `baselineSlots`
  par créneau), migration additive. *Réversible, aucun consommateur ne change.*
- **S1 — Cœur de sûreté** (referme le constat 1) : CAS par créneau fail-closed + apply groupé **tous leviers**
  (nouveaux `replaceStyloDoseSet`/`replaceFixedDoseSet`) dans une tx verrouillée + **préservation du registre de
  cooldown** (constat 3) + gates par-créneau (tout-ou-rien). **Avant tout basculement moteur.**
- **S2 — Composant de revue unifié** (referme le constat 2) : `DispositionProposalReview` (diff surligné, badges
  par-créneau, flags en tête) branché sur `/patients/[id]/review`, lisant `SlotSetProposal` **+** `AdjustmentProposal`
  pending pendant la transition. **Avant la bascule moteur.**
- **S3 — Moteur émet du groupé** : `proposal-generator` assemble la disposition + `createSetProposal(source=algorithm)`
  au lieu de `createEngineProposal` ; logique de décision **inchangée** (analyseurs/matrices/hold zone/gating
  réutilisés — plomberie, pas clinique). Interne, feature-flaggable, réversible.
- **S4 — Voie manuelle groupée** patient/infirmière/médecin (création pro + provenance) + retrait
  `InsulinProposalDialog`. Première rupture UI.
- **S5 — Retrait voie d'écriture `AdjustmentProposal`** + **contrat iOS** (endpoints par-valeur supprimés/redirigés,
  payloads groupés versionnés, migration des `pending` legacy). **Toutes les ruptures iOS concentrées ici.**
- **Transverse** : tests (dont intégration cooldown), i18n, DPIA, refonte du guide `proposition-insuline.html` +
  catalogue `regles-et-constantes-diabete.md` (CAS par-créneau = règle de sûreté à cataloguer).

## Décisions PRODUIT ouvertes (à trancher aux slices concernées)

- **D1 (avant S5)** — `AdjustmentProposalAck` / `AdjustmentProposalActualization` (US-2065/2066) sont **1:1 sur
  `AdjustmentProposal`**. Sémantique groupée indéfinie (accuser/actualiser *une disposition* ?). Options : porter
  en groupé / conserver par-valeur sur une voie séparée / déprécier. **Ne pas retirer `AdjustmentProposal` sans
  trancher.**
- **D2 (avant S3)** — **Supersession** : une proposition **moteur** groupée supersède-t-elle une **demande patient**
  pending sur le même levier ? Qui gagne, quelle notification patient ?
- **D3 (avant S4)** — **Soumission mixte hausse+baisse** : un seul accusé DKA couvre-t-il toutes les baisses, ou
  refuse-t-on les soumissions mixtes ? (medical + architect).
- **D4 (S1)** — CAS d'ensemble fail-closed d'abord (recommandé) vs diff-merge valeur-seule (moins de friction) —
  arbitrage friction/complexité (livrable en S1bis).

## ADR impactés

#13 réaffirmé · #23 **étendu** (tous leviers + source + origine moteur/humaine) · #26 **réalisé** par le CAS
par-créneau · #27 **dupliqué** sur `SlotSetProposal` · #21 **aligné** (revue unique, N origines) · #29 note
`styloBasalApplyNotSupported` **superseded** (apply groupé stylo en S1). **Nouveaux ADR** : (a) disposition groupée
= unique modèle de proposition, `AdjustmentProposal` retiré en écriture / conservé en lecture+registre ; (b) snapshot
de base par créneau + CAS par créneau = invariant de sûreté de l'acceptation groupée.

*Design validé 2026-07-12 par architect-reviewer + medical-domain-validator + swift-expert. Prochaine étape : GO
utilisateur → formaliser les slices S0… et démarrer S0.*
