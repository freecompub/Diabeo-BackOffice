# Rapport d'exécution QA — 01-auth.md

**Date** : 2026-06-11 · **Environnement** : `http://localhost:3000` (local) · **Exécution** : navigateur interactif Chrome · **Référence** : [`01-auth.md`](../../../../../01-auth.md)

## Synthèse

| Scénario | Résultat |
|---|---|
| Affichage initial `/login` (bouton désactivé si vide) | ✅ OK |
| Bouton désactivé email seul, activé email+mdp | ✅ OK |
| DOCTOR connexion valide → `/medecin` | ✅ OK |
| Cookie `diabeo_token` httpOnly | ✅ OK |
| Identifiants invalides → bannière jaune + 401 | ✅ OK |
| Anti-énumération login (email inexistant = même message) | ✅ OK |
| `/reset-password` affichage (bouton désactivé si vide) | ✅ OK |
| Reset email existant → 200 + message générique | ✅ OK |
| Reset email inexistant → 200 + même message (anti-énumération) | ✅ OK |
| Sélecteur langue AR sans auth → RTL + cookie only | ✅ OK |
| Lockout après 3 échecs → 429 + bannière rouge + countdown + champs disabled | ✅ OK |
| MFA activée (champ OTP) | ⏭️ N/A |
| Alerte langue (US-2112b AC-3, cookie ≠ User.language) | ⏭️ N/A |
| Utilisateur connecté naviguant vers `/login` redirigé | ⚠️ Écart |
| Accents FR dans les traductions | ⚠️ Écart (multiples) |

**11 OK · 2 écarts · 2 N/A · 0 KO**

---

## Détail

### Écran `/login`

- **Affichage initial** : titre "Bienvenue sur Diabeo" visible, champ email (type email, requis), champ mot de passe (type password, toggle visibilité), lien "Mot de passe oublie ?", pied "Bienvenue sur Diabeo — Donnees hebergees HDS". Conforme à la spec (hors accents — voir écart i18n).
- **Bouton désactivé** : `disabled` si email vide ✅ ; `disabled` si email seul ✅ ; activé (enabled) avec les deux champs remplis ✅.
- **DOCTOR connexion valide** : `POST /api/auth/login → 200`, redirection `GET /medecin → 200`, cookie `diabeo_token` httpOnly (invisible JS) ✅. Dashboard médecin chargé avec données seed.
- **Identifiants invalides** : `POST /api/auth/login → 401`, bannière jaune "Identifiants invalides" avec `role="alert"`, `aria-invalid="true"` sur le champ email, reste sur `/login` ✅.
- **Anti-énumération** : même message "Identifiants invalides" pour email inexistant ET email existant + mauvais mot de passe ✅.
- **Lockout 3 échecs** : `POST /api/auth/login → 429`, bannière rouge "Compte temporairement bloque. Reessayez dans X min Y s." avec countdown, champs email/mdp et bouton tous `disabled` ✅.

  ⚠️ **Écart i18n lockout** : "bloque" → "bloqué", "Reessayez" → "Réessayez".

- **Utilisateur connecté → `/login`** : après login DOCTOR réussi, navigation directe vers `http://localhost:3000/login` affiche le formulaire au lieu de rediriger vers `/medecin`. Le cookie `diabeo_token` (httpOnly) n'est pas vérifié par le middleware côté client pour cette redirection.

  ⚠️ **Écart** : un utilisateur authentifié peut accéder à `/login`. UX mineure mais pourrait dérouter. Recommandation : middleware `redirectIfAuthenticated` sur les routes publiques auth.

### Écran `/reset-password`

- **Affichage** : titre, champ email requis, bouton "Envoyer le lien" désactivé si vide, lien retour vers `/login`. Conforme.
- **Email existant** : `POST /api/auth/reset-password → 200`, formulaire remplacé par "Si un compte existe avec cette adresse, un e-mail de reinitialisation a ete envoye." ✅.
- **Email inexistant** : `POST /api/auth/reset-password → 200`, **même message** ✅ (anti-énumération).

  ⚠️ **Écart i18n** : "reinitialisation" → "réinitialisation", "ete" → "été", "envoye" → "envoyé".

### US-2112b — Sélecteur de langue (non authentifié)

- **AC-1** : sélecteur combobox FR/EN/AR visible sur `/login` et `/reset-password` ✅. Bascule AR → `dir="rtl"`, `lang="ar"`, `cookie diabeo_locale=ar` posé **sans appel API authentifié** ✅. Visuel RTL conforme (labels droite, bouton centré). Aucune chaîne brute visible.
- **AC-3** (alerte confirmation langue) : **N/A** — nécessite un compte seed avec `User.language=ar` ; aucun compte seed de ce type disponible.

---

## Anomalies i18n (FR) — récurrentes sur tous les écrans auth

Ces 14 occurrences semblent provenir d'un batch de clés de traduction sans accents dans `messages/fr.json` :

| Clé affichée | Attendu |
|---|---|
| "acceder" | "accéder" |
| "oublie" | "oublié" |
| "Donnees hebergees HDS" | "Données hébergées HDS" |
| "Reinitialiser" (×2) | "Réinitialiser" |
| "reinitialisation" (×2) | "réinitialisation" |
| "Retour a la connexion" | "Retour à la connexion" |
| "ete envoye" | "été envoyé" |
| "Medicaments" (nav) | "Médicaments" |
| "Parametres" (nav) | "Paramètres" |
| "Deconnexion" | "Déconnexion" |
| "Insulinotherapie" | "Insulinothérapie" |
| "Compte temporairement bloque" | "bloqué" |
| "Reessayez" | "Réessayez" |

---

## Non couvert dans cette session

- **Effets base** (sessions, audit_logs, verification_token) — nécessite accès DB ou écran `/audit`. Non vérifiés.
- **MFA** — aucun compte seed avec MFA activée. Scénario non exécutable.
- **US-2112b AC-3** (alerte langue post-login) — nécessite `User.language=ar` en seed.
- **Compte suspendu (status≠active)** — non testé (requiert modification du seed ou endpoint admin).
- **Token MFA expiré** — non testé (MFA N/A).

---

## Annexe — captures d'écran

| Fichier | État capturé |
|---|---|
| `auth_login_affichage-initial.jpg` | Page `/login` vide FR, bouton disabled |
| `auth_medecin_connexion-doctor-succes.jpg` | Dashboard médecin après login DOCTOR |
| `auth_login_identifiants-invalides.jpg` | Bannière jaune "Identifiants invalides" |
| `auth_reset-password_affichage-initial.jpg` | Page `/reset-password` vide FR |
| `auth_reset-password_succes-email-existant.jpg` | Message succès générique après reset |
| `auth_login_switcher-ar-rtl.jpg` | Login en AR, `dir="rtl"` confirmé |
| `auth_login_lockout-429.jpg` | Bannière rouge lockout + countdown + champs disabled |

## Recommandations

1. **i18n** : passer en revue `messages/fr.json` — tous les accents (é, è, ê, à, â) semblent absents. Script de lint recommandé.
2. **Middleware redirect** : ajouter redirection `/login → /home-du-rôle` si `diabeo_token` valide, pour éviter qu'un utilisateur authentifié voie le formulaire de login.
3. **AC-3 US-2112b** : ajouter au seed un utilisateur avec `User.language=ar` pour couvrir le scénario alerte de langue au prochain run.
