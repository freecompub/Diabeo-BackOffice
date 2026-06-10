# QA — Paramètres du compte

Écran : `/settings` (Server Component `page.tsx` → `SettingsClient.tsx`).
Voir [conventions](README.md#3-conventions--légende).

> Les sections affichées dépendent du rôle. `PATIENT_ONLY_SECTIONS` masque pour
> les professionnels de santé (PS) : Données médicales, Administratif, Moments
> de la journée, Confidentialité (+ toggles notifications glycémie/insuline).
> Ces sections **ne sont pas fetchées** pour un PS (défense en profondeur).

---

## Écran : Paramètres (`/settings`) 🟢

**Rôle / RBAC** : tout utilisateur authentifié. VIEWER (patient) = 9 sections ;
PS = sous-ensemble. Le rôle est lu côté serveur (`x-user-role`) ; fail-closed
`redirect("/login")` si invalide.
**Statut impl.** : 🟢 Réel.

### Affichage attendu

| Section | Visibilité | Contenu |
|---|---|---|
| **Infos personnelles** | tous | Prénom, Nom, Sexe, Date de naissance · bouton « Enregistrer » + indicateur (spinner → ✓ 3 s) |
| **Données médicales** | patient | Type diabète, Année diagnostic (1900–now), Taille (50–250 cm) |
| **Administratif** | patient | NIRPP / INS **masqués** (toggle révéler + event analytics, copiable si révélé), OID (lecture seule) |
| **Contact** | tous | Téléphone, Adresse, Ville |
| **Unités** | tous | Glycémie (mg/dL\|mmol/L\|g/L), Poids (kg\|lbs), Taille (cm\|in) |
| **Moments de la journée** | patient | 4 plages (MORNING/NOON/EVENING/NIGHT), `startTime < endTime` |
| **Notifications** | tous (toggles glycémie/insuline = patient) | Rappels glycémie/insuline (patient), Rendez-vous (défaut on), Export auto (défaut off) |
| **Confidentialité** | patient | Partage chercheurs (off), prestataires (on), Analytics (on), Consentement RGPD (off) |
| **Sessions** | tous | liste sessions actives (device, IP, dernière activité) + « Déconnecter » |
| Export RGPD | tous | boutons « Exporter PDF » / « Exporter JSON » |
| Layout | — | desktop 2 panneaux · mobile accordéon |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Modifier infos perso | `PUT /api/account` | toast « ✓ Enregistré » | UPDATE `users` (firstname/lastname chiffrés + HMAC, sex, birthday) · audit UPDATE/USER |
| Modifier données médicales | `PUT /api/patient` + `PUT /api/patient/medical-data` | toast | UPDATE `patients.pathology` · UPDATE `patient_medical_data` (size, yearDiag) |
| Révéler NIRPP/INS | — (client) | masque ↔ clair + bouton copier | aucun (event analytics `administrative_field_revealed`) |
| Modifier contact | `PUT /api/account` | toast | UPDATE `users` (phone/address1/city chiffrés) |
| Modifier unités | `PUT /api/account/units` | toast | UPSERT `user_unit_preferences` · audit |
| Modifier moments | `PUT /api/account/day-moments` | toast | UPSERT `user_day_moments` (par type) |
| Modifier notifications | `PUT /api/account/notifications` | toggles + toast | UPSERT `user_notification_preferences` · audit |
| Modifier confidentialité | `PUT /api/account/privacy` | toggles + toast | UPSERT `user_privacy_settings` (gdprConsent → `consentDate` auto) · **invalide le cache de consentement** · audit |
| Changer la langue | `PUT /api/account/locale` | reload localisé (RTL si AR) | UPDATE `users.language` + cookie `diabeo_locale` · audit UPDATE/USER (`metadata.setting=locale`, sans PHI) — voir section Langue 🟢 |
| Gérer sessions | `GET /api/account/sessions` · `DELETE /api/account/sessions/[id]` | session retirée de la liste | DELETE `sessions` (révocation) |
| Exporter (RGPD Art. 20) | `GET /api/account/export` | spinner → téléchargement | lecture agrégée · audit EXPORT · **rate-limit 3/h/user** |

### Scénarios (Gherkin)

```gherkin
Feature: Paramètres du compte

  Scenario: un patient met à jour ses infos personnelles
    Given je suis connecté en tant que "VIEWER"
    And je suis sur "/settings"
    When je modifie le prénom en "Camille" et je clique "Enregistrer"
    Then je vois l'indicateur "✓ Enregistré"
    # Effet base: UPDATE users(firstname chiffré AES-256-GCM + firstnameHmac) + audit_logs(UPDATE/USER)

  Scenario: un professionnel de santé ne voit pas les sections patient-only
    Given je suis connecté en tant que "DOCTOR"
    When je vais sur "/settings"
    Then je ne vois pas la section "Données médicales"
    And je ne vois pas la section "Confidentialité"
    # (sections non rendues ET non fetchées — défense en profondeur)

  Scenario: révéler le NIRPP émet un événement analytics sans appel API
    Given je suis connecté en tant que "VIEWER"
    And je suis sur la section "Administratif"
    When je clique le bouton de révélation du NIRPP
    Then le NIRPP est affiché en clair
    # Effet base: AUCUN (event client diabeo_analytics: administrative_field_revealed)

  Scenario: retirer le consentement RGPD invalide immédiatement le cache
    Given je suis connecté en tant que "VIEWER" avec consentement donné
    When je désactive "Consentement RGPD" dans Confidentialité
    Then je vois "✓ Enregistré"
    # Effet base: UPSERT user_privacy_settings(gdprConsent=false, consentDate=NULL)
    #             + invalidation cache consentement (TTL 0) → prochains GET data = 403

  Scenario: export RGPD limité à 3 par heure
    Given je suis connecté en tant que "VIEWER"
    When je déclenche un 4e export dans l'heure
    Then la réponse est 429 avec en-tête "Retry-After"
    # Effet base: audit_logs(action=EXPORT) sur les exports réussis uniquement

  Scenario: déconnecter une session distante
    Given je suis sur la section "Sessions" avec 2 sessions actives
    When je clique "Déconnecter" sur l'autre session
    Then elle disparaît de la liste
    # Effet base: DELETE sessions WHERE id = {sessionId}

  # ── Persistance round-trip : modifié → enregistré en base → relu au rechargement ──
  # Garde-fou anti-régression : chaque champ éditable doit survivre à un reload
  # (la valeur est rechargée depuis la base via les GET /api/account/*), pas
  # seulement affichée en mémoire après le save.

  Scenario: unités — la valeur modifiée est persistée et relue après rechargement
    Given je suis connecté en tant que "VIEWER" sur "/settings" section "Unités"
    When je change l'unité de glycémie en "mmol/L" et j'enregistre
    Then je vois "✓ Enregistré"
    When je recharge "/settings"
    Then la section "Unités" affiche "mmol/L"
    # Effet base: UPSERT user_unit_preferences(glycemia='mmol/L') ; valeur relue via GET /api/account/units

  Scenario: notifications — un toggle modifié est persisté après rechargement
    Given je suis sur "/settings" section "Notifications"
    When je désactive "Rappels de rendez-vous" et j'enregistre
    When je recharge "/settings"
    Then le toggle "Rappels de rendez-vous" est toujours désactivé
    # Effet base: UPSERT user_notification_preferences ; relu via GET /api/account/notifications

  Scenario: contact — le téléphone modifié est persisté (chiffré) et relu
    Given je suis sur "/settings" section "Contact"
    When je modifie le téléphone en "+33611223344" et j'enregistre
    When je recharge "/settings"
    Then le champ téléphone affiche "+33611223344"
    # Effet base: UPDATE users(phone chiffré AES-256-GCM) ; déchiffré à la lecture (GET /api/account)

  Scenario: moments de la journée — l'horaire modifié est persisté
    Given je suis connecté en tant que "VIEWER" sur "/settings" section "Moments de la journée"
    When je change l'heure du "matin" et j'enregistre
    When je recharge "/settings"
    Then l'heure du "matin" reflète la nouvelle valeur
    # Effet base: UPSERT user_day_moments(type='morning', startTime=...) ; relu via GET /api/account/day-moments

  Scenario: champs obligatoires — un prénom vidé est refusé (pas d'écriture)
    Given je suis sur "/settings" section "Informations personnelles"
    When je vide le prénom et je clique "Enregistrer"
    Then je vois une erreur de validation et rien n'est enregistré
    # Effet base: AUCUNE (Zod rejette → 400, pas d'UPDATE users)
```

### Cas limites

- **PS** : section patient-only masquée **et** non fetchée (la nav ne l'affiche
  pas).
- **Champ chiffré non déchiffrable** → affiché « (non disponible) » (nullable).
- **Révocation consentement** : cache invalidé immédiatement (TTL 0 vs 5 min) →
  prochaine création de RDV / accès données = 422/403.
- **Double-save** : bouton désactivé pendant l'envoi (`loading`).
- **Non authentifié** → `redirect("/login")`.

---

## 🟢 Réel — Préférence de langue ([US-2112b](../UserStory/pro-user-stories/13-multi-pays-i18n/US-2112b-preference-langue-utilisateur.md) PR #513 · [US-2112c](../UserStory/pro-user-stories/13-multi-pays-i18n/US-2112c-i18n-dashboard-medecin.md))

> **Implémenté.** La section « Langue » de `/settings` (tous rôles) expose le
> `LocaleSwitcher` FR/EN/AR. Le choix est **persisté en base** (`User.language`)
> **et** pose le cookie `diabeo_locale` (PUT renvoie `{locale, persisted}`). Un
> écart langue active (cookie) vs préférence enregistrée au login déclenche une
> **bannière de réconciliation** (AC-3, montée dans `NavigationShell`).

### Affichage attendu

| Section | Visibilité | Contenu |
|---|---|---|
| **Langue** | tous | Sélecteur FR / EN / AR (valeur courante = `User.language`, défaut `fr`) · application immédiate (reload) · `dir="rtl"` pour AR |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Changer la langue (Settings) | `PUT /api/account/locale` | reload localisé (RTL si AR) | **UPDATE `users.language`** + cookie `diabeo_locale` (httpOnly:false, max-age 1 an) · audit UPDATE/USER (`metadata.setting=locale, value=...`, sans PHI) |
| Vérifier l'écart langue/préférence | `GET /api/account/locale` | bannière réconciliation si mismatch | aucune écriture (lecture `{preference, active, mismatch}`) |

### Scénarios (Gherkin)

```gherkin
Feature: Préférence de langue (US-2112b/c — RÉEL)

  Scenario: changer la langue dans les paramètres la persiste en base
    Given je suis connecté en tant que "VIEWER"
    And je suis sur "/settings" section "Langue"
    When je choisis "العربية" (ar)
    Then l'interface se recharge en arabe avec dir="rtl"
    # Effet base: UPDATE users SET language='ar' WHERE id=? + cookie diabeo_locale=ar
    #             + audit_logs(UPDATE/USER, metadata.setting=locale, value=ar)

  Scenario: round-trip — la langue choisie est relue depuis la base à la reconnexion
    Given j'ai choisi "ar" dans "/settings" section "Langue"
    When je me déconnecte puis me reconnecte sur un navigateur au cookie vidé
    Then l'interface s'affiche en arabe
    # Effet base: le login (re)pose diabeo_locale depuis users.language (seedLocaleCookieIfAbsent)

  Scenario: AC-3 — alerte de réconciliation si langue active ≠ préférence
    Given ma préférence "User.language" = "ar" et mon cookie diabeo_locale = "fr"
    When je me connecte
    Then une bannière non bloquante propose « Revenir à l'arabe » / « Continuer en français »
    # Effet base: « Continuer » → UPDATE users.language='fr' ; « Revenir » → cookie reposé sur 'ar'

  Scenario: langue non supportée rejetée
    Given je suis connecté en tant que "VIEWER"
    When je PUT "/api/account/locale" avec {"locale":"zz"}
    Then le statut de la réponse est 400
    # Validation Zod z.enum(["fr","en","ar"]) — aucune écriture
```

### Cas limites

- Échec persistance base → le cookie reste posé (dégradation gracieuse, `persisted:false`), pas de blocage UX.
- `User.language` NULL (jamais choisi) → défaut `fr` ; pas d'alerte de réconciliation.
- Écran non authentifié : la langue se change par cookie uniquement (cf. `01-auth.md` — switcher sur `/login`).
- Le cookie de locale n'est **jamais écrasé** par le login s'il est déjà présent (la divergence est gérée par la bannière, pas par un reset silencieux).
