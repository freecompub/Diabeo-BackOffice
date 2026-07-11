# US-2657 — Cadrage C3b (orchestrateur groupé) & findings différés

> ⚠️ **Mise à jour 2026-07-10 : AUTO-APPLICATION RETIRÉE**
> 
> Ce cadrage a été produit lors de la revue d'epic **avant la décision de retrait de l'auto-application experte gouvernée (2026-07-10)**. La totalité du périmètre d'orchestration (`applyExpertGroupGoverned`, enveloppe C1–C8, gouvernance, `AutoApplyEvent`, audit actions `AUTO_APPLY_*`) a été **supprimée du code**. 
>
> Ce document est **archivé** à titre de référence historique — les findings et durcissements y décrits ne s'appliquent plus.

---

**[DOCUMENT ARCHIVÉ — Spécification historique de l'orchestrateur auto-apply retirée]**

Note de cadrage produite lors de la **revue d'epic US-2657** (durcissement, branche `fix/us2657-epic-hardening`).
Elle liste ce qui avait été **corrigé** dans le durcissement et ce qui était **volontairement différé** à la slice
**C3b** — cette slice n'a jamais été livrée, l'auto-application ayant été retirée avant.

## Corrigé dans le durcissement (branche `fix/us2657-epic-hardening`)

- **P2002 adapter-pg** (`isUniqueViolationOn`) — `adjustment.service`, `emergency.service`, `slot-set-proposal.service`.
- **RGPD Art. 17** — purge de `governanceApproval` / `autoApplyEvent` / `slotSetProposal` dans `deletion.service`.
- **Gouvernance** — `dpiaRef` obligatoire + activation gatée `maturityLevel === CONFIRME` ; downgrade remet
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
   par-créneau ; un groupe peut cumuler ~10 % sur plusieurs créneaux en une session.
   **✅ DÉCISION (livrée en C3b, PR #707) : cap par NOMBRE** — `AUTO_APPLY_MAX_GROUP_SLOTS = 2` (borne le
   périmètre/attribuabilité, validé `medical-domain-validator`). La **garde d'ampleur cumulée**
   (`AUTO_APPLY_MAX_GROUP_CUMULATIVE_PERCENT`) est **volontairement NON implémentée** : l'angle mort
   co-directionnel (2 créneaux même sens ≈ +11 % *par créneau/repas*, jusqu'à ~2× le plafond C7 hebdo au
   niveau profil) est **assumé comme risque résiduel instruit en DPIA §4** + catalogue clinique. À
   reconsidérer avant activation production.
5. **Fan-out du contexte O(K).** `buildEnvelopeContext` relit la fenêtre glycémie/cétone **par créneau** ;
   pour un appel groupé, extraire la lecture patient-level **une fois** (seul l'anti-cliquet varie par créneau).
6. **`changeKind` dérivé serveur.** Pour un groupe, C3b dérive `VALUE`/`STRUCTURAL` de la comparaison
   avant/après persistée (jamais du body). Le harnais par-créneau ne gère que `VALUE`.

## Durcissement post-merge #710 — handler groupé mutualisé (LOW HDS résolu)

- **Handler basal factorisé** : la route `PUT` basale ne duplique plus l'enveloppe HTTP
  (auth DOCTOR / consentement / anti-IDOR / mapping erreurs) — `handleSlotSetReplace` est désormais **générique**
  (paramètre `apply` branchant `replaceSlotSet` ISF/ICR **ou** `replacePumpSlotSet` basal). Les 3 routes de
  remplacement groupé partagent le MÊME cœur → plus de risque de dérive entre voies (finding LOW HDS #710).
- **Test de parité** `tests/integration/api-slot-set-replace-parity.test.ts` : verrouille route par route
  (ISF/ICR/basal) les garanties partagées — DOCTOR-only (403), consentement (403), anti-IDOR (404), mapping
  métier (`slotsBusy`→409), inattendu→500, Zod→400. Casse si une route diverge.

## Corrections review multi-agents #710 (grouped-only)

- **no-gap STRICT basal** : **ENDORSÉ** par `medical-domain-validator` (une pompe délivre en continu ; un trou = risque hyper/DKA — *plus* justifié que pour ISF/ICR).
- **Garde `configType === "pump"`** ajoutée dans `replacePumpSlotSet` (MEDIUM) : refus `basalConfigNotPump` pour un patient MDI (évite d'attacher des créneaux pompe à une config non-pompe → intégrité du mode).
- **Dead code retiré** (mandat dead-code) : méthodes service `createIsf`/`deleteIsf`/`createIcr`/`deleteIcr`/`createPumpSlot`/`deletePumpSlot` (orphelines après retrait des routes) + module `time-slot-utils.ts` (`hasTimeSlotOverlap`/`hoursOverlap`/`expandHours`, transitivement mort) + leurs tests (`iob-overlap.test.ts` et blocs dédiés). Conservés : `updateIsf`/`updateIcr`/`updatePumpSlot` (chemin gouverné `auto-apply`).
- **Page `/insulin-therapy` réparée** (MAJOR) : encodage horaire corrigé (`endHour ∈ [0,23]`, créneau enjambant minuit autorisé — minuit = `endHour 0`) + gating de couverture 24 h no-gap/no-overlap AVANT tout appel réseau (message clair, pas de save partiel).
- **NITs** : `invalidSlotSet`/`basalConfigNotPump` mappés côté client ; commentaire d'invariant `SlotSetProposal` basal (ni créable ni applicable → fenêtre close des deux côtés).

## ✅ RÉSOLU (slice « grouped-only », ADR #26) — retrait des routes d'écriture par-créneau

Finding **#2** de la revue C3d (PR #709, `medical-domain-validator` MEDIUM, borderline HIGH) + clarification
produit (« que du groupé, quel que soit le rôle », ADR #23). **Livré** : les écritures par-créneau (`POST`/`PATCH`
sur `sensitivity-factors` & `carb-ratios` ; `POST`/`PATCH`/`DELETE` sur `pump-slots`) sont **retirées** ; l'unique
voie d'écriture ISF/ICR/basal est le remplacement **GROUPÉ** (`PUT` → `replaceSlotSet` / **nouveau**
`replacePumpSlotSet` pour le basal). Comme la voie groupée **supersède** les propositions `pending`, la fenêtre
de « dérive de base » est fermée à la source. Périmètre retenu : **ISF/ICR + basal** ; « suppression dure »
(404 sur les verbes retirés) — coordination iOS via `swift-expert` (rupture de contrat, cf. routes-summary).
Historique de la décision ci-dessous.

**Problème.** Une `SlotSetProposal` pending stocke un **cliché figé du jeu complet**. Aujourd'hui, seule une
édition **plein-jeu** (`replaceSlotSet`) supersède les propositions pending. Or les **routes d'écriture
par-créneau DOCTOR existent toujours** et ne supersèdent PAS :

| Route par-créneau (DOCTOR) | Service |
|---|---|
| `PATCH`/`POST /api/insulin-therapy/sensitivity-factors` | `updateIsf` / `createIsf` |
| `PATCH`/`POST /api/insulin-therapy/carb-ratios` | `updateIcr` / `createIcr` |
| `PATCH`/`POST`/`DELETE /api/insulin-therapy/basal-config/pump-slots` | `updatePumpSlot` / `createPumpSlot` / `deletePumpSlot` |

**Scénario patient (dérive de base).** Patient propose P (ISF↑ ⇒ +insuline). Médecin, suite à une **hypo
sévère**, baisse *un* créneau ISF via la route par-créneau (P reste pending, non supersédée). Médecin accepte
P plus tard → P écrase tout le jeu → **ré-introduit l'insuline coupée pour l'hypo**. La re-validation passe
(P est intrinsèquement in-bounds + sans trou). Mitigation actuelle = **UI seulement** (`/patients/[id]/review`
montre l'écart), non enforce à l'API.

**Décision (choix produit).** Traiter dans une **slice dédiée après C3d** : retirer/neutraliser les **routes**
d'écriture par-créneau pour ne laisser que le `PUT` groupé (`replaceSlotSet`, qui supersède déjà) comme unique
voie d'écriture DOCTOR — ferme la fenêtre **à la source**. ⚠️ Ne PAS supprimer les **méthodes service**
`updateIsf`/`updateIcr`/`updatePumpSlot` : encore appelées par `auto-apply.service` (chemin gouverné unitaire) ;
c'est la **surface HTTP** par-créneau qui diverge de la décision groupé-only. Alternative envisagée (rejetée
ici) : token de base attendue (`baselineMoved`) à l'acceptation — plus robuste mais migration + friction, gain
marginal vs le retrait des routes.

**Non retenu dans C3d** (`#4`/`#5` de la revue — dette héritée transverse, à traiter uniformément avec les
routes sœurs `adjustment-proposals`, pas de divergence unilatérale) :
- **#4 Oracle 403-vs-404** sur accept/reject (distingue « existe hors périmètre » de « absente »). Mitigé par
  ids opaques non énumérables. Identique aux routes sœurs.
- **#5 `requireGdprConsent` vérifie le consentement de l'appelant, pas du sujet** (liste) — `TODO V1.5`
  déjà documenté dans `gdpr.ts`. Pour un acte de soin (Art. 9.2.h) l'absence sur accept/reject n'est pas un gap.

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
