# US-2275 — fixtures QA — Paramètres (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/05-settings.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2275` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **2** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/05-settings.md` |

---


## 📋 Contexte — états manquants au seed actuel
- états de **consentement RGPD** (opt-in / opt-out explicite)
- préférences de **langue** (fr/en/ar) + préférence ≠ cookie (alerte réconciliation)
- préférences d'**unités** et de **notifications** variées
- liste d'appareils **MFA** (si MFA activée, cf. US-2271)

## ✅ Critères d'acceptation

```gherkin
Feature: QA 05-settings exécutable offline

  Scenario: un opt-out RGPD est reflété dans les écrans concernés
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: changer la langue persiste la préférence (User.language)
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/05-settings.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/05-settings.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/05-settings.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/05-settings.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

