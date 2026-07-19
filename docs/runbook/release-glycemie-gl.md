# Runbook de release — Normalisation unités glycémie **g/L** (ADR #32)

> Déploiement de l'épic « g/L canonique » + docs + correctifs home médecin.
> Cible immédiate : **recette** (`staging.diabeo.fr`). Réutilisable pour la prod.
> Déploiement **manuel** (`deploy.sh` sur le VPS) — pas de CI/CD de deploy.

## 1. Périmètre livré

| PR | Contenu | Migration ? |
|---|---|---|
| **#753** | Unités glycémie **g/L canonique** (stockage + API), module `glucose/units.ts`, affichage par préférence | **Oui — 2 migrations** |
| #754 | Doc `docs/reference/homes-par-role.html` | non |
| #755 | Correctifs home médecin (D1–D9 hors D4) + route `POST /api/dashboard/recall` | non |

**Migrations à appliquer** (ordre `migrate deploy` = timestamp) :
1. `20260731100000_glycemia_unit_s1_cgm_check_bgm_backfill` — **additif** : backfill
   `glycemia_gl = COALESCE(…, glycemia_mgdl/100)` + `CHECK value_gl 0.20–6.00` (CGM).
2. `20260801100000_glycemia_unit_s4_drop_mgdl` — **DESTRUCTIF** : `CHECK glycemia_gl`
   (NULL-toléré) + **`DROP COLUMN glycemia_mgdl`** (irréversible).

**Env** : aucune nouvelle variable. **Contrat API** : `valueGl`/`glycemiaGl` en g/L
(le champ `glycemiaMgdl` disparaît de l'API) — front web déployé dans le même lot,
contrat iOS hors périmètre (ADR #31).

## 2. ⚠️ Risque migration — CHECK sur données existantes

Les `ADD CONSTRAINT CHECK` **échouent** (et interrompent le deploy) si une seule
ligne viole les bornes `[0.20 ; 6.00]` g/L (= 20–600 mg/dL). Toujours passer le
**pré-vol** avant `migrate deploy` sur une base porteuse de données.

## 3A. Chemin RECETTE — base jetable/re-seedable (RECOMMANDÉ)

La recette étant re-seedable, on repart propre (le seed génère du CGM 0.40–4.00,
dans les bornes → aucun risque de CHECK) :

```bash
# 1. Déployer le CODE (pull + build + restart) — procédure VPS habituelle
./deploy.sh update

# 2. Réinitialiser le schéma sur la version cible, PUIS re-seed séparément.
#    ⚠️ Le seed REFUSE NODE_ENV=production (garde anti-prod, seed.ts) → si l'env
#    recette porte NODE_ENV=production, un `reset` sans --skip-seed échoue sur le
#    seed (table users vide → login KO). D'où : --skip-seed puis `unset NODE_ENV`.
sudo -u diabeo bash -lc '
  set -a; . /etc/diabeo/recette.env; set +a
  cd /opt/diabeo
  pnpm prisma migrate reset --force --skip-seed   # ⚠️ efface la base recette (jetable)
  unset NODE_ENV
  pnpm prisma db seed                              # CGM 0.40–4.00, dans les bornes
'

# 3. Vérifier l'état
sudo -u diabeo bash -lc 'set -a; . /etc/diabeo/recette.env; set +a; cd /opt/diabeo;
  pnpm prisma migrate status'               # toutes appliquées, aucune pending
```

Puis **smoke tests** (§4).

## 3B. Chemin DONNÉES PRÉSERVÉES (prod future, ou recette non re-seedée)

```bash
# 1. Backup vérifié et restorable (cf. migrations.md §5 cas 2)
./deploy.sh backup                       # dump → OVH Object Storage

# 2. PRÉ-VOL — toutes les lignes « *_bloquant » DOIVENT valoir 0
psql "$DATABASE_URL" -f ops/preflight/glycemia-gl-preflight.sql

# 3. Si [1]/[2]/[4] > 0 : remédier AVANT (purge ciblée des lignes hors bornes,
#    ou clamp validé medical) — cf. bloc « REMÉDIATION » du pré-vol.

# 4. Appliquer les migrations (S1 puis S4, idempotent, non transactionnel/fichier)
pnpm prisma migrate deploy

# 5. Déployer le code APRÈS (l'API g/L-only ne doit pas tourner avant le DROP)
./deploy.sh update

# 6. Vérifs post-migration
pnpm prisma migrate status
psql "$DATABASE_URL" -c "\d glycemia_entries"   # glycemia_mgdl absente, glycemia_gl + CHECK
```

## 4. Smoke tests (post-déploiement)

- [ ] **Login** OK pour chaque rôle → atterrissage sur la bonne home (`/medecin`,
      `/infirmier`, `/admin`, `/patient/dashboard`).
- [ ] **CGM** : `GET /api/patients/:id/cgm` renvoie `valueGl` (g/L) ; le dashboard
      affiche la glycémie **selon la préférence** `unitGlycemia` (g/L / mg/dL / mmol/L).
- [ ] **BGM** : `POST /api/patients/:id/glycemia` accepte `glycemiaGl` (0.20–6.00) et
      **refuse** un ancien payload `glycemiaMgdl` (400). `GET` renvoie `glycemiaGl` seul.
- [ ] **Home médecin** : un **NURSE** ne voit plus « Patients à suivre » ni les KPI
      cabinet (pas d'erreur 403). Un DOCTOR les voit.
- [ ] **Relance** : clic « Appeler »/« SMS » → une ligne `AuditLog action=RECALL_INITIATED`
      apparaît (`resource=PATIENT`, `metadata.channel`).
- [ ] **Routes supprimées** : `/dashboard` et `/events/new` renvoient **404** (legacy retiré).
- [ ] **Export RGPD** : contient l'annotation `measurementUnits: { glucose: "g/L" }`.

## 5. Rollback

Prisma ne rollback pas automatiquement. Down-scripts fournis (**testés PG 16,
cycle down→up validé, drift 0**) :

```bash
# Ordre INVERSE du deploy : S4 down (restaure glycemia_mgdl dérivé de g/L) puis S1 down
psql "$DATABASE_URL" -f ops/rollback/20260801100000_glycemia_unit_s4_drop_mgdl_down.sql
psql "$DATABASE_URL" -f ops/rollback/20260731100000_glycemia_unit_s1_cgm_check_bgm_backfill_down.sql

# Marquer rolled-back dans _prisma_migrations
pnpm prisma migrate resolve --rolled-back 20260801100000_glycemia_unit_s4_drop_mgdl
pnpm prisma migrate resolve --rolled-back 20260731100000_glycemia_unit_s1_cgm_check_bgm_backfill

# ⚠️ Rollback DB SEUL ≠ suffisant : redéployer AUSSI le code pré-#753 (schéma +
# services lisant glycemia_mgdl), sinon le client ignore la colonne restaurée.
```

En recette jetable, le rollback = simplement `git revert` + `prisma migrate reset --force`.

## 6. Artefacts de cette release

- `ops/preflight/glycemia-gl-preflight.sql` — détection pré-migration des lignes bloquantes.
- `ops/rollback/20260731100000_*_down.sql` — rollback S1 (drop CHECK CGM).
- `ops/rollback/20260801100000_*_down.sql` — rollback S4 (restaure `glycemia_mgdl`).
- ADR : `docs/architecture/adr-normalisation-unites-glycemie.md`.
