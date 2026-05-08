# Runbook — Migrations Prisma (US-2267)

> Ce document remplace le workflow `prisma db push` historique.
> **Toute** modification de schéma passe désormais par `prisma migrate dev`.

---

## 1. Pré-requis

```bash
# Variables d'environnement (dev local)
export DATABASE_URL="postgresql://diabeo:password@localhost:5432/diabeo?schema=public"
# Optionnelle — uniquement pour `migrate diff --from-migrations` (CI drift check)
export SHADOW_DATABASE_URL="postgresql://diabeo:password@localhost:5432/diabeo_shadow?schema=public"
```

---

## 2. Workflow dev — créer une nouvelle migration

```bash
# 1. Modifier prisma/schema.prisma
# 2. Créer la migration (applique sur la DB locale ET génère le SQL versionné)
pnpm prisma migrate dev --name <feature_short_name>

# Ex: pnpm prisma migrate dev --name add_patient_pregnancy_mode
```

Effet :
- Crée `prisma/migrations/<timestamp>_<feature_short_name>/migration.sql`
- Applique la migration sur la DB locale
- Régénère le client Prisma (`pnpm prisma generate`)

⚠️ **Toujours commiter le dossier de migration créé** dans la même PR que les changements de schéma.

---

## 3. Workflow CI

CI exécute (`.github/workflows/ci.yml` job `test-e2e`) :

```bash
pnpm prisma migrate deploy   # applique migrations en mode prod (idempotent)
pnpm prisma db seed          # injecte données de test
```

Un job dédié `migrations-check` exécute :

```bash
pnpm prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma \
  --exit-code
# Exit 0 = pas de drift, Exit 2 = drift détecté → CI fail
```

→ Bloque le merge si quelqu'un modifie `schema.prisma` sans créer la migration correspondante.

---

## 4. Workflow prod (deploy.sh)

```bash
# Avant US-2267 (deprecated) :
# pnpm prisma db push --accept-data-loss=false

# Après US-2267 :
pnpm prisma migrate deploy
```

`migrate deploy` est :
- **idempotent** : ne ré-applique pas une migration déjà passée
- **transactionnel** : chaque `migration.sql` tourne dans une seule transaction (sauf DDL non-transactionnel comme `CREATE INDEX CONCURRENTLY`)
- **sans shadow DB** : pas besoin de `SHADOW_DATABASE_URL` en prod

---

## 5. Plan de rollback

### Cas 1 — Migration récemment passée, données préservables

```bash
# 1. Identifier la dernière migration
pnpm prisma migrate status

# 2. Rollback ciblé (Prisma ne fournit PAS de rollback automatique)
#    → écrire un script SQL inverse à la main et l'appliquer manuellement
psql $DATABASE_URL < ops/rollback/<timestamp>_<feature>_down.sql

# 3. Marquer la migration comme rolled-back dans _prisma_migrations
pnpm prisma migrate resolve --rolled-back <timestamp>_<feature>
```

### Cas 2 — Restauration depuis dump (data corruption ou rollback massif)

```bash
# 1. Restaurer le dernier dump nightly OVH (S3 ou local)
./deploy.sh restore-from-dump <date>

# 2. Vérifier l'état des migrations restaurées
pnpm prisma migrate status

# 3. Si l'app a été déployée avec une nouvelle migration entre dump et incident :
#    appliquer manuellement le SQL versionné jusqu'à l'état souhaité
```

---

## 6. Cas particuliers

### 6.1 — Partitioning CGM (`prisma/sql/cgm_partitioning.sql`)

⚠️ **Pas inclus dans les migrations versionnées.**

Raison : la conversion d'une table `cgm_entries` regular vers partitionnée
modifie sa primary key (composite `id, timestamp`) et ses indexes — Prisma ne
peut pas modéliser PostgreSQL partitioning, donc inclure ce script dans une
migration crée un drift permanent vs `schema.prisma`.

À appliquer manuellement **uniquement quand le volume CGM le justifie** (>10M
entries) :

```bash
psql $DATABASE_URL < prisma/sql/cgm_partitioning.sql
```

Suivre avec un test E2E `getCgmEntries` pour vérifier que Prisma lit bien
les partitions.

### 6.2 — Scripts SQL historiques (`prisma/sql/*.sql`)

Les scripts suivants ont été **intégrés à la migration `20260508140000_post_deploy_sql`** :
- `audit_immutability.sql`
- `audit_retention.sql`
- `basal_config_check.sql`
- `emergency_alerts_constraints.sql`
- `patient_insulin_constraints.sql`

Les scripts suivants ont été **superseded par la baseline_v1** (les colonnes/types
qu'ils introduisaient sont maintenant dans `schema.prisma`) :
- `add_user_hmac_fields.sql`
- `add_user_photo_url.sql`
- `audit_log_request_id.sql`
- `mfa_hardening.sql`
- `period_type_enum.sql`

→ Ces scripts restent dans `prisma/sql/` à titre historique mais **ne doivent plus être appliqués** sur une DB neuve (la baseline les couvre).

---

## 7. Switch d'une DB existante (db push → migrate)

Pour une DB qui tourne déjà avec `db push` (ex: recette pré-US-2267) :

```bash
# 1. Marquer la baseline comme déjà appliquée (sans la rejouer)
pnpm prisma migrate resolve --applied 20260508135636_baseline_v1
pnpm prisma migrate resolve --applied 20260508140000_post_deploy_sql

# 2. Vérifier
pnpm prisma migrate status
# → "Database schema is up to date"

# 3. Continuer avec le workflow standard `migrate dev` / `migrate deploy`
```

⚠️ **À faire UNE seule fois par DB existante**, idéalement pendant une fenêtre
de maintenance, pour éviter qu'un déploiement concurrent fasse `migrate deploy`
qui chercherait à appliquer la baseline.
