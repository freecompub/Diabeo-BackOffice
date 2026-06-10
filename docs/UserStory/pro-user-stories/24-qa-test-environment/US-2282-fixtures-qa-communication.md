# US-2282 — fixtures QA — Communication (messagerie, push, annonces) (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/12-communication.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2282` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/12-communication.md` |

---


## 📋 Contexte — états manquants au seed actuel
- **notifications push** (FCM stub US-2270) dans chaque état (envoyé/échec/lu)
- messages avec **statut de livraison**, fils archivés, recherche
- **annonces** (Announcement) actives/expirées
- templates de notification (rappels RDV, alertes)

## ✅ Critères d'acceptation

```gherkin
Feature: QA 12-communication exécutable offline

  Scenario: l'envoi d'un push est capturé par le stub (getPushLog) sans Firebase réel
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: un fil de messages affiche le compteur non-lu correct
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/12-communication.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/12-communication.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/12-communication.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/12-communication.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

