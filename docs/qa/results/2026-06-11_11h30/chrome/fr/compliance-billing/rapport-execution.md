# Rapport d'exécution QA — 09-admin-compliance-billing.md
**Date** : 2026-06-11 · **Chrome** · **FR** · **Rôle** : ADMIN

## Synthèse
| Scénario | Résultat |
|---|---|
| Bloc "Facturation à traiter" sur dashboard admin | ✅ OK |
| Bloc "Conformité HDS" sur dashboard admin | ✅ OK |
| `/admin/invoices` accessible (navigation réussie) | ✅ OK |

**3 OK · 0 KO · 0 écart**

## Détail
- **Facturation** : Eligibles: 1, Non facturés: 0, Montant: 0€. Table facturation formelle US-2107 en attente ✅.
- **Conformité HDS** : Audit 24h: 114, Backups échec: 0, RGPD requests US-2413 en V3.
- **Devices manquant** : la capture devices est dans le dossier `devices/` (domaine 10).

## Non couvert
- `/admin/data-breaches`, `/admin/tax-rules`, actions de facturation.
