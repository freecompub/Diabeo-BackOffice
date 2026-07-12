# US-2662 — Affinements titration basale MDI (câblage garde-fou, PK dégludec, refacto DRY)

> 📌 Sous-US de [US-2645](US-2645-EPIC-insulinotherapie-edition-multimode.md) · **back** · Taille **S** (groupée)
> · dépend de : US-2659 (titration basale stylo single/split)
>
> **Statut** : ✅ **LIVRÉ** — item 1 (WARN câblé) + item 2 (cooldown molécule, design validé medical) ;
> item 3 : DRY du cooldown fait, refacto plus profonde **délibérément différée** (voir ci-dessous).
> **Priorité** : BASSE (aucune régression ; améliorations non bloquantes).

## Livré

- **Item 1 — `MDI_BASAL_WARN_U` câblé (avertissement non bloquant)** : une proposition de basale STYLO dont
  `proposedValue > 80 U` surface un badge « Dose basale élevée — à confirmer » à l'écran de revue médecin,
  **dérivé SERVEUR** (`page.tsx`, bornes cliniques jamais côté client), i18n FR/EN/AR. **Non bloquant** :
  l'acceptation reste possible (la basale stylo n'a pas de plafond dur, décision US-2659).
- **Item 2 — Cooldown de titration sensible à la MOLÉCULE** (design **validé medical avant code**, avec une
  réorientation ferme du fail-closed) : `resolveMdiCooldownHours` lit la durée d'action de la basale
  (`InsulinTherapySettings.basalInsulinId → PatientInsulin → InsulinCatalog.typicalDurationHours`) et applique
  aux **3 cibles** (daily/evening/morning) : `≥ 30 h` (dégludec ~42, U300 ~36) ⇒ **96 h** ; sinon **72 h**
  (U100 24, detemir 20). Discriminateur **durée-based** (medical rejette `peak IS NULL` et `genericName`).
  **Fail-closed molécule inconnue ⇒ 96 h** (le plus protecteur — réorientation medical vs 72 h initial :
  l'empilement = harm de commission non surfacé prime sur le retard = harm d'omission surfacé). Nouvelles
  constantes `MDI_BASAL_COOLDOWN_HOURS_ULTRALONG`, `ULTRALONG_BASAL_DURATION_MIN_H` (verrou anti-drift).
- **Item 3 — DRY** : le cooldown (auparavant `MDI_BASAL_COOLDOWN_HOURS` **triplé** en dur sur les 3 chemins) est
  factorisé dans `resolveMdiCooldownHours`. La refacto plus profonde (wrappers `persistMdi`/`persistSplit`,
  assemblage du signal à jeun) est **délibérément différée** : réécrire du code de titration **critique-sécurité**
  pour un gain purement interne, sur un ticket BASSE priorité, n'est pas un arbitrage risque/valeur favorable.

**Suivi tracé (hors périmètre)** : reset de titration après changement de molécule basale (le « dernier accepté »
peut précéder le switch) — signalé par medical, à ouvrir en US dédiée si le besoin se confirme.

**Vérifs** : `resolveMdiCooldownHours` testé (seuil inclusif 30 h, fail-closed null/undefined/NaN, Decimal Prisma) ;
badge WARN testé (affiché + non bloquant / absent) ; verrou anti-drift `clinical-bounds.test.ts` étendu ;
i18n-parity 3 langues. Suite complète verte, `tsc`/lint clean.

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
