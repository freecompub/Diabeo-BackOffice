# QA — Administration

Écrans : `/admin/users`, `/admin/users/[id]`, `/admin/cabinets`, `/admin/cabinets/[id]`.
Voir [conventions](README.md#3-conventions--légende).

> **RBAC** : toutes ces pages sont **strictement ADMIN** (`redirect("/")` sinon,
> côté serveur). Les actions sensibles (changement de rôle/statut) exigent un
> **step-up MFA** (fraîcheur < 5 min) et sont **idempotentes**
> (`Idempotency-Key`). Garde **anti-lockout** : impossible de retirer/suspendre
> le dernier ADMIN (transaction Serializable).

---

## Écran : Utilisateurs — liste (`/admin/users`) 🟢

**Statut impl.** : 🟢 Réel (`GET /api/admin/users`).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Utilisateurs » + description | visible |
| Recherche | email/nom/prénom (`autocomplete=off`) |
| Filtres | Rôle (Administrateur/Médecin/Infirmier·ère/Patient) + Statut (Actif/Suspendu/Archivé) |
| Bouton « Actualiser » | visible |
| Ligne utilisateur | icône + nom (ou email) · badge rôle (ADMIN rouge, DOCTOR bleu, NURSE gris, VIEWER contour) · badge statut · badge « MFA » si activé · email + date création |
| Bandeau PHI | rappel usage strictement admin |
| États | chargement « Chargement… » · erreur « Liste indisponible » + « Réessayer » · vide « Aucun utilisateur » |
| Pagination | max 100 · alerte si > 100 « Affiner les filtres » |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Charger / filtrer / chercher | `GET /api/admin/users?role&status&search&limit&cursor` | liste | **lecture** · audit READ (`resource:USER`, `resourceId:"admin:users:list"`) |
| Clic ligne | — | `/admin/users/{id}` | aucun |

### Scénarios (Gherkin)

```gherkin
Feature: Liste des utilisateurs (admin)

  Scenario: un ADMIN liste les utilisateurs
    Given je suis connecté en tant que "ADMIN"
    When je vais sur "/admin/users"
    Then je vois la liste des utilisateurs avec leurs badges rôle et statut
    # Effet base: audit_logs(action=READ, resource=USER, resourceId="admin:users:list")

  Scenario: un non-ADMIN est redirigé
    Given je suis connecté en tant que "DOCTOR"
    When je vais sur "/admin/users"
    Then je suis redirigé vers "/"

  Scenario: filtrer par rôle et statut
    Given je suis sur "/admin/users"
    When je filtre rôle="Médecin" et statut="Actif"
    Then seuls les DOCTOR actifs sont affichés
```

### Cas limites

- Recherche = **match exact HMAC** (pas de recherche partielle, protection PHI).
- Scope cabinet : un ADMIN de cabinet ne voit que ses utilisateurs.

---

## Écran : Utilisateur — détail / édition (`/admin/users/[id]`) 🟢

**Statut impl.** : 🟢 Réel (`PATCH /api/admin/users/[id]`).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Breadcrumb « ← Retour à la liste » | visible |
| En-tête | nom + badge rôle + badge statut + « MFA activé » si activé |
| Section « Détails » (lecture) | Email, Prénom, Nom, Langue · Créé le / Statut modifié le / Mis à jour le |
| Section « Changer le rôle » | boutons « Définir le rôle : {actuel} → {cible} » ; **« vers ADMIN » désactivé si MFA non activée** (avertissement jaune) |
| Section « Changer le statut » | boutons active/suspended/archived (archivé = rouge destructive) + avertissement « l'archivage révoque tous les tokens » |
| Dialog de confirmation | titre dynamique + avertissement + « Action tracée dans l'audit log immuable » |
| États action | en cours (disabled+spinner) · succès (bandeau vert 3 s) · erreur (texte rouge) |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Changer le rôle | `PATCH /api/admin/users/[id]` `{role}` | dialog → succès → refetch | UPDATE `users.role` · audit UPDATE (old/new role) · **step-up MFA requis** |
| Changer le statut | `PATCH /api/admin/users/[id]` `{status}` | dialog → succès | UPDATE `users.status/statusChangedAt/statusChangedBy` · si archive/suspend : **DELETE sessions** + **revoke Redis** (TTL 900 s) · audit (transition, revokedSessionsCount) |

> Body = exactement **un** champ (`role` XOR `status`). Header
> `Idempotency-Key` (UUID v4) → rejeu = réponse cachée, zéro double audit/revoke.

### Scénarios (Gherkin)

```gherkin
Feature: Détail et édition d'un utilisateur (admin)

  Scenario: promouvoir un utilisateur en DOCTOR (avec MFA fraîche)
    Given je suis connecté en tant que "ADMIN" avec MFA fraîche
    And je suis sur "/admin/users/{id}"
    When je clique "Définir le rôle : Patient → Médecin"
    And je confirme
    Then je vois "Action effectuée."
    # Effet base: UPDATE users.role=DOCTOR + audit_logs(UPDATE/USER, old={role}, new={role:DOCTOR})

  Scenario: promotion vers ADMIN interdite si la cible n'a pas la MFA
    Given un utilisateur cible sans MFA activée
    When j'ouvre son détail
    Then le bouton "Définir vers ADMIN" est désactivé
    And je vois l'avertissement "MFA requise pour les comptes à privilèges"

  Scenario: step-up MFA exigé pour toute modification
    Given je suis connecté en tant que "ADMIN" sans MFA récente (> 5 min)
    When je PATCH "/api/admin/users/{id}" avec {role: "NURSE"}
    Then la réponse est 401 avec en-tête "WWW-Authenticate"
    # Effet base: AUCUNE modif + audit_logs(stepUp.failed)

  Scenario: impossible de rétrograder le dernier ADMIN (anti-lockout)
    Given il ne reste qu'un seul ADMIN actif
    When je tente de le rétrograder en DOCTOR
    Then la réponse est 409 "last_admin_cannot_be_demoted"
    # Effet base: AUCUNE modif (transaction Serializable)

  Scenario: archiver un utilisateur révoque ses sessions
    Given je suis connecté en tant que "ADMIN" avec MFA fraîche
    When je passe le statut d'un utilisateur à "archived"
    Then je vois "Action effectuée."
    # Effet base: UPDATE users.status=archived + DELETE sessions(user)
    #             + revoke Redis(sid, TTL 900s) + audit(transition="active->archived", revokedSessionsCount)

  Scenario: un ADMIN ne peut pas changer son propre statut/rôle
    Given je suis connecté en tant que "ADMIN"
    When je tente de modifier mon propre statut
    Then la réponse est 403 "cannot_change_own_status"

  Scenario: idempotence — double-clic ne double pas l'action
    Given je modifie un rôle avec un Idempotency-Key donné
    When la même requête est rejouée avec la même clé
    Then la réponse est identique avec "X-Idempotency-Replayed: true"
    # Effet base: AUCUN second UPDATE / audit / revoke
```

### Cas limites

- **Step-up MFA** (< 5 min) obligatoire ; sinon 401 + `WWW-Authenticate`.
- **Anti-lockout** dernier ADMIN (409), **anti-self-demote** (403),
  **anti-self-status** (403).
- **Révocation JWT atomique** : sessions supprimées en base + révoquées Redis
  (TTL 900 s ≥ validité access token).
- **Idempotency** : rejeu de la même clé = pas de double effet.

---

## Écran : Cabinets — liste (`/admin/cabinets`) 🟢

**Statut impl.** : 🟢 Réel (`GET /api/admin/healthcare-services`).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Cabinets & structures » + description | visible |
| Recherche | nom / ville / établissement |
| Ligne cabinet | icône + nom · badge type (Clinique/Hôpital/Cabinet libéral) · badge bleu « SMS activé (N crédits) » si activé · badge rouge « Pas de manager » si `managerId=null` · établissement · ville |
| États | chargement · erreur « Liste indisponible » + « Réessayer » · vide « Aucun cabinet enregistré » |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Charger / chercher | `GET /api/admin/healthcare-services?type&search&limit&cursor` | liste | **lecture** · audit READ (`resource:HEALTHCARE_SERVICE`, `resourceId:"admin:healthcare:list"`) |
| Clic ligne | — | `/admin/cabinets/{id}` | aucun |

---

## Écran : Cabinet — détail / édition (`/admin/cabinets/[id]`) 🟢

**Statut impl.** : 🟢 Réel (`PUT /api/cabinet/[id]/settings`, `PUT /api/cabinet/[id]/sms-config`).

### Affichage attendu

| Section | Contenu attendu |
|---|---|
| En-tête | nom + établissement + badges type / SIRET / « Pas de manager » |
| **Paramètres cabinet** (manager-level) | lecture : téléphone, email, site, capacité, adresses, CP, ville, pays, spécialités, noVideos, noFood + bouton « Modifier » · édition : inputs + « Annuler »/« Enregistrer » + dialog confirmation (N champs modifiés) |
| **Config SMS** (V1 mock) | « SMS activé » oui/non · « Crédits restants » + « ⚠ Faible » si < 10 · bandeau « V1 mock : aucun SMS réel envoyé » + bouton « Modifier » |

### Actions & effets

| Action | Endpoint | RBAC | Effet visuel | Effet base |
|---|---|---|---|---|
| Éditer paramètres cabinet | `PUT /api/cabinet/[id]/settings` | DOCTOR (manager) ou ADMIN | dialog → succès « Paramètres cabinet mis à jour » | UPDATE `healthcare_service` (champs modifiés) · audit UPDATE (`resource:CABINET_SETTINGS`) · `Idempotency-Key` |
| Modifier config SMS | `PUT /api/cabinet/[id]/sms-config` | **ADMIN only** | dialog → succès « Configuration SMS mise à jour » | UPDATE `healthcare_service` (smsEnabled, smsCreditBalance) · audit (`sms.config.toggled` / `credits_adjusted`) |

> Validation settings (Zod) : phone ≤ 30, email ≤ 255, website url ≤ 500,
> adresses ≤ 255, CP ≤ 10, ville ≤ 100, spécialités ≤ 20 × ≤ 60 car., capacité
> ∈ [0,10000]. SMS : `smsCreditBalance ∈ [0, 1 000 000]`. Champs régaliens
> (SIRET, TVA, type, licence) modifiables uniquement via la route admin
> `/api/admin/healthcare-services/[id]` (pas la route manager).

### Scénarios (Gherkin)

```gherkin
Feature: Détail et édition d'un cabinet (admin)

  Scenario: éditer les coordonnées d'un cabinet
    Given je suis connecté en tant que "ADMIN"
    And je suis sur "/admin/cabinets/{id}"
    When je clique "Modifier" sur les paramètres cabinet
    And je change le téléphone et je clique "Enregistrer"
    And je confirme
    Then je vois "Paramètres cabinet mis à jour."
    # Effet base: UPDATE healthcare_service(phone) + audit_logs(UPDATE/CABINET_SETTINGS)

  Scenario: activer le SMS et créditer (ADMIN only)
    Given je suis connecté en tant que "ADMIN"
    And je suis sur "/admin/cabinets/{id}"
    When j'active "SMS" et je fixe les crédits à 100
    And je confirme
    Then je vois "Configuration SMS mise à jour."
    # Effet base: UPDATE healthcare_service(smsEnabled=true, smsCreditBalance=100)
    #             + audit_logs(sms.config.toggled / credits_adjusted)

  Scenario: la config SMS est interdite à un non-ADMIN
    Given je suis connecté en tant que "DOCTOR" manager du cabinet
    When je PUT "/api/cabinet/{id}/sms-config"
    Then la réponse est 401 ou 403

  Scenario: alerte crédits SMS faibles
    Given un cabinet avec SMS activé et un solde de 5 crédits
    When j'ouvre son détail
    Then je vois "⚠ Faible" à côté des crédits SMS
```

### Cas limites

- **SMS V1 = mock** : aucun SMS réel n'est envoyé (`provider="mock"`), mais le
  crédit décrémente pour simuler le coût (décrément atomique
  `WHERE smsCreditBalance >= cost`).
- **Séparation des routes** : paramètres généraux = manager OU admin ;
  config SMS = **admin only** ; champs régaliens = route admin dédiée.
