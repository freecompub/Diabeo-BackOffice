# QA — Dashboards transverses & Analytics

Écrans : `/` (racine dashboard), `/dashboard`, `/analytics`, `/analytics/radar`, `/weekly`.
Voir [conventions](README.md#3-conventions--légende).

> Écrans **majoritairement en lecture seule** (audit READ, aucune écriture
> patient). Consentement RGPD requis pour les données glycémiques.

---

## Écran : Redirection racine (`/`) 🟢

**Rôle / RBAC** : redirige selon `x-user-role` — DOCTOR→`/medecin`, NURSE→`/infirmier`,
ADMIN→`/admin`, VIEWER→`/patient/dashboard`, sinon `/login`.
**Statut impl.** : 🟢 Réel (redirection serveur, aucun rendu).

```gherkin
Feature: Redirection de la racine selon le rôle

  Scénario: chaque rôle atterrit sur son dashboard
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je vais sur "/"
    Alors je suis redirigé vers "/medecin"
```

**Cas limites** : JWT expiré / `x-user-role` absent / session révoquée → `/login`.

---

## Écran : Dashboard glycémie (`/dashboard`) 🟢

**Rôle / RBAC** : utilisateurs authentifiés (protégé par le layout). **Consentement RGPD requis.**
**Statut impl.** : 🟢 Réel. ⚠️ Bouton « Nouvel évènement » câblé mais dialog non livré (US-WEB-202).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Glycémie » + sélecteur période (1W/2W/1M/3M) + Refresh | visible |
| Grille 6 métriques | Glycémie moyenne, HbA1c, TIR %, CV, Écart-type, Hypos |
| Graphique CGM (timeline) | visible |
| États | loading (skeleton), erreur + « Réessayer », vide (« noData »), succès |
| Auto-refresh | silencieux toutes les 5 min (annonce ARIA) |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Changer période / Refresh | `GET /api/analytics/{glycemic-profile,time-in-range,hypoglycemia}` + `/api/cgm` (parallèle) | rechargement, skeleton | **lecture seule** · audit READ (ANALYTICS / CGM_ENTRY) |

```gherkin
Feature: Dashboard glycémie

  Scénario: affichage des métriques pour un DOCTOR
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je vais sur "/dashboard"
    Alors je vois la métrique "TIR"
    Et je vois le graphique CGM
    # Effet base: lecture seule, GET analytics + /api/cgm = 200

  Scénario: consentement RGPD manquant
    Étant donné un patient sans consentement RGPD
    Quand la page charge les données
    Alors la réponse analytics est 403 "gdprConsentRequired"
```

**Cas limites** : 403 `gdprConsentRequired`, 429 rate-limit analytics (`Retry-After`), période > 90 j rejetée (Zod), fenêtre CGM > 30 j → erreur serveur.

---

## Écran : Analytics / Profil glycémique (`/analytics`) 🟢

**Rôle / RBAC** : authentifiés. Consentement RGPD requis.
**Statut impl.** : 🟢 Réel.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Profil glycémique » + plage de dates FR | visible |
| Sélecteur période (défaut 2W) | visible |
| Grille 6 métriques + badge capture rate | vert ≥70 %, ambre ≥50 %, rouge <50 % |
| Graphique AGP (5 percentiles p10/p25/médiane/p75/p90) + références 70/180/54/250 | visible |
| Pie TIR + barres + histogramme hypos | visible |
| Alerte « Données insuffisantes » | si capture < 50 % ET pas d'AGP |
| États | loading / erreur + retry / insufficientData / succès |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Changer période | `GET /api/analytics/{glycemic-profile,time-in-range,agp,hypoglycemia}` | recharge | **lecture seule** · audit READ (ANALYTICS) |

```gherkin
Feature: Profil glycémique (AGP)

  Scénario: badge capture rate en alerte sous 50%
    Étant donné un patient avec un capture rate < 50% et aucune donnée AGP
    Quand j'ouvre "/analytics"
    Alors je vois l'alerte "Données insuffisantes"
```

**Cas limites** : capture < 70 % → badge ambre ; toutes API en échec → erreur + retry.

---

## Écran : Graphique radar (`/analytics/radar`) 🟡

**Rôle / RBAC** : authentifiés.
**Statut impl.** : 🟡 Partiel — le radar SVG est implémenté, mais la répartition
`weeklyRadar` par jour côté service n'est pas garantie (réponse possiblement vide).
À tester comme « affichage » + « contrat API » séparément.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Graphique radar » + sélecteur période + sélecteur métrique (TIR / Glycémie moyenne / CV) | visible |
| Radar SVG 7 axes (Lun–Dim) + légende + tableau compagnon (Jour / Valeur / Vs moyenne) | visible si données |
| États | loading (skeleton), vide (insufficientData), erreur (AlertBanner), succès |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Changer période / métrique | `GET /api/analytics/glycemic-profile?period=…&metric=tir\|averageGlucose\|cv` | radar redessiné | **lecture seule** · audit READ |

**Cas limites** : tous points = 0 → état vide ; réponse 404/204 → aucun graphique ; metric invalide → 400 serveur.

---

## Écran : Vue hebdomadaire (`/weekly`) 🟡

**Rôle / RBAC** : authentifiés.
**Statut impl.** : 🟢 onglet « Semainier » réel · 🟡 onglets « Historique » et « Tableau » = « Bientôt disponible » (ComingSoon). ⚠️ Insuline hebdo = « — » (TODO `totalInsulin=null`).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Vue hebdomadaire » + 3 onglets (Historique / Tableau / Semainier) | seul Semainier actif |
| Navigation semaine (◄ / plage / ►) + badge « Semaine en cours » | ► désactivé sur la semaine courante |
| 4 cartes stats hebdo (Glycémie moy., TIR %, Lectures, Insuline U) | « Insuline » = « — » |
| Grille 7 jours (mini-graphique par jour) | visible |
| États | loading / erreur + « Réessayer » / vide / succès |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Naviguer semaine | `GET /api/cgm?from&to` (lun 00:00 → dim 23:59) | recharge 7 jours | **lecture seule** · audit READ (CGM_ENTRY) |
| Onglet Historique / Tableau | — | « Bientôt disponible » | aucun |

```gherkin
Feature: Vue hebdomadaire

  Scénario: le bouton "semaine suivante" est désactivé sur la semaine courante
    Étant donné que je suis sur "/weekly" sur la semaine en cours
    Alors le bouton de navigation vers la semaine suivante est désactivé

  Scénario: onglet Historique non encore livré
    Quand je clique l'onglet "Historique"
    Alors je vois "Bientôt disponible"
```

**Cas limites** : jour sans lectures → TIR/moyenne « — » ; plage CGM > 30 j → erreur serveur.
