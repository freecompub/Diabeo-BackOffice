# US-2112b — Préférence de langue utilisateur (switcher hors-auth + persistance + confirmation au login)

> Follow-up de [US-2112](./US-2112-internationalisation-fr-ar.md) (i18n FR/EN/AR, DONE).
> US-2112 a livré le moteur i18n (next-intl, `LocaleSwitcher`, cookie `diabeo_locale`,
> `dir="rtl"` pour AR). Cette US comble trois manques d'**accès** et de **persistance**
> identifiés en revue : le switcher n'est exposé sur aucun écran de l'app vivante, la
> langue n'est pas enregistrée comme préférence durable, et un écart langue-session vs
> préférence n'est pas signalé à la connexion.

---

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2112b` |
| **Référence inventaire** | `FN-112` (extension) |
| **Domaine** | 13. Multi-pays & i18n |
| **Priorité** | **V1** |
| **Pays cible** | Universel |
| **Intégration externe** | Non |
| **Service / Standard** | Interne (next-intl) |
| **Modèle économique** | Interne |
| **Coût estimé** | — |
| **Statut** | 🆕 À démarrer |
| **Story points** | **3** (Fibonacci) |
| **Dépendances** | US-2112 (i18n FR/EN/AR, DONE) · US-2101 (préférences compte) |
| **Sprint cible** | À définir lors du planning |
| **Owner** | À assigner |

---

## 📋 Contexte métier

### Pourquoi cette fonctionnalité ?

Le moteur i18n (US-2112) est fonctionnel mais **inatteignable en pratique** :

1. **Écrans non authentifiés** (login, mot de passe oublié, reset, invitation, MFA) :
   aucun moyen de changer la langue. Un utilisateur arabophone ou anglophone arrive
   sur un écran de connexion en français sans recours.
2. **Persistance** : le composant `LocaleSwitcher` n'écrit qu'un **cookie**
   (`diabeo_locale`). La colonne `User.language` (enum `fr|en|ar`, défaut `fr`) existe
   déjà en base mais **n'est pas alimentée** : la préférence est perdue au changement
   de device / navigateur / vidage de cookies. Par ailleurs le seul `LocaleSwitcher`
   est monté dans `components/diabeo/Sidebar.tsx`, composant **non rendu** par le shell
   actif (`NavigationShell`) → invisible pour l'utilisateur final.
3. **Cohérence au login** : un utilisateur peut se connecter depuis un appareil dont le
   cookie locale diffère de sa préférence enregistrée (ex. préférence `ar` en base,
   cookie `fr` sur un poste partagé). Aucune réconciliation n'est proposée.

### Personas concernés

- **Tous les rôles** (ADMIN / DOCTOR / NURSE / VIEWER) et **les visiteurs non
  authentifiés** (écrans `(auth)`).

### Valeur produit

- **Accessibilité & inclusion** : choix de langue dès le premier écran (RGAA / marché DZ arabophone).
- **Continuité** : la langue suit l'utilisateur entre appareils (préférence serveur).
- **Confiance** : pas de bascule de langue silencieuse et déroutante au login.

---

## ✅ Critères d'acceptation

### AC-1 — Switcher de langue sur les écrans NON authentifiés
- **Étant donné** un visiteur non connecté sur `/login` (ou reset / forgot / invitation / MFA),
- **Quand** il ouvre le sélecteur de langue rendu dans le layout `(auth)`,
- **Alors** il peut choisir FR / EN / AR ; la sélection pose le cookie `diabeo_locale`
  (pas d'appel authentifié requis), recharge la page, applique les messages et
  `dir="rtl"` pour AR.
- Le composant respecte l'accessibilité (label associé, `aria-label`, restauration du
  focus post-reload — déjà géré par `LocaleSwitcher`).

### AC-2 — Changement de langue persisté en base (écrans authentifiés / Settings)
- **Étant donné** un utilisateur authentifié sur `/settings`,
- **Quand** il change sa langue dans une section dédiée,
- **Alors** la préférence est **enregistrée en base** dans `User.language` **ET** le
  cookie `diabeo_locale` est synchronisé (affichage immédiat), avec un audit
  `UPDATE / USER` (`metadata.setting = "locale"`, sans PHI).
- **Et** à la prochaine connexion depuis n'importe quel appareil, c'est `User.language`
  qui fait foi pour initialiser la langue (le cookie est (re)posé à partir de la
  préférence au login).

### AC-3 — Alerte de confirmation si langue de session ≠ préférence enregistrée
- **Étant donné** un utilisateur dont `User.language` diffère de la locale active
  (cookie `diabeo_locale`) au moment du login,
- **Quand** la session est établie,
- **Alors** une **alerte non bloquante** (`role="alert"`, dismissible) lui demande de
  **confirmer le changement de langue** : « Vous étiez en {langueSession}, votre
  préférence est {languePréférée}. Continuer en {langueSession} / Revenir à
  {languePréférée} ? »
- **Confirmer (langueSession)** met à jour `User.language` = langue de session (AC-2).
  **Revenir (préférence)** repose le cookie sur `User.language` et recharge.
- L'alerte ne s'affiche **pas** quand cookie == préférence (cas nominal).

---

## 📐 Règles métier

- **RM-1** — Source de vérité : pour un utilisateur authentifié, `User.language` est la
  préférence durable ; le cookie `diabeo_locale` est le véhicule d'affichage (rechargé
  depuis la préférence au login). Pour un visiteur non authentifié, seul le cookie existe.
- **RM-2** — Langues supportées : `fr`, `en`, `ar` (enum `Language`). Toute valeur hors
  enum est rejetée (Zod) et retombe sur `defaultLocale = fr`.
- **RM-3** — L'écriture de `User.language` exige une session authentifiée ; le switcher
  hors-auth (AC-1) ne touche jamais la base (cookie uniquement).
- **RM-4** — L'alerte AC-3 est **non bloquante** : l'utilisateur peut l'ignorer sans
  perdre l'accès ; à défaut de choix, la langue de session (cookie) reste active et la
  préférence en base est inchangée.
- **RM-5** — Aucune donnée de santé : la langue n'est pas une donnée sensible ; elle est
  toutefois incluse dans l'export RGPD Art. 15 et la suppression Art. 17 (déjà couvert
  par `User`).

---

## 🗄️ Modèle de données

### Schéma Prisma indicatif

La colonne **existe déjà** — aucune migration nécessaire :

```prisma
enum Language {
  fr
  en
  ar
}

model User {
  // ...
  language Language? @default(fr) // préférence de langue (AC-2) — déjà présent
}
```

### Notes de migration

- **Aucune migration** : `User.language` (enum `Language`, défaut `fr`) est déjà dans
  `prisma/schema.prisma`. L'US ne fait que **câbler** la lecture/écriture de ce champ.
- Cohérence iOS : aligner le mapping `Language` ↔ locale app patient (`fr`/`en`/`ar`)
  avec le dépôt Swift (modèles de données partagés).

---

## 🔌 API & contrats

### Routes exposées

| Méthode | Endpoint | Auth | Rôles | Description |
|---------|----------|------|-------|-------------|
| PUT | `/api/account/locale` | JWT | Tous | **Étendu** : pose le cookie `diabeo_locale` **+** persiste `User.language` (aujourd'hui : cookie seul). |
| GET | `/api/account/locale` | JWT | Tous | (nouveau) Renvoie `{ preference: User.language, active: cookieLocale }` pour la détection d'écart AC-3. |

> Le switcher hors-auth (AC-1) **n'appelle pas** ces routes : il pose le cookie
> directement côté client (aucun endpoint public n'est créé — pas de surface non
> authentifiée nouvelle).

### Validation des entrées (Zod)

```ts
const putLocaleSchema = z.object({ locale: z.enum(["fr", "en", "ar"]) })
```

### Format de réponse standard

```jsonc
// PUT /api/account/locale → 200
{ "locale": "ar", "persisted": true }
// GET /api/account/locale → 200
{ "preference": "ar", "active": "fr", "mismatch": true }
```

---

## ⚠️ Scénarios d'erreur

| HTTP | Code applicatif | Message utilisateur | Comportement |
|------|-----------------|---------------------|--------------|
| 400 | `validationFailed` | Langue non supportée | Locale hors enum `fr/en/ar` |
| 401 | `unauthenticated` | Veuillez vous connecter | PUT/GET `/api/account/locale` sans JWT (le switcher hors-auth, lui, n'appelle pas l'API) |
| 500 | `serverError` | Erreur interne | Échec persistance → le cookie reste posé (dégradation gracieuse), log + retry |

---

## 🔒 Sécurité & conformité HDS

- **Cookie** `diabeo_locale` : `httpOnly:false` (lisible par le switcher client), `SameSite=Lax`, `Secure` en prod, pas de donnée sensible.
- **Audit** : changement de préférence loggé `UPDATE / USER` (`metadata.setting="locale"`), sans PHI.
- **RGPD** : `User.language` inclus dans l'export Art. 15 et la suppression Art. 17.
- **Pas de nouvelle route publique** : l'AC-1 reste 100 % côté client (cookie), aucune surface non authentifiée ajoutée.
- **Anti-spoof** : `User.language` n'est écrit que via session JWT valide (RM-3).

---

## 🧪 Plan de test 3 niveaux

### Tests unitaires (Vitest)
- [ ] `LocaleSwitcher` : changement → pose cookie + reload ; valeur hors enum ignorée ; focus restauré post-reload (sentinel TTL).
- [ ] Helper de détection d'écart (AC-3) : `mismatch` vrai ssi `cookie !== preference` et préférence non nulle.
- [ ] Zod `putLocaleSchema` accepte fr/en/ar, rejette le reste.

### Tests d'intégration (Vitest + Prisma)
- [ ] `PUT /api/account/locale` persiste `User.language` **et** pose le cookie + audit `UPDATE/USER`.
- [ ] `GET /api/account/locale` renvoie `{ preference, active, mismatch }`.
- [ ] Login : le cookie `diabeo_locale` est (re)posé depuis `User.language`.
- [ ] 401 sans JWT ; 400 locale invalide.

### Tests E2E (Playwright)
- [ ] Écran `/login` non authentifié : le switcher change la langue (FR→AR), `dir="rtl"` appliqué.
- [ ] Settings : changement langue persiste après logout/login sur un cookie vidé.
- [ ] Login avec cookie ≠ préférence : l'alerte AC-3 s'affiche ; « Revenir » restaure la préférence ; « Continuer » met à jour la base.

---

## 🏁 Définition de Done

- [ ] AC-1/2/3 satisfaits, 3 niveaux de tests verts (couverture ≥ 80 % sur le code ajouté).
- [ ] `LocaleSwitcher` exposé dans le layout `(auth)` **et** dans `NavigationShell` (variant `compact`) — le composant `Sidebar` mort n'est plus la seule porte.
- [ ] `PUT /api/account/locale` persiste `User.language` ; login repose le cookie depuis la préférence.
- [ ] i18n des nouveaux libellés (alerte AC-3, section langue Settings) en fr/en/ar + `dir=rtl`.
- [ ] Accessibilité : `role="alert"` dismissible, labels ARIA, focus management (WCAG 2.4.3 / 4.1.2).
- [ ] Audit + export/suppression RGPD couvrent `language`.
- [ ] Revue code-reviewer + (si surface auth touchée) healthcare-security-auditor.

---

## 📎 Ressources

- `src/components/diabeo/LocaleSwitcher.tsx` (composant existant, US-2112)
- `src/components/diabeo/NavigationShell.tsx` (shell actif — à enrichir du switcher)
- `src/app/(auth)/layout.tsx` (layout non authentifié — cible AC-1)
- `src/app/api/account/locale/route.ts` (PUT cookie — à étendre vers `User.language`)
- `src/i18n/request.ts` (résolution serveur via cookie `diabeo_locale`)
- `prisma/schema.prisma` → `enum Language`, `User.language`
- [US-2112 — Internationalisation FR/AR](./US-2112-internationalisation-fr-ar.md)
- [US-2101 — Préférences de compte](../03-profil-preferences/) (préférences utilisateur)
