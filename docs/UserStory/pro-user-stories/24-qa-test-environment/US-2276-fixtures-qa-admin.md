# US-2276 — fixtures QA — Admin (users, délégations) (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/06-admin.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2276` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/06-admin.md` |

---


## 📋 Contexte — états manquants au seed actuel
- utilisateurs **suspendu/archivé** + multi-rôles
- **demande de délégation** (pending → approved/rejected)
- enregistrement de **violation de données** (data breach, US-2137)
- règles **fiscales** par pays (US-2114) non vides

## ✅ Critères d'acceptation

```gherkin
Feature: QA 06-admin exécutable offline

  Scenario: un admin suspend/réactive un utilisateur (effet base + audit)
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: une délégation pending peut être approuvée
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/06-admin.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/06-admin.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/06-admin.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/06-admin.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

