# Tests BDD (Gherkin exécutable) — preuve de concept

Harness **[playwright-bdd](https://github.com/vitalets/playwright-bdd)** qui rend
les scénarios Gherkin du plan QA (`docs/qa/`) **directement exécutables**.

> Rangé avec les tests **manuels** : pas de `webServer`, **jamais en CI**.
> Suppose un `pnpm dev` lancé + une base seedée. C'est une POC à étendre, pas
> (encore) une suite de non-régression bloquante.

## Pourquoi

Décision QA : *doc = test*. Les blocs `Given/When/Then` de `docs/qa/*.md` sont
recopiés en `.feature` ici, et exécutés par Playwright via des **step
definitions réutilisables** — pas de second runner à maintenir (on réutilise le
runner Playwright + le helper `loginAs`).

## Arborescence

```
tests/manual/bdd/
  features/                       # .feature (Gherkin FR, # language: fr) — 15 scénarios
    login.feature                 # ← docs/qa/01-auth.md (connexion)
    auth/reset-password.feature   # ← docs/qa/01-auth.md (mot de passe oublié)
    dashboard-access.feature      # ← docs/qa/02-dashboards.md
    rbac/redirects.feature        # ← 02-dashboards / 06-admin / 12-communication (RBAC + A5)
    settings/rbac.feature         # ← docs/qa/05-settings.md (PS vs patient)
    effet-base/login-session.feature  # ← docs/qa/01-auth.md (vérif EFFET BASE)
  steps/                          # step definitions (réutilisables)
    auth.steps.ts                 # "je suis connecté en tant que {string}" → loginAs()
    login.steps.ts                # steps de l'écran connexion (data-testid)
    navigation.steps.ts           # "je vais sur / je suis redirigé vers / je reste sur / je vois (pas) le titre"
    page.steps.ts                 # "je vois l'élément / je remplis le champ / je clique / je vois le texte"
    db.steps.ts                   # "une session active existe en base pour {string}" — VÉRIF EFFET BASE (pg)
playwright.bdd.config.ts          # config (racine du repo) — pas de webServer
```

> **Vérification « effet base »** (`db.steps.ts`) : ce step interroge directement
> PostgreSQL (driver `pg`, `.env` chargé via `dotenv`) pour valider la ligne
> `# Effet base:` d'un scénario (ici : la connexion a bien créé une ligne
> `sessions`). C'est ce qui distingue ces tests d'un simple test d'UI.

Le dossier `.features-gen/` (specs générées depuis les `.feature`) est
**gitignoré** : il est régénéré par `bddgen`.

## Pré-requis

1. **Base seedée** (utilisateurs de seed, cf. `docs/qa/README.md` §4) :
   ```bash
   docker compose --profile local up -d postgres
   pnpm prisma migrate deploy && pnpm prisma db seed
   ```
2. **Dev server lancé** : `pnpm dev` (http://localhost:3000).
3. **Navigateur** : un Chromium complet. Sur un poste de dev classique :
   ```bash
   pnpm exec playwright install chromium --with-deps
   ```
   ⚠️ **Sandbox sans GUI / sans root** : Chromium SIGTRAP sur les pages lourdes
   s'il manque les polices + libs `cairo`/`pango`. Installer les `.deb` en
   rootless (`apt-get download` → `dpkg-deb -x`) et exporter `LD_LIBRARY_PATH` +
   `FONTCONFIG_FILE` avant de lancer (voir la mémoire projet « Manual tests env »).

## Lancer

```bash
pnpm bdd:gen     # génère les specs depuis les .feature (dossier .features-gen)
pnpm bdd:test    # bddgen + exécution Playwright
```

Ciblage d'un seul fichier :

```bash
pnpm bdd:gen
pnpm exec playwright test --config playwright.bdd.config.ts \
  .features-gen/tests/manual/bdd/features/login.feature.spec.js
```

> **État frais entre rejeux** : le scénario « identifiants invalides » incrémente
> le rate-limit de connexion (in-memory dans le dev server sans Redis configuré).
> Après plusieurs rejeux complets, un lockout IP peut faire échouer le `loginAs`
> de scénarios suivants. → relancer `pnpm dev` (purge le compteur in-memory) ou
> attendre la fin de la fenêtre (≈ 1 min) avant un nouveau run complet. En CI
> (un seul run sur base/serveur frais) le souci ne se pose pas.

## Étendre

1. Copier un bloc Gherkin depuis `docs/qa/*.md` dans un nouveau `.feature`.
2. Réutiliser les steps existants ; pour un nouveau geste, ajouter un step dans
   `steps/` (préférer un **`data-testid`** à un libellé FR pour être robuste à
   l'i18n).
3. `pnpm bdd:test`.

### Prochaines étapes recommandées (hors POC)

- **Vérification « effet base »** : ajouter `steps/db.steps.ts` qui interroge
  PostgreSQL (client Prisma en lecture) pour valider les lignes
  `# Effet base:` des scénarios (ex. `appointments.status='cancelled'`,
  présence d'une ligne `audit_logs`). C'est ce qui distingue ce harness d'un
  simple test d'UI.
- **Reset déterministe** entre features d'écriture (transaction rollback ou
  `prisma migrate reset`) pour l'idempotence.
- **`data-testid`** systématiques sur les écrans à automatiser.
