# US-2277 — fixtures QA — Analytics / reporting (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/07-analytics.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2277` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/07-analytics.md` |

---


## 📋 Contexte — états manquants au seed actuel
- CGM sur **plusieurs patients** (DT1/DT2/GD), pas un seul
- 1 patient avec **données insuffisantes** (< 7j → état « insufficientData »)
- période de **comparaison** (2 fenêtres) pour le compare
- cohorte population (tableau de bord population US-2094)

## ✅ Critères d'acceptation

```gherkin
Feature: QA 07-analytics exécutable offline

  Scenario: le profil glycémique affiche AGP/TIR/hypos sur ≥3 patients
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: un patient < 70 % de capture déclenche l'état données insuffisantes
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/07-analytics.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/07-analytics.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/07-analytics.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/07-analytics.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

