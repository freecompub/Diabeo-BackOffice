# US-2281 — fixtures QA — Clinique (propositions, bolus) (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/11-clinical.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2281` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **5** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/11-clinical.md` |

---


## 📋 Contexte — états manquants au seed actuel
- **propositions d'ajustement** dans chaque statut (pending/accepted/rejected/expired)
- **BolusCalculationLog** (immutable) + warnings cliniques
- liste de **médicaments** / traitements variés
- règles d'**alerte clinique** déclenchées (hypo/hyper/cétones)

## ✅ Critères d'acceptation

```gherkin
Feature: QA 11-clinical exécutable offline

  Scenario: une proposition pending peut être acceptée par un DOCTOR (jamais auto-appliquée)
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: un calcul de bolus produit un log immuable + propose un AdjustmentProposal
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/11-clinical.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/11-clinical.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/11-clinical.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/11-clinical.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

