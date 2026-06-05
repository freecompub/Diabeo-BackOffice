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
  features/                       # .feature (Gherkin FR, # language: fr) — 50 scénarios
    login.feature                 # ← docs/qa/01-auth.md (connexion)
    auth/reset-password.feature   # ← docs/qa/01-auth.md (mot de passe oublié)
    dashboard-access.feature      # ← docs/qa/02-dashboards.md
    rbac/redirects.feature        # ← 02-dashboards / 06-admin / 12-communication (RBAC + A5)
    settings/rbac.feature         # ← docs/qa/05-settings.md (PS vs patient)
    patients/{list,detail,create}.feature      # ← docs/qa/03-patients.md (contrat API + effet base)
    appointments/{list,create,cancel}.feature  # ← docs/qa/04-appointments.md (contrat API + effet base)
    admin/{users,cabinets,audit}.feature        # ← docs/qa/06-admin.md + 08 (RBAC ADMIN, contrat API)
    effet-base/login-session.feature  # ← docs/qa/01-auth.md (vérif EFFET BASE)
  steps/                          # step definitions (réutilisables)
    auth.steps.ts                 # "je suis connecté en tant que {string}" → loginAs()
    login.steps.ts                # steps de l'écran connexion (data-testid)
    navigation.steps.ts           # "je vais sur / je suis redirigé vers / je reste sur / je vois (pas) le titre"
    page.steps.ts                 # "je vois l'élément / je remplis le champ / je clique / je vois le texte"
    api.steps.ts                  # "j'appelle GET / je POST … avec le JSON" → page.request (cookie auth)
    appointments.steps.ts         # "je crée un RDV pour le patient {int} et le membre {int}" / "j'annule…"
    db.steps.ts                   # vérif EFFET BASE (pg) : session active, compte patient créé, statut RDV…
    hooks.steps.ts                # Before : reset `world` + garde anti-prod (DATABASE_URL local uniquement)
    world.ts                      # état partagé entre steps (réponse API, email/RDV créé) — exécution série
playwright.bdd.config.ts          # config (racine du repo) — pas de webServer
```

> ⚠️ **Cucumber-expressions** : ne PAS mettre de parenthèses contenant un
> paramètre dans le texte d'un step (`… (membre {int})` casse tout le registre :
> « optional may not contain a parameter »). Utiliser `… et le membre {int}`.

> **Vérification « effet base »** (`db.steps.ts`) : ces steps interrogent
> directement PostgreSQL (driver `pg`, `.env` chargé via `dotenv`) pour valider la
> ligne `# Effet base:` d'un scénario (ex. la connexion a créé une ligne
> `sessions` ; la création patient a inséré `users`+`patients`). C'est ce qui
> distingue ces tests d'un simple test d'UI.
>
> **Contrat API** (`api.steps.ts`) : nombre de scénarios QA sont au niveau API
> (`Quand j'appelle GET "/api/…"` / `Alors le statut … est 200`) — exécutés via
> `page.request` qui hérite du cookie d'auth injecté par `loginAs`. Robuste (pas
> de sélecteur UI fragile).

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

> **État frais entre rejeux** : certains endpoints ont un rate-limit **in-memory**
> (dev server sans Redis configuré) qui s'accumule entre rejeux complets :
> `POST /api/auth/login` (scénario « identifiants invalides ») et `POST /api/patients`
> (anti-énumération). Après plusieurs runs, un 429 / lockout IP peut faire échouer
> le `loginAs` ou la création patient. → relancer `pnpm dev` (purge le compteur
> in-memory) avant un nouveau run complet. **En CI** (un seul run sur base/serveur
> frais) le souci ne se pose pas.
>
> Note : les scénarios d'**écriture** insèrent de vraies lignes à chaque run —
> **création patient** (`users`+`patients`, email horodaté `qa.bdd.*@diabeo.test`)
> et **création/annulation RDV** (`appointments`, créneau futur unique) — données
> de test synthétiques. ⚠️ Un simple `DELETE FROM users WHERE …` **échoue** (FK
> `audit_logs.user_id` + trigger d'**immutabilité** sur `audit_logs`). Pour
> repartir propre : `pnpm prisma migrate reset --force && pnpm prisma db seed`.
> Une **garde anti-prod** (`steps/hooks.steps.ts`) refuse toute `DATABASE_URL`
> non-locale pour éviter de créer de faux patients en staging/prod.

## Étendre

1. Copier un bloc Gherkin depuis `docs/qa/*.md` dans un nouveau `.feature`.
2. Réutiliser les steps existants ; pour un nouveau geste, ajouter un step dans
   `steps/` (préférer un **`data-testid`** à un libellé FR pour être robuste à
   l'i18n).
3. `pnpm bdd:test`.

### Prochaines étapes recommandées (hors POC)

- ✅ **Vérification « effet base »** : `steps/db.steps.ts` livré (interroge
  PostgreSQL via `pg`). À étendre à d'autres effets (ex. `appointments.status`,
  présence d'une ligne `audit_logs`) au fil des features d'écriture.
- **Reset déterministe** entre features d'écriture (transaction rollback ou
  `prisma migrate reset`) pour l'idempotence.
- **`data-testid`** systématiques sur les écrans à automatiser : les features
  assertent aujourd'hui des **libellés FR** (le dev server tourne en locale FR
  par défaut) ; des `data-testid` les rendraient indépendantes de l'i18n.
