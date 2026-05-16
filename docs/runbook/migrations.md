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
# 1. Restaurer le dernier dump nightly OVH (procédure manuelle).
#    Le dump nightly est sur OVH Object Storage (bucket diabeo-backups-prod,
#    cron systemd unit pg-dump-nightly). `./deploy.sh restore-from-dump` n'est
#    PAS encore implémenté — utiliser psql en direct :
aws s3 cp s3://diabeo-backups-prod/<YYYY/MM/DD>/diabeo-backup-<HH>.sql.gz - \
  --endpoint-url=https://s3.gra.io.cloud.ovh.net | gunzip | psql $DATABASE_URL

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

### 7.1 — Vérifier l'état du schéma AVANT de marquer comme appliqué

⚠️ **Étape critique HDS** : `migrate resolve --applied` ne ré-applique PAS le SQL —
il marque juste la migration comme passée. Si la DB existante n'a pas tous les
objets DDL du `post_deploy_sql` (trigger d'immuabilité audit, fonction de
rétention, CHECK constraints), les marquer comme appliquées va silencieusement
priver l'app de garanties HDS-required.

Vérifier la présence des objets clés AVANT le step 7.2 :

```bash
psql $DATABASE_URL <<'EOF'
-- Trigger immuabilité audit (HDS NON négociable)
SELECT tgname FROM pg_trigger WHERE tgname = 'audit_logs_immutable';
-- Fonction rétention 6 ans
SELECT proname FROM pg_proc WHERE proname = 'audit_log_apply_retention';
-- CHECK constraint basal
SELECT conname FROM pg_constraint WHERE conname = 'chk_basal_config_type_fields';
-- Index unique partiel emergency
SELECT indexname FROM pg_indexes WHERE indexname = 'emergency_alerts_one_live_per_type';
EOF
```

Si **un seul** objet manque : NE PAS faire 7.2 — appliquer manuellement
`prisma/migrations/20260508140000_post_deploy_sql/migration.sql` via psql
d'abord (le script est idempotent : DROP-IF-EXISTS partout).

### 7.2 — Marquer baseline + post_deploy comme appliquées

```bash
# Une fois 7.1 OK :
pnpm prisma migrate resolve --applied 20260508135636_baseline_v1
pnpm prisma migrate resolve --applied 20260508140000_post_deploy_sql

# Vérifier
pnpm prisma migrate status
# → "Database schema is up to date"

# Continuer avec le workflow standard `migrate dev` / `migrate deploy`
```

⚠️ **À faire UNE seule fois par DB existante**, idéalement pendant une fenêtre
de maintenance, pour éviter qu'un déploiement concurrent fasse `migrate deploy`
qui chercherait à appliquer la baseline.

### 7.3 — Checklist 1er deploy prod (US-2267 `blocker-pre-prod`)

Avant le go-live :
- [ ] Backup vérifié et restorable (test sur staging)
- [ ] §7.1 vérification objets DDL passe sur la DB cible
- [ ] §7.2 `migrate resolve --applied` exécuté pour les 2 migrations
- [ ] `migrate status` confirme "Database schema is up to date"
- [ ] `./deploy.sh update` lancé avec `MIGRATION_BOOTSTRAPPED=` (NON set) pour passer le pre-flight check
- [ ] Health endpoint `/api/health` répond 200 post-deploy
- [ ] Tests E2E smoke (login + un READ patient) verts en prod
- [ ] Rollback testé (sur dump récent staging) : voir §5

---

## Prérequis extensions Postgres (Groupe 8 RDV)

La migration `20260514100000_groupe8_rdv` crée une contrainte `EXCLUDE USING GIST` sur `member_unavailabilities` pour bloquer les chevauchements horaires sans dépendre de Serializable. Elle requiert l'extension `btree_gist`.

### Vérification avant deploy

```sql
-- Sur le rôle applicatif
SELECT extname, extversion FROM pg_extension WHERE extname = 'btree_gist';
-- Si absent, vérifier sa disponibilité
SELECT * FROM pg_available_extensions WHERE name = 'btree_gist';
```

### Action si extension manquante

OVH Public Cloud DBaaS pré-installe `btree_gist`. Si le rôle applicatif n'a pas `CREATE EXTENSION`, exécuter en superuser :

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

Puis relancer `pnpm prisma migrate deploy` (idempotent).

---

## Partial indexes (Prisma 7 limitation — US-2076)

**Prisma 7 ne supporte pas la clause `where:` sur `@@index` côté
`schema.prisma`**. Plusieurs migrations utilisent des indexes partiels
définis directement en SQL pour réduire la taille et accélérer les
queries hot-path :

- `messages_unread_groupby_idx` — `WHERE read_at IS NULL AND deleted_at IS NULL`
- `messages_from_thread_recency_idx` — `WHERE deleted_at IS NULL`
- `messages_to_thread_recency_idx` — `WHERE deleted_at IS NULL`
- `messages_patient_id_idx` — `WHERE patient_id IS NOT NULL`
- `messages_deleted_at_idx` — `WHERE deleted_at IS NOT NULL`

### ⚠️ Piège opérationnel

Si quelqu'un exécute `pnpm prisma migrate dev` sur une DB où ces
migrations sont déjà appliquées, Prisma peut détecter une "drift" et
proposer une **migration corrective qui DROP les WHERE partiels** —
recréant les indexes en full-table (perte de l'optimisation + bloat).

### Procédure

1. **NE JAMAIS accepter une migration `prisma migrate dev` qui DROP +
   recrée un index partial sans WHERE.** Vérifier le contenu du fichier
   `migration.sql` généré.
2. Si une vraie modification du modèle nécessite une migration, **éditer
   manuellement** le fichier pour préserver les clauses `WHERE`.
3. La CI gate `migrations-check` (`prisma migrate diff --exit-code`)
   ignore actuellement les clauses `WHERE` partielles (Prisma 7
   limitation connue) — exit_code=0 ne valide PAS la cohérence partial.
4. Audit manuel des indexes en prod via :
   ```sql
   SELECT indexname, indexdef FROM pg_indexes
   WHERE tablename = 'messages' ORDER BY indexname;
   ```
