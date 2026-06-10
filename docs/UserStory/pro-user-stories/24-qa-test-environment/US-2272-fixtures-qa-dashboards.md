# US-2272 — fixtures QA — Dashboards (médecin/infirmier/admin) (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/02-dashboards.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2272` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/02-dashboards.md` |

---


## 📋 Contexte — états manquants au seed actuel
- ≥2 **patients à risque** (flags variés) pour la carte « Patients à suivre »
- **urgences en cours** (EmergencyAlert) pour la carte urgences
- **propositions en attente** (compteur)
- données KPI 14j non vides (TIR moyen, actifs, urgences sem)

## ✅ Critères d'acceptation

```gherkin
Feature: QA 02-dashboards exécutable offline

  Scenario: le dashboard médecin affiche urgences, RDV, patients à suivre et KPI non vides
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: l'état vide de chaque carte est aussi atteignable (patient sans alerte)
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/02-dashboards.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/02-dashboards.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/02-dashboards.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/02-dashboards.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

