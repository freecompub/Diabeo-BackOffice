# QA — Authentification

Écrans : `/login`, `/reset-password`. Voir [conventions](README.md#3-conventions--légende).

---

## Écran : Connexion (`/login`) 🟢

**Rôle / RBAC** : public (non authentifié). Après succès, redirection selon rôle :
DOCTOR → `/medecin`, NURSE → `/infirmier`, ADMIN → `/admin`, VIEWER → `/patient/dashboard`.
**Statut impl.** : 🟢 Réel (`POST /api/auth/login` + `sessions` + JWT cookie).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Logo Diabeo + titre « Bienvenue » | visible |
| Champ email | vide, type `email`, requis |
| Champ mot de passe | vide, type `password` + bouton bascule visibilité |
| Bouton « Connexion » | **désactivé** si email ou mot de passe vide |
| Lien « Mot de passe oublié ? » | → `/reset-password` |
| Mention « Hébergement HDS » | visible en pied |
| État chargement | bouton « Connexion en cours… », champs désactivés |
| État rate-limit | bannière rouge « Compte verrouillé. Réessayez dans X » + compte à rebours, champs/bouton désactivés |
| État erreur | bannière jaune « Identifiants invalides » + bouton fermer |
| Champ MFA (conditionnel) | apparaît si `mfaRequired:true` — input numérique 6 chiffres, auto-focus |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Soumettre identifiants valides (sans MFA) | `POST /api/auth/login` | redirection vers home du rôle | INSERT `sessions` (token, expires +24 h, ip, ua) · INSERT `audit_logs` (`LOGIN`/`SESSION`) · cookie httpOnly `diabeo_token` |
| Soumettre identifiants valides (MFA activée) | `POST /api/auth/login` puis `POST /api/auth/mfa/challenge` | affichage champ OTP, puis redirection | login renvoie `{mfaRequired,mfaToken}` (TTL court) ; session complète créée après OTP valide |
| Soumettre identifiants invalides | `POST /api/auth/login` → 401 | bannière « Identifiants invalides » + focus email | INSERT `audit_logs` (`UNAUTHORIZED`) · incrément compteur rate-limit (Redis) |
| 3+ échecs | `POST /api/auth/login` → 429 | bannière verrouillage + countdown | lockout progressif 5 / 15 / 60 min |
| Clic « Mot de passe oublié ? » | — | navigation `/reset-password` | aucun |

### Scénarios (Gherkin)

```gherkin
Feature: Connexion au backoffice

  Scenario: DOCTOR se connecte avec des identifiants valides
    Given je suis sur "/login"
    When je remplis "email" avec "docteur@diabeo.test"
    And je remplis "mot de passe" avec "DEV-ONLY-Doctor123!"
    And je clique "Connexion"
    Then je suis redirigé vers "/medecin"
    And un cookie httpOnly "diabeo_token" est présent
    # Effet base: INSERT sessions (userId=docteur, expires≈now+24h) + audit_logs(action=LOGIN, resource=SESSION)

  Scenario: bouton désactivé tant que le formulaire est incomplet
    Given je suis sur "/login"
    Then le bouton "Connexion" est désactivé
    When je remplis "email" avec "docteur@diabeo.test"
    Then le bouton "Connexion" est désactivé
    When je remplis "mot de passe" avec "DEV-ONLY-Doctor123!"
    Then le bouton "Connexion" est activé

  Scenario: identifiants invalides — message générique anti-énumération
    Given je suis sur "/login"
    When je remplis "email" avec "inconnu@diabeo.test"
    And je remplis "mot de passe" avec "mauvais"
    And je clique "Connexion"
    Then je vois "Identifiants invalides"
    And je reste sur "/login"
    # Effet base: audit_logs(action=UNAUTHORIZED, resource=SESSION, userId=null) + incrément rate-limit Redis
    # Note: message IDENTIQUE pour email inexistant / mot de passe faux / compte suspendu

  Scenario: verrouillage après 3 échecs
    Given je suis sur "/login"
    When j'échoue la connexion 3 fois avec "docteur@diabeo.test"
    Then je vois un message de verrouillage avec un compte à rebours
    And le bouton "Connexion" est désactivé
    # Effet base: lockout Redis (5 min au 3e échec, 15 au 4e, 60 au 5e+)

  Scenario: connexion avec MFA activée
    Given un utilisateur avec MFA activée
    And je suis sur "/login"
    When je soumets des identifiants valides
    Then le champ code MFA apparaît
    When je saisis un code TOTP valide à 6 chiffres
    Then je suis redirigé vers le home de mon rôle
    # Effet base: session créée seulement APRÈS validation OTP (mfaVerified=true)
```

### Cas limites

- **Anti-énumération** : même message « Identifiants invalides » pour email
  inexistant / mot de passe faux / compte suspendu. `bcrypt.compare` exécuté
  même si l'utilisateur n'existe pas (dummy hash) → pas de timing oracle.
- **Compte suspendu** (`status≠active`) : 401 générique, **sans** incrément
  rate-limit (anti-DoS : un attaquant ne peut pas re-verrouiller un compte déjà
  suspendu).
- **Token MFA pending expiré** (> ~5 min) : OTP rejeté (401), recommencer le login.
- ✅ **Lien « Créer un compte » retiré** (anomalie A1, corrigée) : il pointait
  vers `/register` (page inexistante → 404). L'inscription patient se fait par le
  personnel via `/patients/new` ; il n'y a pas d'auto-inscription publique.
- **Login réussi → réinitialise le compteur d'échecs** (`clearAttempts` au succès) :
  comportement **intentionnel** (standard + sûr : un mot de passe correct prouve
  la légitimité, on lève le lockout). Confirmé au run QA 2026-06-09.
- ✅ **Sélecteur de langue présent sur `/login` et `/reset-password`** (US-2112b
  AC-1, livré PR #513) — combobox FR/EN/AR, cookie client, sans appel authentifié.

### 🟢 Réel — Langue sur les écrans non authentifiés + confirmation au login ([US-2112b](../UserStory/pro-user-stories/13-multi-pays-i18n/US-2112b-preference-langue-utilisateur.md), livré PR #513)

> **Livré et confirmé** au run QA 2026-06-09 (AR/RTL) : switcher visible sur
> `/login` + `/reset-password` ; alerte de réconciliation affichée après login
> quand le cookie diffère de `User.language`.

```gherkin
Feature: Langue à la connexion (US-2112b)

  # AC-1 — switcher sur écran non authentifié (cookie uniquement, pas d'API auth)
  Scenario: un visiteur change la langue depuis l'écran de connexion
    Given je suis sur "/login" (non authentifié)
    When je choisis "العربية" dans le sélecteur de langue
    Then "/login" se recharge en arabe avec dir="rtl"
    # Effet base: AUCUN — cookie diabeo_locale=ar uniquement (aucun appel authentifié)

  # AC-3 — alerte de confirmation si langue de session ≠ préférence enregistrée
  Scenario: alerte quand la langue active diffère de la préférence au login
    Given ma préférence "User.language" = "ar"
    And mon cookie "diabeo_locale" = "fr" (poste partagé)
    When je me connecte avec des identifiants valides
    Then je vois une alerte de confirmation de changement de langue (role="alert", non bloquante)
    When je clique "Revenir à l'arabe"
    Then l'interface se recharge en arabe
    # Effet base: cookie diabeo_locale reposé depuis users.language (aucune écriture base)

  Scenario: pas d'alerte quand langue active == préférence
    Given ma préférence "User.language" = "fr" et le cookie "diabeo_locale" = "fr"
    When je me connecte
    Then aucune alerte de changement de langue n'est affichée
```

**Cas limites** : alerte non bloquante (ignorable) ; « Continuer en {langue session} » met à jour `User.language` (cf. `05-settings.md` AC-2) ; pas d'alerte si `User.language` NULL.

---

## Écran : Mot de passe oublié (`/reset-password`) 🟢

**Rôle / RBAC** : public.
**Statut impl.** : 🟢 Réel (`POST /api/auth/reset-password`, anti-énumération + anti-timing).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Réinitialiser le mot de passe » | visible |
| Champ email | vide, requis |
| Bouton « Réinitialiser » | désactivé si email vide ; « Envoi… » en cours |
| Lien « Retour à la connexion » | → `/login` |
| État succès (après envoi) | check vert + « Si un compte existe avec cet email, un lien de réinitialisation a été envoyé. » |
| État erreur réseau | « Vérifiez votre connexion réseau. » |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Soumettre un email **existant** | `POST /api/auth/reset-password` → 200 | écran succès générique | DELETE puis INSERT `verification_token` (TTL 1 h) · email envoyé (best-effort) · INSERT `audit_logs` (`UPDATE`/`USER`, `password_reset_requested`) |
| Soumettre un email **inexistant** | `POST /api/auth/reset-password` → 200 | **même** écran succès | aucune écriture (silencieux) |

### Scénarios (Gherkin)

```gherkin
Feature: Réinitialisation du mot de passe

  Scenario: demande pour un email existant
    Given je suis sur "/reset-password"
    When je remplis "email" avec "docteur@diabeo.test"
    And je clique "Réinitialiser"
    Then je vois "un lien de réinitialisation a été envoyé"
    # Effet base: verification_token (identifier=emailHmac, expires≈now+1h) + audit_logs(UPDATE/USER)

  Scenario: demande pour un email inexistant — réponse identique (anti-énumération)
    Given je suis sur "/reset-password"
    When je remplis "email" avec "personne@diabeo.test"
    And je clique "Réinitialiser"
    Then je vois "un lien de réinitialisation a été envoyé"
    # Effet base: AUCUNE (pas de token, pas d'email, pas d'audit)
```

### Cas limites

- **Réponse 200 identique** quel que soit l'email (existant ou non) +
  délai aléatoire 500–800 ms côté serveur (anti-timing).
- **Rate-limit** : clé Redis `reset:{emailHash}`, même progression que le login.
- **Échec déchiffrement email** : le token est créé mais l'email ne part pas
  (loggé en erreur) → l'utilisateur ne reçoit rien (cas de données corrompues).
