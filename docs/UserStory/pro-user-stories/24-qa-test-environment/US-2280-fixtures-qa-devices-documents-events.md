# US-2280 — fixtures QA — Appareils, documents, événements (rendre le domaine QA-testable offline)

> Enrichir les données de seed pour que **tous les scénarios Gherkin de
> `docs/qa/10-devices-documents-events.md`** soient exécutables hors-ligne contre l'environnement
> mocké (US-2270), y compris les **états limites** (vides, erreurs, refus RBAC).

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2280` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **5** (Fibonacci) |
| **Dépendances** | **US-2270** (socle dev mocké) · `prisma/seed.ts` · `docs/qa/10-devices-documents-events.md` |

---


## 📋 Contexte — états manquants au seed actuel
- **documents** : upload (MinIO) → scan antivirus (stub) → téléchargement → suppression
- appareils : **appairage** (QR/token) + appareil **révoqué**
- **événements diabète** (DiabetesEvent multi-types : repas, activité, insuline…)
- résultat antivirus **infecté** simulé (test du rejet)

## ✅ Critères d'acceptation

```gherkin
Feature: QA 10-devices-documents-events exécutable offline

  Scenario: un document uploadé est scanné (stub clean) puis téléchargeable
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: un appareil révoqué n'accepte plus de sync
    # exercé hors-ligne contre l'env mocké (US-2270)

  Scenario: tous les scénarios de docs/qa/10-devices-documents-events.md sont atteignables
    Given l'env mocké (US-2270) + le seed enrichi de ce domaine
    Then chaque écran/état décrit dans docs/qa/10-devices-documents-events.md a une donnée
         de fixture permettant de le rendre (y compris états vides/erreur)
```

## 🛠️ Implémentation
- Ajouts dans `prisma/seed.ts` (ou module `prisma/seed/10-devices-documents-events.ts` dédié), **déterministes** (PRNG seedé), idempotents (upsert), PII chiffrées comme l'existant.
- Mettre à jour la ligne « # Effet base » des scénarios concernés dans `docs/qa/10-devices-documents-events.md` si besoin.
- Revue `prisma-specialist` (+ `medical-domain-validator` pour les domaines cliniques 07/11).

## 🔭 Hors périmètre
Stubs de services externes → US-2270. Exécution effective de la campagne → skill `/qa`.

