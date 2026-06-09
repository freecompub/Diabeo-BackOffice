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

## 🔵 Planifié — Préférence de langue ([US-2112b](../UserStory/pro-user-stories/13-multi-pays-i18n/US-2112b-preference-langue-utilisateur.md), V1 — à implémenter)

> **Non encore implémenté.** Spécification de test du follow-up US-2112b.
> Aujourd'hui : le moteur i18n (US-2112) existe mais le `LocaleSwitcher` n'est
> exposé sur aucun écran de l'app vivante, et la langue n'est **pas** persistée
> en base (colonne `User.language` présente mais non câblée). AC-2 ci-dessous.

### Affichage attendu (cible)

| Section | Visibilité | Contenu |
|---|---|---|
| **Langue** | tous | Sélecteur FR / EN / AR (valeur courante = `User.language`, défaut `fr`) · application immédiate (reload) · `dir="rtl"` pour AR |

### Actions & effets (cible)

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Changer la langue | `PUT /api/account/locale` (étendu) | reload localisé + toast | **UPDATE `users.language`** + cookie `diabeo_locale` synchronisé · audit UPDATE/USER (`metadata.setting=locale`, sans PHI) |

### Scénarios (Gherkin — cible)

```gherkin
Feature: Préférence de langue (US-2112b — planifié V1)

  Scenario: changer la langue dans les paramètres la persiste en base
    Given je suis connecté en tant que "VIEWER"
    And je suis sur "/settings" section "Langue"
    When je choisis "العربية" (ar)
    Then l'interface se recharge en arabe avec dir="rtl"
    # Effet base: UPDATE users SET language='ar' WHERE id=? + cookie diabeo_locale=ar
    #             + audit_logs(UPDATE/USER, metadata.setting=locale, value=ar)

  Scenario: la préférence survit au changement d'appareil (cookie vidé)
    Given ma préférence "User.language" = "ar"
    And mon cookie "diabeo_locale" est absent (nouveau navigateur)
    When je me connecte
    Then l'interface s'affiche en arabe
    # Effet base: le login (re)pose le cookie diabeo_locale depuis users.language

  Scenario: langue non supportée rejetée
    Given je suis connecté en tant que "VIEWER"
    When je PUT "/api/account/locale" avec {"locale":"zz"}
    Then le statut de la réponse est 400
    # Validation Zod z.enum(["fr","en","ar"])
```

### Cas limites (cible)

- Échec persistance base → le cookie reste posé (dégradation gracieuse), pas de blocage UX.
- `User.language` NULL (jamais choisi) → défaut `fr`.
- Écran non authentifié : la langue se change par cookie uniquement (cf. `01-auth.md`).
