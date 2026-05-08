# Runbook — Partitioning PostgreSQL pour `cgm_entries`

> Opération **manuelle**, non versionnée dans les migrations Prisma.
> À exécuter **uniquement** lorsque le volume `cgm_entries` justifie la complexité.

---

## Quand appliquer

Indicateurs déclenchant la migration vers partitioning :
- Table `cgm_entries` > 10M lignes
- Latence SELECT par patient + range timestamp > 500ms (scan séquentiel observé dans `EXPLAIN ANALYZE`)
- Croissance > 1M lignes/mois projetée

À 5k patients × 288 lectures CGM/jour = 1.4M lignes/jour → ~500M/an. Le seuil
de 10M sera dépassé sous 1 mois post-prod si tous les patients utilisent CGM.

---

## Pourquoi pas dans les migrations Prisma

Prisma 7 ne peut pas modéliser :
- `PARTITION BY RANGE (timestamp)` syntaxe
- Primary key composite `(id, timestamp)` requis pour les tables partitionnées
- Sub-partitions (`p_2026_01`, `p_2026_02`, ...) créées dynamiquement

Si on inclut le SQL dans une migration, le drift check (`prisma migrate diff
--from-migrations --to-schema --exit-code`) échoue à chaque run car la DB est
partitionnée mais le schema Prisma n'a pas la composite PK.

---

## Procédure

### 1. Backup avant opération

```bash
DATE=$(date +%Y%m%d-%H%M)
pg_dump $DATABASE_URL --table=cgm_entries -f /tmp/cgm_entries-$DATE.sql
ls -lh /tmp/cgm_entries-$DATE.sql
```

### 2. Fenêtre de maintenance

L'opération **bloque les écritures** pendant la durée du `ALTER TABLE` (peut
prendre plusieurs minutes selon le volume). Prévoir un downtime ou utiliser
`pg_repack` pour minimiser le lock.

### 3. Application

```bash
psql $DATABASE_URL < prisma/sql/cgm_partitioning.sql
```

Le script :
1. Renomme `cgm_entries` → `cgm_entries_legacy`
2. Crée `cgm_entries` partitionnée avec PK composite `(id, timestamp)`
3. Crée les partitions mensuelles (12 mois passés + 12 mois futurs)
4. Copie les données de `cgm_entries_legacy` vers les partitions
5. Recrée les indexes et FK
6. Drop `cgm_entries_legacy` après vérification

### 4. Vérification

```bash
# Compter les lignes — doit matcher le total pré-migration
psql $DATABASE_URL -c "SELECT COUNT(*) FROM cgm_entries;"

# Lister les partitions
psql $DATABASE_URL -c "\dt+ cgm_entries_p*"

# Tester un SELECT typique
psql $DATABASE_URL -c "
  EXPLAIN ANALYZE
  SELECT * FROM cgm_entries
  WHERE patient_id = 1 AND timestamp > NOW() - INTERVAL '7 days';
"
# → doit montrer un partition pruning (seules les partitions récentes scannées)
```

### 5. Cron de maintenance des partitions

À ajouter dans le cron OVH :

```bash
# Premier jour de chaque mois — créer la partition du mois M+1
0 2 1 * * psql $DATABASE_URL -c "SELECT create_next_cgm_partition();"

# Premier jour de chaque mois — drop la partition de M-13 (rétention 12 mois)
0 3 1 * * psql $DATABASE_URL -c "SELECT drop_old_cgm_partition();"
```

Les fonctions `create_next_cgm_partition()` et `drop_old_cgm_partition()` sont
définies dans `prisma/sql/cgm_partitioning.sql`.

### 6. Drift check post-opération

Après partitioning, le drift check Prisma **échouera** car le schema Prisma ne
modélise pas la PK composite. Pour l'ignorer :

Option A — Désactiver le check pour `cgm_entries` (à implémenter via un
filtre dans le job CI `migrations-check`).

Option B — Modéliser la PK composite dans `schema.prisma` :

```prisma
model CgmEntry {
  id         String   @default(uuid())
  timestamp  DateTime
  patientId  Int      @map("patient_id")
  // ...
  @@id([id, timestamp])  // Composite PK requise par PG partitioning
}
```

⚠️ Option B nécessite que tous les `findUnique({ where: { id } })` deviennent
`findFirst({ where: { id, timestamp } })` ou `findUnique({ where: { id_timestamp: ... } })`.

Décision : **différer** jusqu'à ce que le partitioning soit réellement nécessaire.
