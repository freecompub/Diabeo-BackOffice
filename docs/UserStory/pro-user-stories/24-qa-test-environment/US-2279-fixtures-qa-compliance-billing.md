# US-2279 — fixtures QA — Conformité & Facturation (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/09-compliance-billing.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2279` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/09-compliance-billing.md` |

---


## 📋 Contexte — états manquants au seed actuel
- **factures** dans tout le cycle (draft/issued/paid/overdue)
- **relances** de facture (cron J+7/15/30, email via stub US-2270)
- **règles fiscales** par pays + devises (EUR/DZD)
- export RGPD (Art. 20) + notification de violation (Art. 33)

## ✅ Critères d'acceptation

```gherkin
Feature: QA 09-compliance-billing exécutable offline

  Scenario: une facture overdue déclenche une relance (email stub loggé)
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: l'export RGPD d'un patient produit l'archive attendue
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/09-compliance-billing.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/09-compliance-billing.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/09-compliance-billing.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/09-compliance-billing.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

