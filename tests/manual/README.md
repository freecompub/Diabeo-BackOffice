# Tests manuels / exploratoires

Tests **NON exécutés par la CI**, destinés au debug local en cours de
développement par dev ou Claude. Pour les régressions automatisées,
voir `tests/unit/` (Vitest) et `tests/e2e/` (Playwright).

## Conventions de nommage

| Type | Pattern | Pourquoi |
|---|---|---|
| Scénarios Playwright `headed` | `<feature>.spec.ts` | Le `testDir: ./tests/e2e` de `playwright.config.ts` ne ramasse PAS `tests/manual/` — safe. **Ne JAMAIS nommer en `.test.ts`** : Vitest ramasse `tests/**/*.test.{ts,tsx}`. |
| Smoke tests curl/shell | `<feature>.smoke.sh` | Pas de pattern test reconnu, ignoré par les deux runners. |
| Fixtures synthétiques | `<feature>.fixture.ts` | Idem, ignoré. |
| Plans de test markdown | `<feature>.plan.md` | Documentation pas-à-pas pour test humain dans le navigateur. |

## Lancement

```bash
# Playwright headed (navigateur visible)
pnpm exec playwright test tests/manual/<feature>.spec.ts --headed --project=chromium

# Smoke curl
bash tests/manual/<feature>.smoke.sh

# Plan markdown — juste à lire dans ton éditeur
```

## Pré-requis

Avant de lancer un test manuel, démarrer le stack local :

```bash
docker compose --profile local up      # PostgreSQL 16 local
pnpm prisma migrate deploy             # Applique les migrations
pnpm prisma db seed                    # 5 users + 2 patients + 30j CGM
pnpm dev                               # Next.js sur localhost:3000
```

Comptes seedés (cf. `docs/local-development.md` §6) :

| Email | Password | Rôle |
|---|---|---|
| `admin@diabeo.test` | `DEV-ONLY-Admin123!` | ADMIN |
| `docteur@diabeo.test` | `DEV-ONLY-Doctor123!` | DOCTOR |
| `infirmiere@diabeo.test` | `DEV-ONLY-Nurse123!` | NURSE |
| `patient.dt1@diabeo.test` | `DEV-ONLY-Patient123!` | VIEWER (DT1) |
| `patient.dt2@diabeo.test` | `DEV-ONLY-Patient123!` | VIEWER (DT2) |

## Garde-fous CI

- ✅ `playwright.config.ts:16` — `testDir: "./tests/e2e"` — limite stricte à `tests/e2e/`
- ⚠️ `vitest.config.ts:9` — `include: ["tests/**/*.test.{ts,tsx}"]` — **inclut tout `tests/**`** → respecter le pattern `.spec.ts` ici, pas `.test.ts`

Si une feature finit par mériter une couverture pérenne, déplacer le
`.spec.ts` vers `tests/e2e/` (ou réécrire en `.test.ts` dans
`tests/unit/`) après revue.
