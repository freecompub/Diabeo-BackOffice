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

- **S0 — Modèle + baseline** ✅ **LIVRÉ** (PR #735) : `SlotSetProposal` généralisé — colonnes `source`
  (`ProposalSource`) + `baseline_slots` (JSONB nullable) ; migration additive
  `20260725100000_us2663_s0_grouped_proposal_baseline` (idempotente, drift-gate vert). Typage cible = union
  discriminée par levier (`src/lib/insulin/grouped-proposal.ts`, 4 leviers + zod, testé). `createSetProposal`
  capture le snapshot de base ISF/ICR à la génération (`captureBaselineSlots`) et persiste la provenance.
  **Revues expertes** (medical GO, prisma sûr/additif, architect socle sain) — corrections appliquées :
  (a) provenance **bundlée `proposer: { userId, source }`, `source` REQUIS** (anti-usurpation ADR #27 : userId
  et source solidaires, plus de défaut silencieux) ; (b) `isfIcrSlotSchema` du module **câblé** dans le service
  (supprime la triple copie de forme) ; (c) `baselineSlots` **non exposé** sur `GET /api/slot-set-proposals`
  (`omit`, minimisation — snapshot interne au CAS de S1). **Notes reportées à S1/S3** : appariement CAS par clé
  `startHour` (pas par position) ; chemins distincts `[]` (base vide) vs `null` (legacy) au CAS ; `z.union`
  pompe/stylo → clé `modality` explicite en S3. **Coordination `swift-expert`** : `GET /api/slot-set-proposals`
  renvoie désormais le champ additif `source` (`baselineSlots` volontairement absent) — additif, iOS ignore les
  champs inconnus. *Réversible, aucun lecteur fonctionnel ne change ; seuls ISF/ICR émettent (moteur en S3).*
- **S1 — Cœur de sûreté** (referme le constat 1) ✅ **LIVRÉ (partiel — CAS d'ensemble ISF/ICR)** : CAS
  **d'ensemble** fail-closed (`assertBaselineUnchanged`, `slot-baseline-cas.ts`) branché dans `replaceSlotSet`
  via `expectedBaseline`, exécuté **sous le verrou** `tryLockInsulinSlots` (lecture LIVE atomique, pas de
  TOCTOU) : à l'acceptation, la base actuelle doit égaler `baselineSlots`, sinon **`baselineMoved`** (409,
  rollback → `pending`) ; snapshot `null` legacy → **`baselineMissing`** (409, fail-closed). Appariement par clé
  `startHour`, `mealLabel` non dosant ignoré. Chemin DOCTOR direct inchangé (pas de CAS). Tests : CAS pur
  (11 cas) + bout-en-bout `replaceSlotSet` (4) + wiring `acceptSetProposal`. **Reste en S1bis/S3** : diff-merge
  valeur-seule (D4, optimisation) ; apply groupé **stylo/dose-fixe** (`replaceStyloDoseSet`/`replaceFixedDoseSet`)
  et **re-source de l'anti-cliquet** (constat 3) — couplés à la bascule moteur, donc **traités en S3** (garde-fou
  #4 : « même slice que la bascule moteur »). Aujourd'hui `SlotSetProposal` ne porte que ISF/ICR (patient), donc
  le CAS ISF/ICR couvre la totalité de la surface groupée existante. **Décision produit à confirmer** : impact
  des propositions legacy `pending` (baseline `null`) désormais rejetées `baselineMissing` (re-soumission requise).
  **Revues** (medical GO, architect socle sain, code-reviewer mergeable) — durcissements appliqués : contrat CAS
  **enveloppé** `cas?: { baseline }` (le fail-open n'est plus atteignable par un `null` mal coalescé), garde
  **`Number.isFinite`** (NaN → `baselineMoved`, pas « inchangé »), **test de route** `baselineMoved`/`baselineMissing`
  → 409, **test CAS ICR** (branche `carbRatio`), **JSDoc `@throws` complète**, **lecture LIVE+`before` factorisée**
  en une requête (`live == before` garanti, plus de double lecture), **`notifyPatient` rendu totalement
  non-throwing** (best-effort post-commit : un aléa DB ne fait plus échouer un accept déjà appliqué). Reportés :
  surface d'erreur typée pour les codes fail-closed (épic), invariant S1→S3 « aucun chemin groupé n'avance
  l'anti-cliquet avant la re-source S3 » (garde-fou #4). |
- **S2 — Composant de revue** (referme le constat 2) ✅ **LIVRÉ** : `GroupedProposalReview`
  (`src/components/diabeo/patient/GroupedProposalReview.tsx`) — diff surligné (créneau proposé vs valeur LIVE,
  `src/lib/insulin/slot-diff.ts`), badge de provenance, bandeau d'avertissement non bloquant si la base a dérivé
  depuis la génération (`isBaselineUnchanged`, variante non-throwing du CAS S1) — branché sur
  `/patients/[id]/review` (`DecisionsStep`), sous un sous-titre dédié, **AU-DESSUS** de `ProposalList`
  (`AdjustmentProposal` pending, inchangé). `slotSetProposalService.listPendingForReview` (nouveau) expose
  `baselineSlots` pour cet écran DOCTOR-gated (contrairement à `listSetProposals`, qui l'omet côté liste patient).
  **Écart assumé vs le cadrage initial** (composant `DispositionProposalReview` unique fusionnant les deux
  sources) : livré comme **deux composants distincts coexistants** (`GroupedProposalReview` + `ProposalList`)
  plutôt qu'un composant fusionné — plus simple à livrer sans toucher `ProposalList` (US-2664, contrat stable),
  fusion différée à une slice ultérieure si le besoin produit se confirme. Décision serveur : le blocage réel
  reste le 409 `baselineMoved`/`baselineMissing` à l'acceptation (S1) ; l'affichage ne fait que PRÉVENIR.
  **Revues** (medical GO, a11y WCAG AA, code-reviewer mergeable) — corrections appliquées : Accepter **désactivé**
  sous `baselineDrifted` (parité `ProposalList`) ; `aria-label` distinctifs sur les boutons (WCAG 2.4.6) ; icône
  de ligne en `text-warning-fg` (contraste 1.4.11) ; **créneaux supprimés rendus explicitement** (ligne « → supprimé »,
  `SlotDiffRow.removed`) + marqueur sr-only (nouveau/modifié/supprimé) non basé sur la couleur (1.4.1) ; JSDoc
  « clinician-read / doctor-decision » corrigé (le READ inclut NURSE) ; `console.warn` sur proposé illisible skippé.
  **Décision produit ouverte** (medical 5b) : une proposition groupée ET une par-valeur peuvent coexister sur le
  même paramètre (2 index) — fail-safe via CAS, mais à trancher avant S3 (indice « même paramètre » / exclusion mutuelle).
- **S3 — Moteur émet du groupé** : `proposal-generator` assemble la disposition + `createSetProposal(source=algorithm)`
  au lieu de `createEngineProposal` ; logique de décision **inchangée** (analyseurs/matrices/hold zone/gating
  réutilisés — plomberie, pas clinique). Interne, feature-flaggable, réversible.
  - **S3a — Re-source de l'anti-cliquet** (referme le constat 3, garde-fou #4) ✅ **LIVRÉ** (#739) : les
    acceptations GROUPÉES alimentent désormais `lastAcceptedChangeAt`/`deescalationTiming` au même titre que
    l'acceptation par-valeur — le cooldown anti-empilement (US-2653/2662) ne se défait plus silencieusement
    quand une `SlotSetProposal` est acceptée.
  - **S3b-0a — Fondation bascule (D2 + rationale MOTEUR)** ✅ **LIVRÉ** (#740) : supersession groupée
    raffinée **par CLASSE D'ORIGINE** (D2 — humain supersède humain, algo supersède algo ; moteur et humain
    **coexistent** sur le même paramètre, cf. catalogue §6). Colonne `SlotSetProposal.rationale` (JSONB,
    `SlotRationale[]`) **requise** si `source: "algorithm"` — decision-support + traçabilité HDS. Affichage
    différé à S3b-0b.
  - **S3b-0b — RATIONALE + indice de COEXISTENCE en revue médecin** ✅ **LIVRÉ** : `GroupedProposalReview`
    affiche, sur chaque créneau CHANGÉ non supprimé d'un item `source: algorithm`, le motif (`reason` i18n,
    exhaustif sur `AdjustmentReason`), la confiance et le volume d'observations — **côte à côte** avec la
    direction de risque (`deriveRiskDirection`, toute provenance). Une proposition HUMAINE n'a jamais de
    rationale. Bandeau `role="status"` si une coexistence D2 existe (`deriveCoexistsWith`,
    `src/lib/insulin/proposal-coexistence.ts`, pur, calculé serveur dans `page.tsx`). `listPendingForReview`
    expose `rationale` (déjà DOCTOR/NURSE-gated comme `baselineSlots`). Catalogue §6 mis à jour.
  - **S3b-1 — Moteur émet réellement du groupé ISF/ICR** ✅ **LIVRÉ** : derrière le flag env
    `ENGINE_GROUPED_ISF_ICR` (**OFF par défaut, réversible**, un seul flag ISF **et** ICR — R6), le générateur
    (`proposal-generator.service.ts`, `emitGroupedIsfIcr`) **collecte** les candidats ISF/ICR au lieu de les
    persister par-valeur, **assemble la disposition ENTIÈRE** depuis une relecture LIVE de la config (base de
    l'overlay), et émet **une** `SlotSetProposal` `source: "algorithm"` par levier. Garde-fous : **R2** CAS par
    créneau changé (`|candidate.currentValue − live| ≤ 1e-9`, sinon créneau abandonné → jamais une magnitude
    périmée ; réplique `baselineMovedAtPersist`, perdu au regroupement) ; **R4** no-op (aucune émission si 0
    créneau ne change) ; **R5** `mealLabel` ICR préservé ; **R3** rationale MOTEUR par créneau changé (requise
    par `createSetProposal`). Décisions cliniques **INCHANGÉES** (seule la voie d'écriture change). Rejets
    `createSetProposal` fail-closed **non fatals**. Tests dédiés `tests/unit/proposal-generator-grouped.service.test.ts`
    (flag ON/OFF, R2/R4/R5, rationale, ICR+ISF simultanés). Catalogue §6 mis à jour. **Pas de rupture de
    contrat** (flag OFF en prod ⇒ voie par-valeur inchangée ; la coordination iOS reste concentrée en S5).
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
