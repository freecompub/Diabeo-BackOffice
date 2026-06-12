# Rapport d'exécution QA — 07-dashboards-analytics.md
**Date** : 2026-06-11 · **Chrome** · **FR** · **Rôle** : ADMIN

## Synthèse
| Scénario | Résultat |
|---|---|
| Page `/analytics` accessible (ADMIN) | ✅ OK |
| 4 endpoints analytics → 404 (pas de contexte patient pour ADMIN) | ⚠️ Écart |
| Erreur affichée "Impossible de charger les donnees" avec bouton Réessayer | ✅ OK (gestion erreur conforme) |

**1 OK · 0 KO · 1 écart**

## Détail
La page `/analytics` s'affiche mais échoue à charger les données pour ADMIN : `/api/analytics/glycemic-profile?period=14d`, `/api/analytics/time-in-range?period=14d`, `/api/analytics/agp?period=14d`, `/api/analytics/hypoglycemia?period=14d` → 404.

Ces endpoints nécessitent probablement un contexte patient (VIEWER ou consultation overlay). Pour ADMIN sans patient sélectionné, les 404 sont attendus. La gestion d'erreur UI affiche "Erreur de chargement — Impossible de charger les donnees." (i18n: "données") avec bouton "Reessayer" (i18n: "Réessayer") ✅.

**Anomalies i18n** : "donnees" → "données", "reessayer" → "Réessayer".

## Non couvert
- Analytics avec contexte patient VIEWER (via dashboard patient, AGP fonctionne — cf. rapport 02-dashboards).
- Filtres période, export AGP.
