# Runbook — Configuration d'un VPS pour le déploiement Diabeo

> Guide de mise en place d'un environnement (recette ou prod) sur VPS OVHcloud.
> Fidèle au dépôt : la liste d'env fait autorité = `src/lib/env.ts`. Déploiement
> **manuel** via `deploy.sh` (fourni à la racine). Migrations : `docs/runbook/migrations.md`.

## 1. Architecture cible

| Composant | Emplacement | Détail |
|---|---|---|
| App **Next.js 16** (Node 22, pnpm 10) | **VPS** | derrière reverse proxy nginx/Traefik + TLS |
| **PostgreSQL 16** | OVH DBaaS **ou** VPS | Prisma 7 + `@prisma/adapter-pg` |
| **Redis** | **Upstash** (managé) | rate-limit, révocation session, cache |
| **Object Storage** | **OVH** (S3-compatible) | documents (ClamAV), backups DB |
| Email / Push | Resend / Firebase | optionnels selon features |

Pas de Dockerfile ni de profil compose « prod » dans le dépôt (seul le profil
`local` pour le dev). L'app tourne en Node sous un service **systemd**.

## 2. Prérequis système

```bash
sudo apt update && sudo apt install -y nginx postgresql-client git
corepack enable && corepack prepare pnpm@10 --activate   # Node 22 requis
```

## 3. PostgreSQL 16 — rôle + extensions

Les migrations créent `pg_trgm` + `pgcrypto` (baseline) ; l'extension `btree_gist`
est requise (contrainte anti-chevauchement RDV). Si le rôle applicatif n'a pas
`CREATE EXTENSION`, les pré-créer en superuser :

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

`DATABASE_URL` : `postgresql://<user>:<pwd>@<host>:5432/diabeo?schema=public`.

## 4. Variables d'environnement — `/etc/diabeo/<env>.env`

`assertRequiredEnv()` (ADR #20, `instrumentation.ts`) **fait crasher l'app au boot**
si une variable OBLIGATOIRE manque/est malformée — message clair pointant la cause.

### 4.1 Obligatoires (9 — source : `src/lib/env.ts` `REQUIRED_FULL`)

| Variable | Format | Génération |
|---|---|---|
| `DATABASE_URL` | URL Postgres | — |
| `HEALTH_DATA_ENCRYPTION_KEY` | **64 hex exact** (32 o) | `openssl rand -hex 32` |
| `HMAC_SECRET` | 64+ hex | `openssl rand -hex 32` |
| `CONVERSATION_KEY_PEPPER` | 64+ hex | `openssl rand -hex 32` |
| `AUDIT_PEPPER` | 64+ hex (≠ HMAC) | `openssl rand -hex 32` |
| `CRON_SECRET` | 64+ hex | `openssl rand -hex 32` |
| `REDIS_KEY_PREFIX` | `diabeo:<env>:` | ex. `diabeo:recette:` |
| `JWT_PRIVATE_KEY` | PEM RSA privée | `openssl genrsa 2048` |
| `JWT_PUBLIC_KEY` | PEM RSA publique | `openssl rsa -pubout` |

> Les clés PEM multi-lignes : stocker avec `\n` échappés ou en variable multi-ligne
> supportée par systemd `EnvironmentFile` (préférer un secret manager si dispo).
> Générer une paire JWT : `openssl genrsa -out jwt.key 2048 && openssl rsa -in jwt.key -pubout -out jwt.pub`.

### 4.2 Fonctionnelles (selon features)

```dotenv
NODE_ENV=production
APP_ENV=recette
NEXT_PUBLIC_APP_URL=https://staging.diabeo.fr
# Redis Upstash
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
# OVH Object Storage (S3)
OVH_S3_ENDPOINT=https://s3.gra.io.cloud.ovh.net
OVH_S3_REGION=gra
OVH_S3_BUCKET=diabeo-documents-recette
OVH_S3_ACCESS_KEY=...
OVH_S3_SECRET_KEY=...
# Email / Push (optionnels)
RESEND_API_KEY=...
EMAIL_FROM="Diabeo <no-reply@diabeo.fr>"
FIREBASE_PROJECT_ID=...
FIREBASE_SERVICE_ACCOUNT_KEY=...
# Flags
PROPOSAL_CRON_ENABLED=false
```

> **PROD/recette : `MOCK_MODE` / `MOCK_ANTIVIRUS` NE DOIVENT PAS valoir `true`** —
> `env.ts` refuse le boot en `NODE_ENV=production` si ces flags fuitent.

Permissions : `sudo install -m 600 -o diabeo -g diabeo <env>.env /etc/diabeo/recette.env`.

## 5. Reverse proxy nginx (TLS + cap corps ≥ 10 Mo)

```nginx
# /etc/nginx/conf.d/diabeo.conf
server {
  server_name staging.diabeo.fr;
  client_max_body_size 10m;     # OBLIGATOIRE (sync MyDiabby) — cf. infra-body-limits.md
  client_body_buffer_size 1m;
  client_body_timeout 30s;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  # + TLS (certbot / OVH). Écouter en 443, rediriger 80→443.
}
```

## 6. Service systemd

```ini
# /etc/systemd/system/diabeo-recette.service
[Unit]
Description=Diabeo Backoffice (recette)
After=network.target

[Service]
Type=simple
User=diabeo
WorkingDirectory=/opt/diabeo
EnvironmentFile=/etc/diabeo/recette.env
ExecStart=/usr/bin/pnpm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now diabeo-recette
```

## 7. Premier déploiement

```bash
sudo -u diabeo git clone <repo> /opt/diabeo && cd /opt/diabeo
sudo -u diabeo pnpm install --frozen-lockfile
sudo -u diabeo pnpm prisma generate
# DB : recette jetable → reset+seed ; sinon migrate deploy (+ pré-vol si données)
sudo -u diabeo --preserve-env pnpm prisma migrate deploy   # ou migrate reset --force
sudo -u diabeo pnpm build
sudo systemctl restart diabeo-recette
```

Checklist 1er deploy prod (backup restorable, rollback testé, smoke tests) :
`docs/runbook/migrations.md §7.3`.

## 8. Déploiements suivants — `deploy.sh`

Le script `deploy.sh` (racine du dépôt) encapsule le cycle. Adapter les variables
en tête (`APP_DIR`, `SERVICE`, `S3_BUCKET_BACKUPS`).

```bash
./deploy.sh update     # pull + install + generate + migrate deploy + build + restart
./deploy.sh migrate    # migrations seules (+ status)
./deploy.sh backup     # pg_dump gzip → OVH Object Storage
./deploy.sh status     # santé service + DB + migrations
```

## 9. Backups automatiques (timer systemd)

```ini
# /etc/systemd/system/diabeo-backup.service
[Service]
Type=oneshot
User=diabeo
WorkingDirectory=/opt/diabeo
Environment=APP_ENV=recette
ExecStart=/opt/diabeo/deploy.sh backup
```
```ini
# /etc/systemd/system/diabeo-backup.timer
[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
[Install]
WantedBy=timers.target
```
```bash
sudo systemctl enable --now diabeo-backup.timer
```

## 10. Vérification finale

- [ ] `./deploy.sh status` → service `active`, `pg_isready` OK, migrations toutes appliquées.
- [ ] `https://staging.diabeo.fr` répond, login OK.
- [ ] Boot sans crash env (sinon lire le message d'`assertRequiredEnv`).
- [ ] `docs/runbook/release-glycemie-gl.md` → smoke tests de la release en cours.
