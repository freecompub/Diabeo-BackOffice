# US-2661 — Flag de revue dédié « pré-dîner » (basale stylo matin) + lien flag ↔ proposition à la revue

> 📌 Sous-US de [US-2645](US-2645-EPIC-insulinotherapie-edition-multimode.md) · **back + i18n + front** · Taille **S**
> · dépend de : US-2659 (titration split + surfaçage flags à la revue)
>
> **Statut** : ✅ **LIVRÉ** (flag dédié `daytimeHypoHighPreDinner` — design validé medical avant code).
> **Priorité** : MOYENNE (aucun risque patient — lisibilité + exactitude physiologique du trail de revue).

## Livré

- **Flag dédié `daytimeHypoHighPreDinner`** (enum `ClinicalReviewFlagType`, migration `20260723100000`,
  `ALTER TYPE … ADD VALUE`). La dose du **matin** du split (titrée sur la glycémie **pré-dîner**, garde nadirs
  de JOUR) lève ce flag DIURNE ; la dose du **soir** + `single_injection` + pompe gardent
  `nocturnalHypoHighFasting`. Réutiliser le flag nocturne pour la dose du matin **affirmait une fenêtre
  physiologique fausse** (medical) — le découplage est un **correctif** d'exactitude, pas seulement de libellé.
- **Libellé i18n NON affirmatif** (FR « Basale du matin à revoir (glycémie pré-dîner) », EN/AR) dans les
  **3 langues** — jamais « hypoglycémie » car un cas (confondeur bolus-midi, IOB) ne garantit aucune hypo
  (contrainte ferme medical, règle CLAUDE.md « ne jamais affirmer un fait non garanti »).
- **Générateur** : `raiseSplitFlag(kind)` sélectionne le flag par cible (matin/soir).
- **Front** : `Record<ClinicalReviewFlagType,…>` exhaustif (`ReviewFlagsCard`) + rendu générique
  `flagLabelKey` (`ReviewClient`) — le nouveau flag s'affiche à la revue et au dashboard sans code supplémentaire.
- **Doc catalogue** (`regles-et-constantes-diabete.md`) + commentaire enum mis à jour.
- **Tests** : matin→`daytimeHypoHighPreDinner` (confondeur + perdante dé-escalade), verrou de découplage
  soir→`nocturnalHypoHighFasting`, i18n-parity (3 langues).

**Lien flag ↔ proposition (AC-4, optionnel)** : la surface existante `listOpen` (US-2659 S3) affiche déjà les
flags ouverts à l'écran de revue de la baisse ⇒ MVP satisfait. Enrichissement fin non nécessaire.

## Contexte

En US-2659 S2, la dose du **matin** (split_injection) se titre sur la glycémie **pré-dîner** (signal
diurne), mais le générateur réutilise le flag `nocturnalHypoHighFasting` pour l'orientation — libellé
**« hypoglycémie nocturne »** impropre pour un signal pré-dîner/diurne (relevé par medical + HDS + code en
revue S2/S3, étiqueté LOW non bloquant). Par ailleurs, l'écran de revue **surface** les flags ouverts (US-2659
S3) mais ne **relie pas explicitement** un flag à la proposition de baisse qu'il devrait contextualiser.

## Périmètre

1. **Flag dédié** — nouveau `ClinicalReviewFlagType` (ex. `preDinnerHypoHighDaytime` ou
   `morningBasalReview`) + libellés **i18n FR/EN/AR** (namespace `reviewFlags.flag*`, comme les 9 flags
   existants). Migration enum (additive, non destructive). Le générateur split lève ce flag pour la **dose du
   matin** (au lieu de `nocturnalHypoHighFasting`) ; le soir/single garde `nocturnalHypoHighFasting`.
2. **Lien flag ↔ proposition (optionnel, si valeur)** — à la revue d'une **baisse basale**, rattacher au
   contexte le(s) flag(s) ouvert(s) pertinent(s) (Somogyi/pré-dîner) pour que le médecin voie explicitement
   « cette baisse concerne une dose sous flag ». MVP acceptable : la surface existante des flags ouverts
   (US-2659 S3) suffit ; l'enrichissement fin est le cœur de cette US.

## Critères d'acceptation

- **AC-1** La dose du **matin** (split) lève le nouveau flag dédié ; le **soir**/single garde
  `nocturnalHypoHighFasting`. Libellés présents FR/EN/AR (verrou `no-literal-string`).
- **AC-2** Migration enum additive ; drift-gate vert ; seed inchangé.
- **AC-3** Non-régression : les autres flags (ICR/ISF/dose fixe/pompe) inchangés.
- **AC-4** (si lien livré) L'écran de revue affiche le flag rattaché à la proposition de baisse concernée.

## Sources code

`src/lib/services/proposal-generator.service.ts` (bloc split, `raiseSplitFlag`), `src/lib/services/
clinical-review-flag.service.ts` (`listOpen`), `prisma/schema.prisma` (enum `ClinicalReviewFlagType`),
`messages/{fr,en,ar}.json` (namespace `reviewFlags`), `src/app/(dashboard)/patients/[id]/review/ReviewClient.tsx`.
Revue : `medical-domain-validator` (sémantique clinique du flag) + `code-reviewer` + `accessibility-tester`.
