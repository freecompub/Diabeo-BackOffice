# US-2278 — fixtures QA — Admin Ops (backups, santé, cron) (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/08-admin-ops.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2278` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/08-admin-ops.md` |

---


## 📋 Contexte — états manquants au seed actuel
- **backups** dans chaque état (pending/running/completed/failed)
- probes **system-health** (Redis/DB/S3 ok/down — exploiter pingRedis)
- historique de **jobs cron** (rappels, relances)
- événements d'**audit** variés (LOGIN, UNAUTHORIZED, READ, EXPORT…)

## ✅ Critères d'acceptation

```gherkin
Feature: QA 08-admin-ops exécutable offline

  Scenario: la liste des backups affiche les différents statuts
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: le dashboard system-health distingue service ok vs down
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/08-admin-ops.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/08-admin-ops.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/08-admin-ops.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/08-admin-ops.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

