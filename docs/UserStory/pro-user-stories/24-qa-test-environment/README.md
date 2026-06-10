# Domaine 24 — QA & Environnement de test

Jeu de User Stories pour **pousser la QA à fond** : rendre l'application
entièrement exécutable **hors-ligne et de façon déterministe**, puis garantir
que **chaque domaine QA** (`docs/qa/NN-*.md`) dispose des fixtures couvrant
**tous ses états** (nominal, vides, erreurs, refus RBAC, cas limites).

## Structure

| US | Portée | SP |
|----|--------|---:|
| [US-2270](US-2270-socle-dev-mocke.md) | **Socle** — env mocké (stubs email/firebase/antivirus + redis revocation fallback + profil `.env.mock.dev`) | 5 |
| [US-2271](US-2271-fixtures-qa-auth.md) | Fixtures **01-auth** (MFA, suspendu/archivé, verrouillé, reset) | 3 |
| [US-2272](US-2272-fixtures-qa-dashboards.md) | Fixtures **02-dashboards** (patients à risque, urgences, propositions, KPI) | 3 |
| [US-2273](US-2273-fixtures-qa-patients.md) | Fixtures **03-patients** (sans medical data / sans thérapie, soft-delete) | 2 |
| [US-2274](US-2274-fixtures-qa-appointments.md) | Fixtures **04-appointments** (tous statuts + motif, conflits, indispo) | 3 |
| [US-2275](US-2275-fixtures-qa-settings.md) | Fixtures **05-settings** (RGPD opt-out, langue, unités, notifs) | 2 |
| [US-2276](US-2276-fixtures-qa-admin.md) | Fixtures **06-admin** (suspendu/archivé, délégations, data breach, fiscalité) | 3 |
| [US-2277](US-2277-fixtures-qa-analytics.md) | Fixtures **07-analytics** (multi-patients, données insuffisantes, compare) | 3 |
| [US-2278](US-2278-fixtures-qa-admin-ops.md) | Fixtures **08-admin-ops** (backups, system-health, cron, audit) | 3 |
| [US-2279](US-2279-fixtures-qa-compliance-billing.md) | Fixtures **09-compliance-billing** (cycle facture, relances, RGPD) | 3 |
| [US-2280](US-2280-fixtures-qa-devices-documents-events.md) | Fixtures **10-devices-documents-events** (upload/scan/download, appairage, events) | 5 |
| [US-2281](US-2281-fixtures-qa-clinical.md) | Fixtures **11-clinical** (propositions, bolus log, alertes) | 5 |
| [US-2282](US-2282-fixtures-qa-communication.md) | Fixtures **12-communication** (push, livraison, annonces) | 3 |

**Total : 41 SP.** US-2270 (socle) est prérequis de toutes les autres.

## Principes
- **Déterministe** : PRNG seedé, idempotent (upsert), reproductible (captures QA stables).
- **Offline** : aucun service externe requis (stubs + fallbacks mémoire + MinIO).
- **Sécurité conservée** : PII chiffrées AES-256-GCM même en fixtures ; secrets de dev marqués `DEV-ONLY`, jamais en prod.
- **Couverture états** : chaque écran de `docs/qa/` doit avoir une fixture pour son état nominal **et** ses états vides/erreur/refus.

## Ordre de réalisation conseillé
1. **US-2270** (débloque l'app offline).
2. Domaines aujourd'hui **vides** au seed (impact QA max) : US-2281 (clinical), US-2279 (billing), US-2278 (admin-ops), US-2280 (devices/docs).
3. Domaines **partiels** : US-2271, 2272, 2274, 2277, 2276, 2275, 2282, 2273.
4. Lancer la campagne via le skill `/qa` (interactif) ou Playwright BDD (headless).
