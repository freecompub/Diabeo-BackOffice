# US-2273 — fixtures QA — Patients (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/03-patients.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2273` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **2** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/03-patients.md` |

---


## 📋 Contexte — états manquants au seed actuel
- 1 patient **sans données médicales**
- 1 patient **sans paramètres d'insulinothérapie**
- palette de flags de risque (cardio, pondéral…) variée
- 1 patient en **soft-delete** (deletedAt) pour vérifier l'exclusion

## ✅ Critères d'acceptation

```gherkin
Feature: QA 03-patients exécutable offline

  Scenario: la fiche d'un patient sans medical data s'affiche sans erreur (états vides)
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: un patient soft-deleted n'apparaît pas dans la liste
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/03-patients.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/03-patients.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/03-patients.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/03-patients.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

