# US-2660 — Application groupée de la dose basale STYLO (MDI) à l'acceptation médecin

> 📌 Sous-US de [US-2645](US-2645-EPIC-insulinotherapie-edition-multimode.md) · **back + iOS** · Taille **M**
> · dépend de : US-2659 (titration basale stylo, discriminateur `basalDoseKind`)
>
> **Statut** : 🟡 spécifiée — **follow-up US-2659** (le principal manque fonctionnel restant).
> **Priorité** : HAUTE (les propositions de basale stylo ne sont aujourd'hui pas applicables automatiquement).

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

## Sources code

`src/lib/services/adjustment.service.ts` (`accept` — bloc `applyImmediately` L834+, `resolveCurrentValue`
stylo L173-197, `liveCurrentValue`), `prisma/schema.prisma` (`BasalConfiguration.dailyDose`/`morningDose`/
`eveningDose`). Revue attendue : `medical-domain-validator` + `healthcare-security-auditor` + `code-reviewer`.
