# Rapport d'exécution QA — 02-dashboards.md

**Date** : 2026-06-11 · **Environnement** : `http://localhost:3000` (local) · **Exécution** : navigateur interactif Chrome · **Référence** : [`02-dashboards.md`](../../../../../02-dashboards.md)

## Synthèse

| Scénario | Résultat |
|---|---|
| Dashboard médecin — 4 blocs + 4 API 200 (DOCTOR/ADMIN) | ✅ OK |
| Dashboard médecin — clic patient → `/patients/{id}` | ✅ OK |
| VIEWER sur `/medecin` → redirigé `/patient/dashboard` | ✅ OK |
| ADMIN accède à `/medecin` | ✅ OK |
| Dashboard patient — 4 KPI + AGP + sélecteur période | ✅ OK |
| Dashboard patient — sélecteur 1M → sous-titre "30 derniers jours" | ✅ OK |
| Dashboard patient — CGM ne recharge pas sur changement période | ✅ OK |
| Dashboard patient — sections indépendantes (erreur CGM n'affecte pas AGP) | ✅ OK |
| Dashboard patient — toast "Bientôt disponible" sur actions rapides | ✅ OK |
| Dashboard patient — VIEWER → RBAC correct (nav limitée) | ✅ OK |
| Dashboard infirmier — 4 blocs + 4 API 200 (NURSE) | ✅ OK |
| Dashboard infirmier — bouton Appeler masqué (pas de tél. valide en seed) | ✅ OK |
| **`GET /api/cgm → 500`** — graphique CGM 24 h absent | 🔴 KO |

**12 OK · 0 écart · 0 N/A · 1 KO**

---

## Détail

### Dashboard Médecin (`/medecin`)

- **Blocs** : "Urgences en cours" (vide → "Aucune urgence"), "RDV du jour" (1 prévu : 16:30 Claire DT2), "Patients à suivre" (Top 3 : Claire/2, Lucas/3, Hélène/4), "KPI cabinet — 14 derniers jours" (Patients actifs: 1, TIR 100%, Urgences: 0, Propositions: 0). Tous les 4 `GET /api/dashboard/medecin/* → 200` ✅.
- **Polling** : timestamp "MAJ HH:MM:SS" visible et mis à jour ✅.
- **Clic patient** : clic sur "Claire · DT2" → navigation vers `/patients/2` ✅.
- **ADMIN** : `POST /api/auth/login (admin) → 200`, navigation manuelle `/medecin` → accès autorisé, 4 APIs → 200 ✅.
- **RBAC VIEWER** : navigation directe vers `/medecin` → redirigé vers `/patient/dashboard` par le middleware ✅.

### Dashboard Patient (`/patient/dashboard`)

- **KPI** : Temps dans la cible 100%, Glycémie moyenne 126 mg/dL, Variabilité CV 16.1%, HbA1c estimée 6.3% ✅.
- **Sélecteur période** : `1S` sélectionné par défaut → sous-titre "Aperçu des 7 derniers jours." ; bascule `1M` → sous-titre "Aperçu des 30 derniers jours." + `GET /api/analytics/glycemic-profile?period=30d → 200` + `GET /api/analytics/agp?period=30d → 200` ✅.
- **CGM indépendant** : URL CGM identique avant/après changement de période (fenêtre 24h fixe) ✅ — ne peut être pleinement vérifiée car l'API CGM est en erreur 500.
- **Sections indépendantes** : AGP + KPI s'affichent malgré l'erreur CGM. Message d'erreur localisé à la section "Glycémie sur 24 h" uniquement ✅.
- **Toast actions rapides** : clic "Saisir une glycémie" → toast "Bientôt disponible" confirmé par JS (éphémère 2,5 s) ✅.
- **Nav VIEWER** : seuls "Mon tableau de bord", "Rendez-vous", "Paramètres" visibles → isolation RBAC correcte ✅.

  🔴 **KO — `GET /api/cgm → 500`** : le graphique "Glycémie sur 24 h" ne se charge pas. Réponse 500 serveur. Erreur persistante sur les deux requêtes (montage + rechargement période). **Bug critique pour l'expérience VIEWER**. L'erreur est gérée côté UI (bannière jaune "Service temporairement indisponible. Réessayez dans un instant.") mais le graphique est absent.

### Dashboard Infirmier (`/infirmier`)

- **Blocs** : "Ma journée" (RDV à préparer: 1, Événements à valider: 0, Urgences observées: 0, Propositions à connaître: 0), "To-do du jour" (1 item : "RDV | Claire · ... | Préparer le dossier — RDV 16:30"), "Coordination équipe" ("Inbox vide"), "Relances en attente" (5 patients). Tous les 4 `GET /api/dashboard/infirmier/* → 200` ✅.
- **Bouton Appeler masqué** : aucun bouton `tel:` / `sms:` présent sur les lignes Relances → aucun patient seed n'a de numéro de téléphone valide → comportement conforme ("bouton masqué si absent/invalide") ✅. Recommandation : ajouter un numéro de téléphone valide au seed pour couvrir le cas positif.

---

## Non couvert

- Dashboard VIEWER sans consentement RGPD (403 `gdprConsentRequired`) — seed DT1 a déjà donné son consentement.
- Bouton "Appeler" visible (cas positif) — seed manque de numéros de téléphone valides.
- Rate-limit analytics (429) — non reproductible sur seed local.
- Cas "session expirée → 401 → bannière erreur" — non testé.

---

## Annexe — captures

| Fichier | État capturé |
|---|---|
| `dashboards_medecin_admin-acces-complet.jpg` | Dashboard /medecin vu par ADMIN |
| `dashboards_patient-dashboard_periode-1M.jpg` | Dashboard patient période 1M + erreur CGM |
| `dashboards_infirmier_dashboard-nurse.jpg` | Dashboard infirmier vu par NURSE |
| `dashboards_infirmier_relances-scroll.jpg` | Relances en attente (sans boutons Appeler) |

## Recommandations

1. **`GET /api/cgm → 500`** : investiguer l'erreur serveur sur l'endpoint CGM. Le graphique 24h est une fonctionnalité centrale du dashboard patient.
2. **Seed** : ajouter un numéro de téléphone valide à au moins un patient pour permettre de tester les boutons `tel:`/`sms:` dans les relances infirmières.
3. **Labels sélecteur période** : la spec indique "1W/2W/1M/3M" mais l'UI affiche "1S/2S/1M/3M". Cohérence à vérifier avec la spec (1S = 1 Semaine en FR — acceptable si spécification est en EN).
