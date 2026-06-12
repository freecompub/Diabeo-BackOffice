# Rapport d'exécution QA — 02-dashboards.md · Chrome / AR

**Date** : 2026-06-11 · **Chrome** · **AR/RTL**

## Synthèse

| Scénario | Résultat |
|---|---|
| Dashboard admin `/admin` — RTL structure | ✅ OK |
| Dashboard admin — contenu en français (traductions AR manquantes) | 🔴 KO |
| KPI mirrored (ordre droit→gauche en AR) | ✅ OK |

**2 OK · 1 KO · 0 écart**

## Détail

- **RTL layout** : nav à droite, contenu principal à gauche ✅. Ordre des cartes KPI inversé (Événements audit | Patients actifs | Membres équipe | Cabinets) ✅.
- 🔴 **KO — Traductions AR manquantes sur le dashboard admin** : titres "Tableau de bord administrateur", "Vue globale", "Conformité HDS", "Facturation à traiter", labels KPI, messages informatifs — tous restent en français. Les clés de traduction correspondantes sont absentes de `messages/ar.json` pour ce module.
- Dashboards DOCTOR et NURSE non visités en AR (session ADMIN). Suspicion d'un problème similaire sur le dashboard médecin (module distinct).

## Recommandation

Ajouter les clés manquantes dans `messages/ar.json` pour les modules admin-dashboard, billing, compliance.
