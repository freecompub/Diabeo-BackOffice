# US-2274 — fixtures QA — Rendez-vous (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/04-appointments.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2274` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/04-appointments.md` |

---


## 📋 Contexte — états manquants au seed actuel
- RDV de **chaque statut** (completed/no_show/scheduled/pending_validation/confirmed/cancelled) AVEC `motifEncrypted`
- RDV **sans motif** (test affichage vide)
- **conflit** (double-booking) + précédence d'une indisponibilité membre
- 1 membre **sans aucun RDV** (liste vide)

## ✅ Critères d'acceptation

```gherkin
Feature: QA 04-appointments exécutable offline

  Scenario: le modal détail RDV affiche le motif déchiffré quand présent
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: un créneau en conflit est signalé
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/04-appointments.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/04-appointments.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/04-appointments.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/04-appointments.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

