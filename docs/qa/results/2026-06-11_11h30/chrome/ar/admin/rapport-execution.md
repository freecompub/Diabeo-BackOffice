# Rapport d'exécution QA — 06-admin.md · Chrome / AR

**Date** : 2026-06-11 · **Chrome** · **AR/RTL**

## Synthèse

| Scénario | Résultat |
|---|---|
| Dashboard admin `/admin` chargé en AR (session active) | ✅ OK |
| RTL layout — nav droite, icônes mirrored | ✅ OK |
| Contenu dashboard en français (titres, KPI labels, blocs Facturation/Conformité) | 🔴 KO |

**2 OK · 1 KO**

## Détail KO — Traductions AR manquantes dashboard admin

Strings non traduites : "Tableau de bord administrateur", "Vue globale", "Événements audit (7j)", "Patients actifs (14j)", "Membres équipe", "Cabinets", "Conformité HDS", "Dernier backup", "Aucun backup", "Backups échec (30j)", "Facturation à traiter", "Éligibles total", "Non facturés", "Facturés (30j)", "Montant non facturé".

Ces clés sont présentes dans `messages/fr.json` mais absentes de `messages/ar.json`.

## Capture
`admin_admin_dashboard-fr-dans-ar.jpg` — Dashboard admin AR avec contenu FR (anomalie visible)
