# Rapport d'exécution QA — 11-clinical.md
**Date** : 2026-06-11 · **Chrome** · **FR** · **Rôle** : ADMIN

## Synthèse
| Scénario | Résultat |
|---|---|
| Page `/insulin-therapy` chargée — config DEMO_DATA (novorapid/lantus, cible 100 mg/dL, 4h) | ✅ OK |
| APIs insulin-therapy → 404 (ADMIN sans patient, DEMO_DATA) | ⚠️ Écart (documenté) |
| FSI timeline 24h — section présente (spinner en chargement) | ✅ OK |
| Page `/adjustment-proposals` — titre, "Propositions en attente", erreur API | ⚠️ Écart |

**2 OK · 0 KO · 2 écarts**

## Détail
- **Insulinothérapie** : DEMO_DATA affichée (insuline novorapid/lantus, glycémie cible 100 mg/dL, durée action 4h). APIs réelles `/api/insulin-therapy/settings|sensitivity-factors|carb-ratios` → 404. Pattern DEMO_DATA identique au domaine patients.
- **Propositions d'ajustement** : "Une erreur est survenue" + "Aucun resultat" (i18n: "résultat"). Contexte patient nécessaire.

**Anomalies i18n** : "Insulinotherapie" → "Insulinothérapie", "Glycemie cible" → "Glycémie cible", "Duree" → "Durée", "Facteur de sensibilite" → "sensibilité", "Aucun resultat" → "résultat".

## Non couvert
- Ajout/modification de configuration insuline (DOCTOR).
- Acceptation/rejet de proposition d'ajustement.
- `/medications`, `/import` non visités.
