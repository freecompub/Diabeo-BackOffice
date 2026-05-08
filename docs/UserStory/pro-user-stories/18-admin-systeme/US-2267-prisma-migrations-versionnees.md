# US-2267 — Mise en place des migrations Prisma versionnées

> 📌 **18. Administration système** · Priorité **V1 (blocker-pre-prod)** · Pays **Universel**
>
> 💬 **Origine** : Follow-up review PR #343. Le repo utilise `prisma db push` sans dossier `prisma/migrations/` versionné. Bloquant pour l'audit HDS et tout rollback prod.
>
> 🚨 **Reclassification 2026-05-08** : MVP → V1. Justification : Diabeo n'est pas encore déployé en production, donc `prisma db push` reste sûr en dev/recette. **Doit impérativement être traité AVANT le 1er déploiement prod** (label `blocker-pre-prod`).

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2267` |
| **Domaine** | 18. Administration système |
| **Priorité** | **V1** + label `blocker-pre-prod` (bloquant audit HDS et 1er go-live) |
| **Pays cible** | Universel |
| **Story points** | **5** |
| **Statut** | 🆕 À démarrer |
| **Dépendances** | Aucune (préalable à toute migration future) |
| **Owner** | À assigner |
| **Bloquant pour** | 1er déploiement prod, certification HDS |

---

## 📋 Contexte métier

### Pourquoi cette US existe ?

`prisma-specialist` (review PR #343) a flaggé l'absence du dossier `prisma/migrations/`. Le repo actuel applique le schéma via `prisma db push` :
- ✅ pratique en dev local
- ❌ aucun fichier SQL versionné dans le code → impossible de rejouer en prod
- ❌ aucun rollback formel si un déploiement passe une migration destructive
- ❌ `prisma migrate deploy` (commande prod documentée dans CLAUDE.md) **est vide**
- ❌ ANSSI / HDS exigent une trace d'audit des changements de schéma sur données de santé

C'est une dette pré-existante, mais le Mirror MVP (5 nouvelles tables + 1 colonne sur Patient) est l'occasion d'établir la baseline.

### Valeur produit

- **HDS / ANS** : traçabilité formelle des évolutions de schéma sur données de santé.
- **Ops** : `prisma migrate deploy` fonctionne réellement en prod (idempotent, rollback documenté).
- **Dev** : nouvelles migrations explicites (review SQL en PR), pas de surprise sur `db push --accept-data-loss`.
- **Audit** : trace SQL versionnée que les colonnes chiffrées ont bien été ajoutées avec les bons types.

---

## ✅ Critères d'acceptation

### AC-1 — Baseline créée

```gherkin
Étant donné le schéma actuel en prod (54 tables après Mirror MVP)
Quand on initialise les migrations avec `prisma migrate diff` puis `migrate resolve --applied`
Alors un fichier `prisma/migrations/<timestamp>_baseline_v1/migration.sql` est créé
Et il contient le DDL complet du schéma actuel (54 tables, 26 enums, indexes, FKs)
Et `prisma migrate status` affiche "Database schema is up to date"
```

### AC-2 — Workflow dev migré

```gherkin
Étant donné un développeur modifie prisma/schema.prisma
Quand il exécute `pnpm prisma migrate dev --name <feature>`
Alors une nouvelle migration est générée dans prisma/migrations/
Et le fichier SQL est review-able dans la PR
```

### AC-3 — Workflow prod opérationnel

```gherkin
Étant donné un déploiement prod
Quand `pnpm prisma migrate deploy` est exécuté
Alors toutes les migrations en attente sont appliquées idempotamment
Et un rapport est loggué (migrations appliquées, durée)
```

### AC-4 — CI vérifie la cohérence

```gherkin
Étant donné une PR modifie schema.prisma
Quand la CI tourne
Alors un check vérifie qu'une migration correspondante existe dans prisma/migrations/
Et `prisma migrate diff --from-migrations --to-schema-datamodel` est vide
```

### AC-5 — SQL natif intégré

```gherkin
Étant donné un script SQL dans prisma/sql/ (ex: emergency_alerts_constraints.sql)
Quand on bascule vers le workflow migrate
Alors ces scripts sont intégrés dans une migration dédiée OU documentés comme post-deploy steps
Et le runbook `deploy.sh` les applique automatiquement
```

### AC-6 — Plan de rollback documenté

```gherkin
Étant donné une migration vient d'être déployée et un bug est détecté
Quand l'opérateur consulte le runbook
Alors il trouve le SQL de rollback ou la procédure de roll-forward
Et la procédure a été testée sur un dump récent
```

---

## 📐 Règles métier

- **RM-1** : toute modification de `schema.prisma` requiert une migration versionnée.
- **RM-2** : les scripts SQL natifs (`prisma/sql/`) restent autorisés pour les triggers / partial indexes / CHECK constraints, mais sont référencés explicitement dans les migrations.
- **RM-3** : les migrations destructives (DROP COLUMN, DROP TABLE) requièrent une approbation explicite (label PR `destructive-migration`) — confirmé par CLAUDE.md « jamais sans confirmation explicite ».
- **RM-4** : `prisma db push` reste utilisable en local (`pnpm prisma db push --accept-data-loss` interdit) mais jamais en CI/prod.

---

## 🔌 Impact technique

1. **Script de baseline** :
   ```bash
   # Sur une DB miroir prod (dump récent)
   pnpm prisma migrate diff \
     --from-empty \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/migrations/$(date +%Y%m%d%H%M%S)_baseline_v1/migration.sql

   # Marquer comme appliquée sans la rejouer
   pnpm prisma migrate resolve --applied <migration_name>
   ```

2. **Intégration des SQL natifs existants** :
   - `audit_immutability.sql`
   - `cgm_partitioning.sql`
   - `basal_config_check.sql`
   - `patient_insulin_constraints.sql`
   - `emergency_alerts_constraints.sql` (Mirror MVP)
   → Soit les copier dans des migrations dédiées, soit documenter en `post-deploy.sql` joué par `deploy.sh`.

3. **CI check** : nouveau job dans `.github/workflows/` qui assert la cohérence schéma ↔ migrations :
   ```yaml
   - name: Schema must match migrations
     run: |
       pnpm prisma migrate diff \
         --from-migrations prisma/migrations \
         --to-schema-datamodel prisma/schema.prisma \
         --exit-code
   ```

4. **Update CLAUDE.md** : préciser que `prisma migrate dev` est désormais obligatoire pour toute évolution.

5. **Update `deploy.sh`** : appel à `prisma migrate deploy` + `psql < post-deploy.sql` si nécessaire.

---

## 🧪 Plan de test

- **Test local** : appliquer la baseline sur une DB neuve, vérifier diff vide.
- **Test recette** : restore d'un dump prod récent, appliquer baseline + migration test, rollback testé.
- **CI** : nouveau job `schema-migration-coherence` vert.
- **Test deploy.sh** : sur env de staging, déploiement complet via le runbook mis à jour.

---

## 📦 Définition de Done

- [ ] Baseline créée et committée
- [ ] CLAUDE.md mis à jour (workflow migrate)
- [ ] `deploy.sh` adapté
- [ ] CI check ajouté
- [ ] Runbook rollback documenté dans `docs/runbook/`
- [ ] Validation `prisma-specialist` + `devops-engineer`
- [ ] Test E2E sur env recette (deploy → migrate → rollback)

---

## 🔗 US liées

- PR #343 (Mirror MVP — origine du finding)
- US-2151 (gestion backups) — pré-requis pour rollback
- US-2167 (disaster recovery) — englobe les rollbacks de schéma
