# US-2271 — fixtures QA — Authentification (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/01-auth.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2271` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/01-auth.md` |

---


## 📋 Contexte — états manquants au seed actuel
- compte avec **MFA activée** (secret TOTP de dev documenté)
- compte **suspendu** (status≠active) et compte **archivé**
- compte **verrouillé** (état lockout — via helper seed ou Redis mémoire)
- jeton de reset password valide (+ email via stub US-2270)

## ✅ Critères d'acceptation

```gherkin
Feature: QA 01-auth exécutable offline

  Scenario: un compte MFA permet de dérouler login→challenge OTP
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: un compte suspendu renvoie 401 générique sans incrément rate-limit
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/01-auth.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/01-auth.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/01-auth.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/01-auth.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

