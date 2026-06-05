# QA — Tableaux de bord par rôle

Écrans : `/medecin` (DOCTOR), `/infirmier` (NURSE), `/patient/dashboard` (VIEWER).
Voir [conventions](README.md#3-conventions--légende).

> Les 3 dashboards sont **en lecture seule** : aucune action n'écrit en base.
> Les écritures viennent des écrans cibles (patient, RDV…). Les cartes
> rafraîchissent par **polling** ; un indicateur « données obsolètes » apparaît
> si la dernière donnée dépasse le seuil de fraîcheur.

---

## Écran : Dashboard Médecin (`/medecin`) 🟢

**Rôle / RBAC** : DOCTOR, NURSE, ADMIN. Sinon → `/login` (VIEWER → `/patient/dashboard`).
**Statut impl.** : 🟢 Réel (4 endpoints `GET /api/dashboard/medecin/*`, lecture seule).

### Affichage attendu

| Bloc | État attendu |
|---|---|
| Titre « Tableau de bord médecin » | visible |
| **Urgences en cours** | liste ≤ 5 triée par criticité (badge sévérité + patient + valeur) · vide : « Aucune urgence » · polling 30 s · bannière « obsolète » si > 60 s |
| **RDV du jour** | liste ≤ 3 (badge heure, `imminent` si < 30 min, patient, Visio/Présence) · vide : « Aucun RDV » · polling 5 min |
| **Patients à suivre** | liste ≤ 3 (avatar, lien `/patients/{id}`, badge raison, métrique) · polling 5 min |
| **KPI cabinet 14 j** | 4 cartes (Patients actifs, TIR moyen %, Urgences 7 j, Propositions en attente) · loading = « — » + skeleton |
| États communs | loading (spinner), erreur (« Impossible de charger… ») |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Clic sur un patient (urgence / à suivre / RDV) | — (navigation) | va sur `/patients/{id}` | aucun |
| Polling automatique | `GET /api/dashboard/medecin/{urgencies,appointments,patients-at-risk,kpi}` | cartes mises à jour | **lecture seule** (scope portefeuille) ; `patients-at-risk` requiert DOCTOR |

### Scénarios (Gherkin)

```gherkin
Feature: Dashboard médecin

  Scenario: affichage des 4 blocs pour un DOCTOR
    Given je suis connecté en tant que "DOCTOR"
    When je vais sur "/medecin"
    Then je vois le bloc "Urgences en cours"
    And je vois le bloc "RDV du jour"
    And je vois le bloc "Patients à suivre"
    And je vois le bloc "KPI cabinet — 14 derniers jours"
    # Effet base: AUCUN (lecture seule) ; 4 GET /api/dashboard/medecin/* renvoient 200

  Scenario: clic sur un patient à risque ouvre sa fiche
    Given je suis connecté en tant que "DOCTOR"
    And je suis sur "/medecin"
    When je clique sur un patient du bloc "Patients à suivre"
    Then je suis redirigé vers une URL "/patients/{id}"

  Scenario: un VIEWER ne peut pas accéder au dashboard médecin
    Given je suis connecté en tant que "VIEWER"
    When je vais sur "/medecin"
    Then je suis redirigé vers "/patient/dashboard"
```

### Cas limites

- **VIEWER** sur `/medecin` → redirigé vers `/patient/dashboard` (layout).
- **Session expirée** → les `GET` renvoient 401 → cartes affichent « Impossible
  de charger… ».
- **Bloc « Patients à suivre »** requiert le rôle DOCTOR (403 pour NURSE).

---

## Écran : Dashboard Infirmier (`/infirmier`) 🟢

**Rôle / RBAC** : NURSE, DOCTOR, ADMIN. Sinon redirection.
**Statut impl.** : 🟢 Réel (4 endpoints `GET /api/dashboard/infirmier/*`, lecture seule).

### Affichage attendu

| Bloc | État attendu |
|---|---|
| Titre « Tableau de bord infirmier » | visible |
| **Ma journée (KPI)** | 4 cartes (RDV à préparer, Événements à valider, Urgences observées, Propositions à connaître) · polling 60 s |
| **To-do du jour** | liste ≤ 20 triée par score (badge type, lien patient, action, deadline) · vide : « Aucune tâche » · polling 60 s · **lecture seule (pas de checkbox V1)** |
| **Coordination équipe** | liste DelegationRequest (badge statut, direction ⇩/⇧, action, date) · polling 60 s · **lecture seule (chat V2)** |
| **Relances en attente** | liste patients (avatar, badge raison, métrique, boutons « Appeler » `tel:` / « SMS » `sms:`) · polling 120 s |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Clic patient (to-do / relance) | — | `/patients/{id}` | aucun |
| Clic « Appeler » / « SMS » | — (`tel:` / `sms:` natif) | ouvre le client natif | aucun |
| Polling | `GET /api/dashboard/infirmier/{kpi,todo,team-inbox,recall-list}` | cartes mises à jour | **lecture seule** |

### Scénarios (Gherkin)

```gherkin
Feature: Dashboard infirmier

  Scenario: affichage des blocs pour un NURSE
    Given je suis connecté en tant que "NURSE"
    When je vais sur "/infirmier"
    Then je vois le bloc "Ma journée"
    And je vois le bloc "To-do du jour"
    And je vois le bloc "Coordination équipe"
    And je vois le bloc "Relances en attente"
    # Effet base: AUCUN (lecture seule)

  Scenario: bouton Appeler masqué si le téléphone patient est absent/invalide
    Given je suis connecté en tant que "NURSE"
    And je suis sur "/infirmier"
    When un patient de la liste "Relances" n'a pas de téléphone valide
    Then le bouton "Appeler" n'est pas affiché pour ce patient
```

### Cas limites

- Numéro de téléphone validé par regex avant d'exposer `tel:`/`sms:`.
- « Aucune tâche » est un message explicite (pas une absence silencieuse).

---

## Écran : Dashboard Patient (`/patient/dashboard`) 🟢

**Rôle / RBAC** : VIEWER uniquement. Autres rôles → home de leur rôle.
**Statut impl.** : 🟢 Réel. **Consentement RGPD requis** : chaque `GET` renvoie
403 `gdprConsentRequired` si le consentement n'est pas donné.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Mon tableau de bord » + sous-titre « Aperçu des N derniers jours » | N selon sélecteur |
| **Sélecteur période** | 1W / 2W / 1M / 3M (défaut 1W) |
| **4 cartes KPI** | Temps dans la cible (TIR %), Glycémie moyenne (mg/dL), Variabilité (CV %), HbA1c estimée (GMI %) — « — » si absent |
| **Graphique CGM 24 h** | courbe + zone cible 70–180, hauteur ~320 px (fenêtre 24 h fixe, indépendante du sélecteur) |
| **AGP (profil ambulatoire)** | graphique percentiles selon période |
| **Actions rapides** | boutons → toast « Bientôt disponible » (V2) |
| États erreur | bannière `role="alert"` par section (indépendantes) |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Changer la période | `GET /api/analytics/glycemic-profile?period=…` + `…/agp?period=…` | KPI + AGP rechargés ; CGM 24 h inchangé | **lecture seule** (audit READ) |
| Chargement initial | 3 `GET` parallèles : `/api/cgm`, `/api/analytics/glycemic-profile`, `/api/analytics/agp` | sections remplies | **lecture seule** |
| Clic action rapide | — | toast « Bientôt disponible » 2,5 s | aucun |

### Scénarios (Gherkin)

```gherkin
Feature: Dashboard patient

  Scenario: le patient voit ses indicateurs glycémiques
    Given je suis connecté en tant que "VIEWER" avec consentement RGPD donné
    When je vais sur "/patient/dashboard"
    Then je vois la carte "Temps dans la cible"
    And je vois le graphique CGM sur 24 h
    # Effet base: AUCUN (lecture seule) ; GET /api/cgm + /api/analytics/* renvoient 200

  Scenario: changement de période recharge KPI et AGP mais pas le CGM 24h
    Given je suis sur "/patient/dashboard"
    When je sélectionne la période "1M"
    Then le sous-titre indique "30 derniers jours"
    And les cartes KPI sont rechargées
    And le graphique CGM affiche toujours les dernières 24 h

  Scenario: consentement RGPD manquant bloque l'affichage des données
    Given je suis connecté en tant que "VIEWER" sans consentement RGPD
    When je vais sur "/patient/dashboard"
    Then je vois "Acceptez la politique de confidentialité"
    # Effet base: GET /api/cgm renvoie 403 gdprConsentRequired
```

### Cas limites

- **Consentement absent** → 403 `gdprConsentRequired` → message « Acceptez la
  politique de confidentialité dans vos préférences ».
- **Session expirée** → 401 → « Session expirée. Reconnectez-vous. »
- **Rate-limit analytics** → 429 + `Retry-After` → « Service temporairement
  indisponible ».
- **Sections indépendantes** : si CGM OK mais métriques KO, seule la section
  métriques affiche l'erreur.
- Pas d'indicateur « obsolète » ici (fetch one-shot au montage, contrairement
  aux dashboards pro).
