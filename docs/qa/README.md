# Plan de tests QA — Diabeo Backoffice

> **Lot 1 (cœur MVP)** — 13 écrans · **Lot 2** — 25 écrans. **Couverture
> complète des ~38 écrans de l'application.**
>
> Source des faits : lecture du code réel (composants + routes API + services)
> au 2026-06-05. Chaque « effet base » est tracé jusqu'au fichier qui le produit.

## 1. Objet

Ce document décrit, **pour chaque écran** :

1. **Affichage attendu** — ce qui doit être à l'écran (éléments, états vide /
   chargement / erreur), sous forme de tableau lisible par un testeur humain.
2. **Actions possibles** — chaque action utilisateur, l'endpoint API appelé,
   l'**effet visuel** (ce qui change à l'écran) et l'**effet en base** (tables
   PostgreSQL écrites + événement audit).
3. **Scénarios Gherkin** — `Given / When / Then` directement exécutables par un
   bot (voir §5 Stratégie d'automatisation). La ligne `# Effet base:` documente
   l'attendu côté base pour vérification.
4. **Cas limites** — erreurs, RBAC, anti-énumération, RGPD.

Les tests sont joués **soit par un humain** (le tableau + les `Then` suffisent),
**soit par un bot** (les blocs Gherkin sont le contrat d'automatisation).

## 2. Découpage des fichiers

**Lot 1 — cœur MVP**

| Fichier | Écrans |
|---|---|
| [`01-auth.md`](01-auth.md) | `/login`, `/reset-password` |
| [`02-dashboards.md`](02-dashboards.md) | `/medecin`, `/infirmier`, `/patient/dashboard` |
| [`03-patients.md`](03-patients.md) | `/patients`, `/patients/[id]`, `/patients/new` |
| [`04-appointments.md`](04-appointments.md) | `/appointments` |
| [`05-settings.md`](05-settings.md) | `/settings` |
| [`06-admin.md`](06-admin.md) | `/admin/users`, `/admin/users/[id]`, `/admin/cabinets` (+ `[id]`) |

**Lot 2 — reste de l'application**

| Fichier | Écrans |
|---|---|
| [`07-dashboards-analytics.md`](07-dashboards-analytics.md) | `/`, `/dashboard`, `/analytics`, `/analytics/radar`, `/weekly` |
| [`08-admin-ops.md`](08-admin-ops.md) | `/audit`, `/admin`, `/admin/backups`, `/admin/system-health` |
| [`09-admin-compliance-billing.md`](09-admin-compliance-billing.md) | `/admin/data-breaches` (+`[id]`), `/admin/invoices` (+`[id]`), `/admin/tax-rules` |
| [`10-devices-documents-events.md`](10-devices-documents-events.md) | `/devices`, `/devices/pair`, `/documents`, `/events/new` |
| [`11-clinical.md`](11-clinical.md) | `/insulin-therapy`, `/adjustment-proposals`, `/medications`, `/import` |
| [`12-communication.md`](12-communication.md) | `/messages`, `/patient/appointments`, `/users` (legacy) |

## 2bis. Anomalies relevées (à trier par l'équipe)

Détectées pendant l'extraction des faits — à confirmer puis corriger hors de ce plan QA :

| # | Écran | Anomalie |
|---|---|---|
| A1 | `/login` | Lien « Créer un compte » → `/register`, **page inexistante** (404). |
| A2 | `/insulin-therapy` | ✅ **Corrigé** — durée d'action alignée en **heures** (UI envoyait des minutes à une API en heures → 400). |
| A2b | `/insulin-therapy` | ⚠️ **Découvert pendant A2** — sauvegarde des paramètres cassée end-to-end : (1) `deliveryMethod` manquant dans le body → **400** ; (2) `upsertSettings` écrit des colonnes inexistantes → **500** (masqué par les mocks) ; (3) la durée saisie n'alimente pas l'IOB (`IobSettings.actionDurationHours` séparé). Suivi data-model dédié (`prisma-specialist` + `medical-domain-validator`). |
| A3 | (transverse) | **Bornes cliniques `CLAUDE.md` périmées** vs `clinical-bounds.ts` (ISF/ICR/Basal). Le code fait foi. |
| A4 | `/adjustment-proposals` | Valeur hors bornes à l'acceptation → **500** au lieu de 400/422. |
| A5 | `/users` | **Doublon legacy** de `/admin/users` (stub « Bientôt disponible ») → supprimer/rediriger. |

## 3. Conventions & légende

| Symbole | Signification |
|---|---|
| 🟢 **Réel** | L'écran lit/écrit les vraies routes API + base. |
| 🟡 **DEMO_DATA** | L'écran affiche des **données synthétiques** en dur (`DEMO_*`). La route API existe et est testable séparément (au niveau contrat API), mais l'UI ne la consomme pas encore. À tester en 2 volets : *affichage (demo)* vs *contrat API (réel)*. |
| ⚠️ **Anomalie** | Comportement à corriger, relevé pendant la rédaction. |
| `# Effet base:` | Ligne de commentaire Gherkin décrivant l'écriture base + audit attendus. |

**Rôles RBAC** : `ADMIN > DOCTOR > NURSE > VIEWER`. Le middleware injecte
`x-user-id` / `x-user-role` ; chaque route revalide via `requireRole`.

**Effets base transverses** (valables pour quasi toutes les actions d'écriture) :

- Toute donnée de santé / PII est **chiffrée AES-256-GCM** (base64) avant
  insertion ; jamais en clair en base ni en logs.
- Toute action sensible écrit une ligne **`audit_logs`** (immuable par trigger)
  avec `userId, action, resource, resourceId, metadata.patientId?, ipAddress,
  userAgent`.
- Les patients sont en **soft-delete** (`deletedAt`) — jamais de DELETE physique.

## 4. Comptes & données de seed (environnement QA)

Seed déterministe (`prisma/seed.ts`, voir `pnpm prisma db seed`) :

| Rôle | Email | Mot de passe |
|---|---|---|
| ADMIN | `admin@diabeo.test` | `DEV-ONLY-Admin123!` |
| DOCTOR | `docteur@diabeo.test` | `DEV-ONLY-Doctor123!` |
| NURSE | `infirmiere@diabeo.test` | `DEV-ONLY-Nurse123!` |
| VIEWER (patient DT1) | `patient.dt1@diabeo.test` | `DEV-ONLY-Patient123!` |
| VIEWER (patient DT2) | `patient.dt2@diabeo.test` | `DEV-ONLY-Patient123!` |

> Helper d'auth automatisé : `tests/e2e/helpers/auth.ts` → `loginAs(context, request, role)`
> (login API + injection cookie httpOnly `diabeo_token`).

## 5. Stratégie d'automatisation (recommandation : Gherkin + Playwright-BDD)

### 5.1. Choix d'outillage

Décision retenue : **Gherkin exécutable**. Recommandation d'implémentation :
**[`playwright-bdd`](https://github.com/vitalets/playwright-bdd)** plutôt que
`cucumber-js` pur, car il :

- réutilise tel quel l'existant : `playwright.manual.config.ts`, le runner
  Playwright, les traces/screenshots, et surtout le helper `loginAs` ;
- exécute les `.feature` directement (les blocs Gherkin de ce document
  deviennent la source de vérité — *doc = test*) ;
- évite la double config (Cucumber a son propre runner, ses reporters, son
  glue ; playwright-bdd génère des specs Playwright à partir des `.feature`).

> Alternative `cucumber-js` : viable mais ajoute un runner parallèle à
> maintenir. À ne retenir que si l'équipe a déjà un existant Cucumber.

### 5.2. Arborescence cible

```
tests/
  bdd/
    features/                 # .feature extraits 1:1 de docs/qa/*.md
      auth/login.feature
      patients/create.feature
      appointments/create.feature
      ...
    steps/                    # step definitions réutilisables
      auth.steps.ts           # Given je suis connecté en tant que "DOCTOR"
      navigation.steps.ts     # When je vais sur "/appointments"
      form.steps.ts           # When je remplis "#create-motif" avec "..."
      assertions.steps.ts     # Then je vois "✓ Rendez-vous créé avec succès"
      db.steps.ts             # Then la table "appointments" contient ... (effet base)
    playwright-bdd.config.ts
```

### 5.3. Conventions à mettre en place (pré-requis automatisation)

1. **`data-testid` stables** sur les éléments clés (boutons d'action, lignes de
   liste, badges de statut, bannières d'erreur/succès, champs de formulaire).
   Aujourd'hui les specs manuelles ciblent des classes Schedule-X (`.sx__*`) et
   des libellés FR — fragile à l'i18n. Ajouter `data-testid` rend les steps
   indépendants de la langue.
2. **Seed QA déterministe** (déjà en place) + un **reset base entre features**
   d'écriture (`prisma migrate reset --force` ou transaction rollback) pour
   l'idempotence — cf. le bug de double-booking corrigé sur la spec manuelle
   `appointments-create`.
3. **Vérification « effet base »** : un step `db.steps.ts` qui interroge
   PostgreSQL (Prisma client en lecture) pour valider l'`# Effet base:` du
   scénario (ex. `appointments.status = 'cancelled'`, présence d'une ligne
   `audit_logs`). C'est ce qui distingue ce plan d'un simple test d'UI.

### 5.4. Où un bot LLM apporte de la valeur

| Tâche | Valeur LLM |
|---|---|
| **Génération initiale des step definitions** | Élevée — mapping `.feature` → Playwright. |
| **Maintenance des sélecteurs** | Moyenne — proposer le `data-testid` quand un libellé change. |
| **Triage des échecs** | Élevée — lire la trace + le screenshot et classer *bug applicatif* vs *bug de test* (cf. les 2 specs manuelles : format locale + race, qui étaient des bugs de test, pas d'app). |
| **Exploration d'écran non couvert** | Élevée — proposer de nouveaux scénarios à partir du composant + de la route. |

> ⚠️ Un bot ne décide pas seul d'un *attendu clinique* (bornes glycémiques,
> sécurité bolus) : ces scénarios sont validés par `medical-domain-validator` /
> un soignant. Le bot exécute et triage ; l'humain tranche le médical.

### 5.5. Intégration CI

- Les `.feature` d'écriture nécessitent une **base + dev server** → garder
  hors du job unit (`vitest`), dans un job dédié type
  `playwright.manual.config.ts` (pas de `webServer`, suppose un stack lancé) ou
  un job E2E avec `docker compose --profile local up` + seed.
- **Environnement navigateur** (sandbox sans GUI) : nécessite polices +
  libs (`cairo`/`pango`) — sinon Chromium SIGTRAP sur les pages lourdes. Voir
  le runbook interne d'exécution des tests manuels.

## 6. Modèle de cas de test (template par écran)

Chaque écran suit ce gabarit (voir les fichiers de domaine) :

```markdown
## Écran : <Nom> (`<route>`)   🟢/🟡
**Rôle / RBAC** : …
**Statut impl.** : 🟢 Réel | 🟡 DEMO_DATA

### Affichage attendu
| Élément | État attendu |
|---|---|

### Actions & effets
| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|

### Scénarios (Gherkin)
``​`gherkin
Feature: …
  Scenario: …
    Given …
    When …
    Then …
    # Effet base: …
``​`

### Cas limites
- …
```
