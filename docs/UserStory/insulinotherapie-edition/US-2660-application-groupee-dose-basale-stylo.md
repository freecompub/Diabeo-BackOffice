# US-2660 — Application groupée de la dose basale STYLO (MDI) à l'acceptation médecin

> 📌 Sous-US de [US-2645](US-2645-EPIC-insulinotherapie-edition-multimode.md) · **back + iOS** · Taille **M**
> · dépend de : US-2659 (titration basale stylo, discriminateur `basalDoseKind`)
>
> **Statut** : ✅ **LIVRÉ** (ADR #30) — écriture groupée câblée à l'acceptation, `styloBasalApplyNotSupported` supprimé.
> **Priorité** : HAUTE (comblée).

## Contexte

US-2659 a livré la **titration de la basale stylo** (single/split) et la **baisse patient**, mais a
**volontairement différé** l'écriture de la dose à l'acceptation médecin. Aujourd'hui, accepter **avec
application immédiate** une proposition de basale stylo (`AdjustmentProposal.basalDoseKind != null`) lève
**`styloBasalApplyNotSupported`** (fail-closed, `adjustment.service.ts:840`) : le médecin **accepte sans
appliquer** puis ajuste la dose stylo **à la main**. Ce choix évitait un « accepté + appliqué » fantôme sans
écriture (cadrage validé medical/HDS en S1). Cette US comble le trou : câbler l'**écriture réelle** de
`BasalConfiguration.dailyDose` / `morningDose` / `eveningDose` à l'acceptation.

## Périmètre

- **Écriture GROUPÉE** (ADR #23/#26 — cohérence grouped-only, pas de route par-valeur ressuscitée) : à
  l'acceptation-avec-application d'une proposition `basalRate` stylo, écrire la dose ciblée par
  `basalDoseKind` sur `BasalConfiguration`, scopée patient (anti-IDOR, via `settings: { patientId }`).
- **Retirer** le fail-closed `styloBasalApplyNotSupported` (`adjustment.service.ts`, bloc `accept` ~L834-840)
  au profit d'une branche d'écriture stylo, avec les gardes existantes des autres leviers :
  - **compare-and-swap** `baselineMoved` (la base a-t-elle dérivé depuis la proposition ?) ;
  - **`assertRowApplied`** fail-closed (`count === 0` → `…NotFound`, rollback — jamais d'« accepté +
    appliqué » fantôme) ;
  - transaction atomique + audit `PROPOSAL_ACCEPTED` (identité relecteur, sans dose en clair).
- `liveCurrentValue` / `resolveCurrentValue` supportent déjà la lecture stylo (`dailyDose`/`morning`/`evening`,
  US-2659 S1) → réutiliser pour le compare-and-swap.

## Critères d'acceptation

- **AC-1** Accepter-avec-application une proposition basale stylo écrit la dose (`daily`/`morning`/`evening`)
  correspondante sur `BasalConfiguration`, scopée patient ; `status: accepted`, relecteur horodaté.
- **AC-2** Si la dose live a dérivé depuis la proposition → `baselineMoved`, rollback, aucune écriture.
- **AC-3** Si la config a disparu → `…NotFound` fail-closed, rollback.
- **AC-4** `styloBasalApplyNotSupported` n'est plus levé (supprimé) ; test de non-régression sur les 4 autres
  leviers (ISF/ICR/pompe/dose fixe) inchangés.
- **AC-5** Audit sans PHI/posologie ; jamais auto-appliqué sans médecin (ADR #13).

## Contrat iOS → `swift-expert`

La réponse d'acceptation d'une proposition stylo peut désormais indiquer `applied: true` (au lieu d'un refus)
→ l'app peut refléter l'application. Coordination sur le message patient (« votre médecin a appliqué… »).

## Corrections de revue appliquées (medical + HDS + code-reviewer)

- **CAS atomique DB** (HDS MED / code LOW) : la valeur attendue (`proposal.currentValue`) est verrouillée dans
  le `WHERE` de chaque `updateMany` — porté sur les **5 leviers** (ISF/ICR/pompe/dose fixe + stylo). Ferme la
  fenêtre TOCTOU (le check `baselineMoved` lit hors transaction) : une base déplacée dans l'intervalle matche 0
  ligne → `…SlotNotFound` (rollback) au lieu d'écraser un changement concurrent. Subsume le fail-closed « dose
  effacée » (NULL ≠ valeur → `styloBasalNotFound`).
- **Filet `noApplicableApplyTarget`** (code MED) : `else` fail-closed final — `applyImmediately` demandé sans
  cible résoluble (ex. `createManual` sans discriminateur) → throw + rollback (plus de fantôme `applied:true`).
- **Garde `basalTargetAmbiguous`** (medical INFO) : un `basalRate` portant les deux discriminateurs (invariant
  inatteignable sous le CHECK base) → fail-closed avant écriture, filet contre un affaiblissement futur du CHECK.
- **Mapping HTTP** (les 3 agents) : les 5 `…SlotNotFound`/`styloBasalNotFound` → **409** (conflit récupérable,
  plus de 500 muet ni faux positif SOC) ; `basalTargetAmbiguous`/`noApplicableApplyTarget` → **422**.
- **Colonnes stylo `Decimal(5,2)→(6,2)`** (code LOW, migration `20260722100000`) : aligne le stockage sur la
  politique clinique « pas de plafond dur » (medical) ; plus de `numeric overflow` Postgres brut possible.
- **Tests** : CAS/colonne, dose effacée, config absente, `valueOutOfBounds` stylo à l'accept, audit sans dose,
  `noApplicableApplyTarget`, `basalTargetAmbiguous`, mapping route 409/422.

### Durcissements de la 2ᵉ revue (post-correction, montrée avant application)

- **A (MEDIUM)** — couverture du CAS sur les **4 leviers existants** (ISF/ICR/pompe/dose fixe) : assertions que
  le `WHERE` verrouille `<colonne> = currentValue` + test **TOCTOU** (`baselineMoved` OK mais `updateMany`
  count 0 → `isfSlotNotFound`). Ferme le trou « une régression retirant `casValue` passerait au vert ».
- **B (LOW)** — invariant de scale documenté (commentaire) + **verrou de test**
  `tests/unit/cas-decimal-scale-invariant.test.ts` : lit `schema.prisma` et vérifie que toute colonne de dose
  cible a une scale ≤ scale(`currentValue`)=4 (round-trip CAS sans troncature). Casse si une future migration
  élargit une colonne dose au-delà de 4 décimales.
- **C (NIT)** — `basalTargetAmbiguous` déplacé **avant** `validateProposedValue` (plus de routage de bornes « à
  l'aveugle » sur une cible ambiguë).
- **D (INFO)** — assertion d'audit robuste (forme `metadata = { applyImmediately, patientId }` au lieu d'une
  sous-chaîne fragile).

## Sources code

`src/lib/services/adjustment.service.ts` (`accept` — bloc `applyImmediately`, `resolveCurrentValue` stylo,
`liveCurrentValue`), `src/app/api/adjustment-proposals/[id]/accept/route.ts` (mapping erreurs),
`prisma/schema.prisma` + migration `20260722100000` (`BasalConfiguration.dailyDose`/`morningDose`/`eveningDose`
en `Decimal(6,2)`). Revue : `medical-domain-validator` + `healthcare-security-auditor` + `code-reviewer` (faite).
