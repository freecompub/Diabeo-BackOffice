# US-2657 — Cadrage C3b (orchestrateur groupé) & findings différés

Note de cadrage produite lors de la **revue d'epic US-2657** (durcissement, branche `fix/us2657-epic-hardening`).
Elle liste ce qui a été **corrigé** dans le durcissement et ce qui est **volontairement différé** à la slice
**C3b** (`applyExpertGroupGoverned`, orchestrateur groupé) ou à une slice dédiée, avec la justification.

## Corrigé dans le durcissement (branche `fix/us2657-epic-hardening`)

- **P2002 adapter-pg** (`isUniqueViolationOn`) — `adjustment.service`, `emergency.service`, `slot-set-proposal.service`.
- **RGPD Art. 17** — purge de `governanceApproval` / `autoApplyEvent` / `slotSetProposal` dans `deletion.service`.
- **Gouvernance** — `dpiaRef` obligatoire + activation gatée `maturityLevel === EXPERT` ; downgrade remet
  `autoApply = false` ; check `GovernanceApproval` active à l'exécution (triple verrou). ADR #22/#24.
- **Clinique** — C6 lit le **capillaire** (BGM) et exige une donnée récente pour toute **hausse** ; C6b
  **pathology-aware** (grossesse/DG) ; frontière MDR `nonInsulin` sur la branche AUTO_APPLY ; unité ISF
  fail-closed (g/L) ; re-validation des bornes ISF/ICR au service ; short-circuit no-op.
- **Atomicité / concurrence** — branche AUTO_APPLY en **transaction unique** (event + apply + audit) avec
  **advisory-lock** par `(patient × paramètre × créneau)` et **re-évaluation sous lock** (ferme le TOCTOU C7).
- **Audit** — actions dédiées (`AUTO_APPLIED_SETTING`, `AUTO_APPLY_FALLBACK`, `AUTO_APPLY_REJECTED`,
  `AUTO_APPLY_FLAG_CHANGED`, `MATURITY_LEVEL_CHANGED`, `MATURITY_LEVEL_SELF_ELEVATION_DENIED`).
- **Prisma** — index anti-cliquet couvrant `slot_key` ; `timestamptz` sur `applied_at` / `created_at`.

## Différé à C3b (orchestrateur groupé `applyExpertGroupGoverned`)

1. **Sémantique GROUPE atomique (tout-ou-rien).** Le harnais actuel est **par-créneau** ; C3b ne doit PAS le
   boucler naïvement — un groupe mixte (certains créneaux dans l'enveloppe, d'autres hors / structurels)
   produirait une **application partielle**, interdite par la spec (§4). C3b doit **agréger les décisions**
   d'enveloppe des K créneaux et décider **au niveau groupe** : si une seule décision ≠ AUTO_APPLY (ou tout
   `STRUCTURAL`), le **groupe entier** part en `SlotSetProposal`. Implique de **décomposer** le harnais
   (« décider par créneau » séparé de « appliquer/persister »).
2. **Fallback groupé.** Le fallback du harnais crée aujourd'hui une `AdjustmentProposal` **par-valeur** ;
   C3b doit le router vers une **`SlotSetProposal`** groupée (cohérent avec « plus de par-valeur », ADR #23).
3. **Contrat d'agrégation d'enveloppe.** Définir explicitement comment `HARD_REJECT` / `FALLBACK` / `AUTO_APPLY`
   des K créneaux s'agrègent (priorité au rejet dur ; tout-ou-rien) — condition de stabilité des routes C3c/C3d.
4. **Cap cumulé multi-créneaux / jour / patient (anti-cliquet inter-leviers).** L'anti-cliquet C7 est
   par-créneau ; un groupe peut cumuler ~10 % sur plusieurs créneaux en une session. C3b doit plafonner le
   cumul **inter-créneaux** (nouvelle constante clinique à cataloguer dans `docs/clinical-logic/`).
5. **Fan-out du contexte O(K).** `buildEnvelopeContext` relit la fenêtre glycémie/cétone **par créneau** ;
   pour un appel groupé, extraire la lecture patient-level **une fois** (seul l'anti-cliquet varie par créneau).
6. **`changeKind` dérivé serveur.** Pour un groupe, C3b dérive `VALUE`/`STRUCTURAL` de la comparaison
   avant/après persistée (jamais du body). Le harnais par-créneau ne gère que `VALUE`.

## Différé — dette mineure (slice dédiée)

- **FK `User`** sur `GovernanceApproval.approvedById`, `SlotSetProposal.proposedByUserId/reviewedByUserId`
  (relations `onDelete: SetNull`, comme `AdjustmentProposal.proposer/reviewer`). Non fait ici pour ne pas
  toucher le modèle central `User` dans une branche de durcissement ; l'effacement RGPD est déjà couvert par
  la purge explicite. À traiter en migration additive dédiée.
- **Rate-limiting** sur `PATCH /api/governance/auto-apply` et `PATCH /api/patients/maturity` (défense en
  profondeur ANSSI ; routes déjà authentifiées + anti-IDOR).

## Alignement iOS (avant C3c/C3d)

`SlotSetProposal.proposedSlots` (JSON `[{startHour,endHour,value,mealLabel}]`) **diverge structurellement**
d'`AdjustmentProposal` (colonnes plates). Quand C3c/C3d exposeront les propositions au patient/médecin, l'app
iOS devra gérer **deux formes**. Cadrer avec `swift-expert` **avant** de figer le contrat des routes.
`MaturityLevel` / `autoApply` restent **serveur-autoritaires** (lecture seule côté iOS).
