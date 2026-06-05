# QA — Administration & Opérations

Écrans : `/audit`, `/admin` (hub), `/admin/backups`, `/admin/system-health`.
Voir [conventions](README.md#3-conventions--légende).

> Tous **ADMIN only** (`redirect("/")` sinon). Le backend audit est opérationnel
> même quand l'UI de consultation ne l'est pas encore.

---

## Écran : Consultation audit (`/audit`) 🟡

**Statut impl.** : 🟡 **Stub UI** — la page affiche « Bientôt disponible ». Le
backend `GET /api/admin/audit-logs` est **pleinement opérationnel** (filtres
userId / resource / action / from / to / pagination). À tester au niveau
**contrat API**.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Consultation audit » + description | visible |
| Badge « Bientôt disponible » | visible |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| (API) consulter l'audit | `GET /api/admin/audit-logs?userId&resource&action&from&to&page&limit` | JSON paginé | **lecture seule** · la consultation est **elle-même auditée** (READ / SESSION, `resourceId:"audit-logs"`) |

```gherkin
Feature: Consultation de l'audit (contrat API)

  Scénario: un ADMIN filtre l'audit
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand j'appelle GET "/api/admin/audit-logs?resource=PATIENT&action=READ"
    Alors la réponse est 200 paginée
    # Effet base: audit_logs(action=READ, resource=SESSION, resourceId="audit-logs", metadata.filters)

  Scénario: paramètres invalides
    Quand j'appelle GET "/api/admin/audit-logs?limit=9999"
    Alors la réponse est 400 "validationFailed"
```

**Cas limites** : `limit` borné 1–200 (défaut 50) ; non-ADMIN → redirection / 401-403.

---

## Écran : Hub administrateur (`/admin`) 🟢

**Statut impl.** : 🟢 Réel (3 cartes en polling, lecture seule).

### Affichage attendu

| Carte | Contenu | Polling |
|---|---|---|
| **KPI** | Cabinets, Membres équipe, Patients actifs 14 j, Événements audit 7 j | 5 min |
| **Facturation** | Éligibles, Non facturés (rouge), Facturés 30 j, Montant non facturé € | 10 min |
| **Conformité HDS** | Dernier backup (Europe/Paris), Audit 24 h, Backups en échec 30 j · badges « Stale (>2 j) » / « Alerte » | 5 min |
| États | loading / erreur par carte / bannière « Données obsolètes » | — |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Polling | `GET /api/dashboard/admin/{kpi,billing,compliance}` | cartes mises à jour | **lecture seule** |

```gherkin
Feature: Hub administrateur

  Scénario: un ADMIN voit les 3 cartes
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand je vais sur "/admin"
    Alors je vois la carte "KPI"
    Et je vois la carte "Conformité HDS"

  Scénario: un non-ADMIN est redirigé
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je vais sur "/admin"
    Alors je suis redirigé vers "/"
```

**Cas limites** : API en échec → chaque carte affiche son erreur indépendamment ; bannière « obsolète » au-delà de 2× l'intervalle de polling.

---

## Écran : Backups PostgreSQL (`/admin/backups`) 🟢

**Statut impl.** : 🟢 Réel.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre + filtre statut (Tous / En attente / En cours / Terminé / Échoué) + Actualiser + « Déclencher backup » | visible |
| Ligne backup | badge statut, réf. tronquée (tooltip complet), « Démarré … », durée, taille (Intl), « Par User #ID », erreur dépliable |
| États | chargement / erreur + Réessayer / vide « Aucun backup » / liste |
| Après trigger | succès « Backup déclenché (status: pending) » ou erreur mappée (in progress / worker indispo / disque plein) |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Lister / filtrer | `GET /api/admin/backups?status&limit&cursor&from&to` | liste paginée | **lecture seule** · audit READ (BACKUP) · pas de location S3 exposée (`hasLocation:bool`) |
| Déclencher (dialog confirm) | `POST /api/admin/backups` (CSRF `X-Requested-With`) | « Backup déclenché » · **202** | INSERT `backup_log` (status=pending, triggeredBy) · audit CREATE · **rate-limit 3/h user + 6/h IP** · **concurrency guard** (1 seul pending/running) |

```gherkin
Feature: Backups PostgreSQL

  Scénario: déclencher un backup manuel
    Étant donné que je suis connecté en tant que "ADMIN"
    Et je suis sur "/admin/backups"
    Quand je clique "Déclencher backup" et je confirme
    Alors je vois "Backup déclenché"
    # Effet base: INSERT backup_log(status=pending, triggeredBy) + audit(CREATE/BACKUP) ; HTTP 202

  Scénario: un backup est déjà en cours (concurrency guard)
    Étant donné qu'un backup est déjà "running"
    Quand je déclenche un backup
    Alors je vois "Un backup est déjà en cours"
    # Effet base: AUCUNE insertion (409 backup_already_in_progress)

  Scénario: rate-limit dépassé
    Étant donné que j'ai déjà déclenché 3 backups dans l'heure
    Quand je déclenche un 4e backup
    Alors la réponse est 429 avec en-tête "Retry-After"
```

**Cas limites** : 429 (3/h user, 6/h IP, fail-closed) ; 409 concurrency ; `errorMessage` assaini (PHI strippé) ; `sizeBytes` BigInt → number ou string (>TB).

---

## Écran : Santé système (`/admin/system-health`) 🟢

**Statut impl.** : 🟢 Réel (auto-refresh 60 s, pausable).

### Affichage attendu

| Section | Contenu |
|---|---|
| Statut global | badge « Opérationnel / Dégradé / Hors service » + « Dernière vérification il y a … » + Pause/Reprendre + Actualiser |
| Composants (4) | Base de données, Redis, Ingestion CGM, Backups → badge Ok/Dégradé/HS/Inconnu |
| Métriques (4) | Sessions actives, Tentatives non-autorisées 24 h (highlight >100), CGM lag (highlight >30 min), Dernier backup (highlight >36 h) |
| États | chargement / erreur + Réessayer / succès |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Charger / Actualiser | `GET /api/admin/system-health` | snapshot | **lecture seule** · audit READ (SYSTEM_HEALTH) · 6 checks timeout 2 s |
| Pause / Reprendre auto-refresh | — (client) | bascule polling | aucun |

```gherkin
Feature: Santé système

  Scénario: snapshot santé pour un ADMIN
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand je vais sur "/admin/system-health"
    Alors je vois le statut global
    Et je vois les 4 composants (Base de données, Redis, Ingestion CGM, Backups)
    # Effet base: lecture seule + audit_logs(READ/SYSTEM_HEALTH)

  Scénario: alerte sur tentatives non-autorisées élevées
    Étant donné plus de 100 tentatives non-autorisées sur 24h
    Quand j'ouvre le snapshot
    Alors la métrique correspondante est mise en évidence avec un texte d'alerte
```

**Cas limites** : check > 2 s → fallback `down`/`unknown` ; Redis non configuré → `unknown` (dégradé accepté) ; highlights = couleur **+ texte** (WCAG).
