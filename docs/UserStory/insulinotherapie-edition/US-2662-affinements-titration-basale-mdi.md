# US-2662 — Affinements titration basale MDI (câblage garde-fou, PK dégludec, refacto DRY)

> 📌 Sous-US de [US-2645](US-2645-EPIC-insulinotherapie-edition-multimode.md) · **back** · Taille **S** (groupée)
> · dépend de : US-2659 (titration basale stylo single/split)
>
> **Statut** : 🟡 spécifiée — **follow-up US-2659** (dette technique + affinement clinique V2).
> **Priorité** : BASSE (aucune régression ; améliorations non bloquantes).

## Contexte

US-2659 a livré la titration basale MDI. Trois affinements identifiés en revue (medical + code-reviewer),
tous **non bloquants**, sont regroupés ici pour éviter des micro-PR.

## Périmètre (3 items groupés)

1. **`MDI_BASAL_WARN_U` (80 U) non câblée** — la constante d'AVERTISSEMENT (dose basale stylo quotidienne
   élevée, parallèle de `FIXED_BASAL_WARN_U`) existe dans `clinical-bounds.ts` mais n'émet aucun warning à la
   génération/validation. Câbler un `warning` non bloquant (comme les seuils bolus/basale fixe) quand la dose
   proposée dépasse le seuil → visibilité médecin, jamais un blocage.

2. **Cooldown dégludec 96 h (V2)** — le cooldown MDI actuel (`MDI_BASAL_COOLDOWN_HOURS = 72 h`) couvre le
   steady-state glargine/detemir (3–4 j). La **dégludec** a un t½ ≈ 25 h → steady-state ≈ 96–120 h ; un
   cooldown de 72 h peut titrer une dégludec avant sa stabilisation (réf. Heise 2012, PK dégludec). Nécessite
   un **discriminateur de molécule basale** (glargine/detemir/dégludec) sur la config insuline — d'où V2
   (dépendance modèle). Tant qu'absent : garder 72 h (conservateur documenté).

3. **Refacto DRY générateur** — les blocs `single_injection` et `split_injection` de
   `proposal-generator.service.ts` partagent déjà `decideMdiDose` (fonction pure), mais l'assemblage du
   contexte (fenêtre 7 j, extraction FPG/pré-dîner, garde Somogyi) reste dupliqué. Factoriser un
   helper commun d'assemblage sans changer le comportement (couvert par les tests existants single/split).

## Critères d'acceptation

- **AC-1** Une dose basale stylo proposée > `MDI_BASAL_WARN_U` produit un `warning` non bloquant (proposition
  créée quand même) ; test unitaire.
- **AC-2** (V2, si molécule disponible) cooldown = 96 h pour dégludec, 72 h sinon ; à défaut, documenter le
  choix conservateur 72 h dans `regles-et-constantes-diabete.md`.
- **AC-3** Refacto générateur : zéro changement de comportement (tests single/split verts inchangés),
  duplication d'assemblage supprimée.
- **AC-4** Toute constante/seuil touché reflété dans `docs/clinical-logic/regles-et-constantes-diabete.md`
  (même PR).

## Sources code

`src/lib/clinical-bounds.ts` (`MDI_BASAL_WARN_U`, `MDI_BASAL_COOLDOWN_HOURS`),
`src/lib/services/proposal-generator.service.ts` (`decideMdiDose`, blocs single/split),
`src/lib/proposal-algorithm.ts` (`analyzeMdiBasalDailyTrend`). Revue : `medical-domain-validator` (PK
dégludec) + `code-reviewer` (refacto).
