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
  features/                       # .feature (Gherkin FR, # language: fr)
    login.feature                 # ← docs/qa/01-auth.md
    dashboard-access.feature      # ← docs/qa/02-dashboards.md
  steps/                          # step definitions (réutilisables)
    auth.steps.ts                 # "je suis connecté en tant que {string}" → loginAs()
    login.steps.ts                # steps de l'écran connexion (data-testid)
    navigation.steps.ts           # "je vais sur {string}", "je suis redirigé vers {string}", "je vois le titre {string}"
playwright.bdd.config.ts          # config (racine du repo) — pas de webServer
```

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
