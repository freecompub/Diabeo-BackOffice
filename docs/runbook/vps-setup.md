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
sudo apt update && sudo apt install -y nginx postgresql-client git curl ca-certificates

# Node 22 — PAS dans les dépôts APT par défaut. Via NodeSource (dépôt officiel) :
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v                                                  # → v22.x
corepack enable && corepack prepare pnpm@10 --activate   # pnpm via corepack (fourni par Node)
```

## 3. PostgreSQL 16 — création de la base, du rôle & des extensions

Objectif : disposer d'une **base `diabeo`** + d'un **rôle** (compte user/mot de passe)
que l'app utilise pour se connecter, avec **3 extensions** activées. Deux cas selon
que Postgres tourne **sur le VPS** ou est une **base managée OVH (DBaaS)**.

> **Rôle** = compte de connexion (login + mot de passe). **Extensions** = plugins
> Postgres requis : `pg_trgm` (recherche floue patient), `pgcrypto` (chiffrement
> at-rest, ADR #8), `btree_gist` (contrainte anti-chevauchement des créneaux RDV).

### 3.A — Postgres installé sur le VPS

```bash
# 1. Installer PostgreSQL 16
#    ⚠️ postgresql-16 n'est PAS dans les dépôts APT par défaut (Ubuntu 22.04 → PG 14,
#    Debian 12 → PG 15). Ajouter d'abord le dépôt officiel PostgreSQL (PGDG) :
sudo apt update && sudo apt install -y curl ca-certificates gnupg lsb-release
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update
sudo apt install -y postgresql-16
# (Alternative sans install APT : conteneur `postgres:16-alpine`, ou base managée
#  OVH DBaaS = aucune install, cf. 3.B.)

# 1b. Vérifier l'install
psql --version                                   # → 16.x
sudo systemctl status postgresql --no-pager      # → active (running), démarre au boot

# 2. Créer le rôle applicatif (NON superutilisateur — moindre privilège) + la base
sudo -u postgres psql <<'SQL'
CREATE ROLE diabeo LOGIN PASSWORD '<MOT_DE_PASSE_FORT>';
CREATE DATABASE diabeo OWNER diabeo;
SQL

# 3. Activer les extensions EN SUPERUTILISATEUR (l'app n'a pas ce droit) — voir note
sudo -u postgres psql -d diabeo <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
SQL

# 3b. Déléguer à diabeo le droit de poser `session_replication_role` (voir note).
#     REQUIS : une migration (backfill audit_logs) ET la fonction de rétention
#     SECURITY DEFINER (owned by diabeo) l'utilisent pour franchir le trigger
#     d'immutabilité. Sans ce GRANT → migrate échoue (P3018, code 42501).
sudo -u postgres psql -d diabeo -c \
  "GRANT SET ON PARAMETER session_replication_role TO diabeo;"

# 4. Vérifier la connexion avec le rôle applicatif
PGPASSWORD='<MOT_DE_PASSE_FORT>' psql -h 127.0.0.1 -U diabeo -d diabeo -c '\dx'
#   → doit lister pg_trgm, pgcrypto, btree_gist
```

> **Mot de passe du rôle (`<MOT_DE_PASSE_FORT>`)** : c'est un secret **machine**
> (jamais tapé à la main) → **long et aléatoire**, jamais « humain ». Comme il entre
> dans le `DATABASE_URL`, utiliser un charset **URL-safe** : générer en **hexadécimal**
> (`openssl rand -hex 24` = 48 car., que des `0-9a-f`) évite d'avoir à URL-encoder des
> caractères spéciaux (`@ : / + = …`). Coller **la même valeur** dans `CREATE ROLE …
> PASSWORD` et dans le `DATABASE_URL`. Un mot de passe **différent par environnement**
> (recette ≠ prod). Ne PAS utiliser `openssl rand -base64` ici (`+ / =` → à encoder).
> *(OVH DBaaS génère ce mot de passe + le `DATABASE_URL` pour toi.)*

> **Authentification (piège classique)** : l'app se connecte en **TCP** (le
> `DATABASE_URL` porte un `host`). L'install PGDG configure par défaut
> `host all all 127.0.0.1/32 scram-sha-256` dans `pg_hba.conf` → l'étape 4
> fonctionne telle quelle. Si tu obtiens *« peer authentication failed »* ou
> *« no pg_hba.conf entry »*, ajoute/active cette ligne (fichier
> `/etc/postgresql/16/main/pg_hba.conf`) puis `sudo systemctl reload postgresql`.
> Postgres sur le même VPS : le garder en écoute **locale** (`listen_addresses =
> 'localhost'`, défaut) — pas d'exposition réseau.

> **Pourquoi l'étape 3 en superutilisateur ?** `prisma migrate deploy` tente
> `CREATE EXTENSION IF NOT EXISTS …`, mais créer une extension exige les droits
> **superuser** — que le rôle `diabeo` n'a volontairement pas. En les créant
> d'abord en `postgres`, la migration les trouve déjà présentes et passe sans erreur.

> **Pourquoi l'étape 3b (`GRANT SET ON PARAMETER`) ?** La migration
> `20260508150000_audit_metadata_patientid_gin` backfille `audit_logs` en
> franchissant le trigger d'immutabilité via `SET session_replication_role =
> 'replica'` (superuser-only). La fonction de rétention `audit_log_apply_retention`
> (`SECURITY DEFINER`, owned by `diabeo`) fait de même **à runtime** (purge CRON).
> Sans ce grant → `migrate` échoue (`P3018`, `ERROR 42501 permission denied to set
> parameter`), et la rétention casserait aussi. PostgreSQL **15+** permet cette
> délégation fine sans faire de `diabeo` un superuser.
> **Durcissement prod (optionnel)** : pour une immutabilité opposable même au rôle
> applicatif, faire posséder `audit_logs` (+ trigger) par un rôle **distinct** et
> ne donner à `diabeo` que `INSERT`/`SELECT` (pas de `DISABLE TRIGGER` possible).
> Dans ce modèle mono-rôle (diabeo owner), le grant n'affaiblit rien de plus.

### 3.B — Base managée OVH (DBaaS)

1. Créer une instance **PostgreSQL 16** + une base `diabeo` depuis l'Espace client OVH.
2. Récupérer les identifiants → construire le `DATABASE_URL` fourni.
3. **Extensions** : OVH DBaaS pré-installe `pg_trgm`/`pgcrypto`/`btree_gist`. Si le
   rôle fourni n'a pas `CREATE EXTENSION`, les activer depuis l'interface OVH (ou
   avec un rôle admin) — mêmes 3 `CREATE EXTENSION IF NOT EXISTS` qu'en 3.A étape 3.
4. **`session_replication_role`** (cf. 3.A étape 3b) : ⚠️ sur une base **managée**,
   ce paramètre est souvent **non délégable** (`GRANT SET ON PARAMETER` refusé) voire
   bloqué. Si `migrate` échoue en `42501`, exécuter le `GRANT` avec le rôle admin
   OVH ; si impossible, la migration de backfill audit et la rétention CRON ne
   passeront pas → ouvrir un ticket OVH ou héberger Postgres sur le VPS (3.A).

### `DATABASE_URL` (à mettre dans l'env, §4)

```
postgresql://<user>:<pwd>@<host>:5432/diabeo?schema=public
             └user┘ └pwd┘ └host┘ └port┘ └base┘ └ schéma ┘
```

- `user`/`pwd` : le rôle créé (`diabeo` + son mot de passe)
- `host` : `127.0.0.1` si Postgres sur le même VPS, sinon l'adresse OVH
- `5432` : port PostgreSQL par défaut · `diabeo` : nom de la base · `schema=public`

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

> **Clés PEM recommandées sur UNE ligne, `\n` échappés** (format canonique —
> `jwt.ts` fait `pem.replace(/\\n/g, "\n")`). Le service source l'env **via bash**
> (§6), donc des PEM multi-lignes réelles fonctionnent **aussi** ; mais le single-line
> est plus robuste (aucun outil ne bute dessus) et **obligatoire** si tu utilisais
> `EnvironmentFile=` (parseur systemd qui ne gère pas le multi-ligne — cf. §6).
> Générer la paire puis la convertir en single-line :
> ```bash
> openssl genrsa -out jwt.key 2048 && openssl rsa -in jwt.key -pubout -out jwt.pub
> awk 'NF{printf "%s\\n",$0}' jwt.key   # → coller la sortie dans JWT_PRIVATE_KEY="…"
> awk 'NF{printf "%s\\n",$0}' jwt.pub   # → coller la sortie dans JWT_PUBLIC_KEY="…"
> ```

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

Emplacement + permissions (**créer le dossier `/etc/diabeo` d'abord** — sinon
`install`/`scp` échoue avec *« No such file or directory »*) :

```bash
# 1. Créer le dossier (droits 750, propriétaire diabeo)
sudo install -d -m 750 -o diabeo -g diabeo /etc/diabeo

# 2. Y installer le fichier d'env (600, owner diabeo). Si tu l'as transféré via
#    scp dans ton home (scp diabeo-vps:~/), pars de ~/recette.env :
sudo install -m 600 -o diabeo -g diabeo ~/recette.env /etc/diabeo/recette.env
# (une commande : `sudo install -D -m 600 …` crée aussi les dossiers parents)

# 3. Vérifier + ne pas laisser traîner le secret dans le home
ls -l /etc/diabeo/recette.env      # -rw------- 1 diabeo diabeo …
rm ~/recette.env
```

## 5. Reverse proxy nginx (TLS + cap corps ≥ 10 Mo)

**Rôle** : nginx écoute sur les ports publics 80/443, gère le **HTTPS**, et
transmet à l'app locale `127.0.0.1:3000`. `client_max_body_size 10m` relève la
limite d'upload (défaut 1 Mo → 413) requise par le sync MyDiabby.

**⚠️ Retirer d'abord le site par défaut.** Sur Debian/Ubuntu, l'install nginx
pose `/etc/nginx/sites-enabled/default` — un `server` **`default_server`** sur le
port 80 qui sert des fichiers statiques (`root /var/www/html`). S'il reste, il
**capte** `certbot` (le certificat s'attache au mauvais bloc) et sert la page
« Welcome to nginx » au lieu de proxifier vers l'app → symptôme classique.
```bash
sudo rm -f /etc/nginx/sites-enabled/default   # désactive le vhost par défaut
```

**a. Config nginx** (créer le fichier, tester, recharger) :
```bash
sudo tee /etc/nginx/conf.d/diabeo-recette.conf >/dev/null <<'EOF'
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
}
EOF
sudo nginx -t && sudo systemctl reload nginx
```

**b. TLS via certbot** (installe certbot + son plugin nginx, puis émet le certificat) :
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d staging.diabeo.fr
```
`certbot` modifie automatiquement `diabeo-recette.conf` (ajout du bloc `443 ssl` +
redirection `80→443`) et programme le renouvellement. **Prérequis** : le DNS
`staging.diabeo.fr` doit déjà pointer vers le VPS (§11) et nginx doit tourner avec
ce `server_name`.

**c. Vérifier + dépanner :**
```bash
sudo nginx -t                         # syntaxe OK
sudo certbot renew --dry-run          # renouvellement fonctionnel
# Le cert doit être attaché à diabeo-recette.conf, PAS au site default :
grep -rl 'ssl_certificate' /etc/nginx/conf.d/ /etc/nginx/sites-enabled/ 2>/dev/null
```
- Un **502 Bad Gateway** en HTTPS = nginx OK mais l'app ne tourne pas encore sur
  `:3000` (normal tant que le service systemd n'est pas démarré — cf. §6/§7).
- **« Welcome to nginx » / page statique** = le site `default` a capté certbot :
  `sudo rm -f /etc/nginx/sites-enabled/default`, puis relancer
  `sudo certbot --nginx -d staging.diabeo.fr` et `sudo systemctl reload nginx`.

## 6. Service systemd

Fait tourner l'app en tâche de fond : démarrage auto au boot, redémarrage si crash.

**⚠️ Ordre** : `ExecStart=pnpm start` (= `next start`) exige un **build** préalable
(`.next/`, produit en §7). Active le service **après** le premier `pnpm build`,
sinon il tourne en **crash-loop** jusqu'à ce que le build existe (comportement
attendu, pas une erreur de config).

**⚠️ NE PAS utiliser `EnvironmentFile=`** pour charger `/etc/diabeo/*.env`. Le
parseur `EnvironmentFile` de systemd **ne gère pas les valeurs multi-lignes**
(les clés `JWT_*` PEM) : il perd le fil et **drope silencieusement une variable
suivante** (symptôme observé : `REDIS_KEY_PREFIX is missing` au boot alors que
`bash` la lit très bien). On fait donc **sourcer le fichier par bash dans
`ExecStart`** — le **même** chargeur que le build et `deploy.sh` (`set -a; . ;
set +a`), un seul mécanisme d'env partout, tolérant à tous les formats.

**a. Créer l'unité** :
```bash
sudo tee /etc/systemd/system/diabeo-recette.service >/dev/null <<'EOF'
[Unit]
Description=Diabeo Backoffice (recette)
After=network.target

[Service]
Type=simple
User=diabeo
WorkingDirectory=/opt/diabeo
# Source l'env via bash (gère les PEM multi-lignes) puis exec l'app. `exec` fait
# de next-server le process principal → signaux/arrêt propres. Chemin pnpm : adapte
# si `command -v pnpm` (sous diabeo) diffère.
ExecStart=/bin/bash -lc 'set -a; . /etc/diabeo/recette.env; set +a; exec pnpm start'
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

Le fichier d'env fournit les **9 variables obligatoires** (§4) : sans elles, l'app
crashe au boot (`assertRequiredEnv`, ADR #20).

**b. Activer (démarrage auto + lancement immédiat)** :
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now diabeo-recette
```

**c. Vérifier** :
```bash
systemctl status diabeo-recette                  # active (running) ?
journalctl -u diabeo-recette -n 50 --no-pager    # logs (diagnostic si crash)
curl -I http://127.0.0.1:3000                     # 200/redirect = app up
```
Après modif de l'unité : `sudo systemctl daemon-reload && sudo systemctl restart diabeo-recette`.

## 7. Premier déploiement

### 7.a Accès au dépôt privé — clé de déploiement (Deploy Key)

Le dépôt est **privé** : le VPS a besoin d'un accès **lecture seule**. Méthode
propre (réutilisée par `deploy.sh` et le CD) = une **Deploy Key SSH** dédiée.

```bash
# 1. Générer une clé dédiée (utilisateur diabeo)
sudo -u diabeo ssh-keygen -t ed25519 -f /home/diabeo/.ssh/diabeo_deploy -N "" -C "diabeo-vps-recette"
sudo -u diabeo cat /home/diabeo/.ssh/diabeo_deploy.pub   # ← copier cette clé PUBLIQUE

# 2. GitHub → repo → Settings → Deploy keys → Add deploy key :
#    Title=vps-recette, Key=<clé publique>, Allow write access = NON (lecture seule)

# 3. Router github.com vers cette clé
sudo -u diabeo tee -a /home/diabeo/.ssh/config >/dev/null <<'EOF'
Host github.com
  IdentityFile ~/.ssh/diabeo_deploy
  IdentitiesOnly yes
EOF
```

### 7.b Clone + install

```bash
# Node 22 + pnpm dispo pour l'utilisateur diabeo ?
sudo -u diabeo bash -lc 'node -v && pnpm -v'   # sinon: corepack enable && corepack prepare pnpm@10 --activate

# /opt est root:root → créer le dossier POSSÉDÉ par diabeo avant le clone,
# sinon `sudo -u diabeo git clone … /opt/diabeo` échoue en « Permission denied ».
sudo install -d -o diabeo -g diabeo /opt/diabeo
sudo -u diabeo git clone git@github.com:freecompub/Diabeo-BackOffice.git /opt/diabeo

sudo -u diabeo bash -lc 'cd /opt/diabeo && pnpm install --frozen-lockfile && pnpm prisma generate'
```

### 7.c Base de données + build + démarrage

⚠️ **Charger l'env via `set -a; . fichier; set +a`** (comme `deploy.sh`), **jamais**
`env $(grep … | xargs)` : les valeurs multi-lignes (`JWT_*` PEM) et à caractères
spéciaux (`/`, `+`, `=` des secrets) seraient corrompues. Le fichier étant
`chmod 600` possédé par `diabeo` (§4), on le source **en tant que `diabeo`**.

```bash
# DB : recette jetable → reset (migrations) + seed (5 users dev, 2 patients, 30j CGM).
#      En prod / base à préserver → `migrate deploy` (+ pré-vol, cf. release-glycemie-gl.md).
sudo -u diabeo bash -lc '
  set -a; . /etc/diabeo/recette.env; set +a
  cd /opt/diabeo
  pnpm prisma migrate reset --force --skip-seed   # ⚠️ efface la base (jetable) — migrations seules
  unset NODE_ENV                                   # le seed REFUSE NODE_ENV=production (garde anti-prod)
  pnpm prisma db seed                              # 5 users dev + 2 patients + 30j CGM
  pnpm build
'
sudo systemctl restart diabeo-recette      # (le service a été créé en §6)
```

> ⚠️ **Le seed refuse `NODE_ENV=production`** (garde-fou `seed.ts` : il crée des
> comptes à mots de passe connus `DEV-ONLY-…`). Comme l'env recette porte
> `NODE_ENV=production`, un `migrate reset` **sans** `--skip-seed` échouerait sur
> l'étape seed (table `users` vide → « Identifiants invalides » au login). D'où :
> `reset --skip-seed`, puis `unset NODE_ENV` **pour la seule commande de seed**
> (le service, lui, garde `NODE_ENV=production`). **On ne seed JAMAIS une vraie prod.**

> ⚠️ **`pnpm build` exige l'env COMPLET, pas seulement `NEXT_PUBLIC_*`.** À la phase
> « Collecting page data », Next évalue les modules des routes API qui instancient
> `PrismaClient` → `DATABASE_URL` est requis, sinon échec *« DATABASE_URL is required
> to instantiate PrismaClient »*. **Ne jamais lancer `pnpm build` nu** : toujours dans
> le sous-shell env-chargé ci-dessus (c'est aussi ce que fait `deploy.sh`).

Vérifier : `systemctl status diabeo-recette` puis `curl -I http://127.0.0.1:3000`
(et `curl -I https://staging.diabeo.fr` pour valider la chaîne nginx→app).

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

---

## 11. DNS — lier le domaine & créer le sous-domaine recette

Un domaine pointe vers un VPS via un enregistrement DNS **de type `A`** (IPv4,
`AAAA` pour IPv6) dans la **zone DNS** du domaine. Rappel des cibles Diabeo :
`app.diabeo.fr` = prod, **`staging.diabeo.fr` = recette**.

1. **IP publique du VPS** : `curl -4 ifconfig.me`.
2. **Zone DNS de `diabeo.fr`** — chez OVH : *Espace client → Web Cloud → Noms de
   domaine → `diabeo.fr` → Zone DNS*. (Si les serveurs de noms sont délégués
   ailleurs, ex. Cloudflare, éditer la zone **là où elle est hébergée**.)
3. **Ajouter les entrées A** (cible = IP du VPS) :

   | Sous-domaine | Type | Cible | Résout |
   |---|---|---|---|
   | *(vide / `@`)* | A | `<IP_PROD>` | `diabeo.fr` |
   | `app` | A | `<IP_PROD>` | `app.diabeo.fr` (prod) |
   | **`staging`** | **A** | `<IP_RECETTE>` | **`staging.diabeo.fr` (recette)** |

   → **Créer le sous-domaine recette = ajouter l'entrée A `staging`** (« Ajouter une
   entrée » → type `A` → sous-domaine `staging` → cible = IP VPS → TTL 3600).
4. **Propagation** (min → ~1 h selon TTL) puis vérifier :
   `dig +short staging.diabeo.fr A` (doit renvoyer l'IP du VPS).

> Recette + prod sur le **même VPS** : mettre `staging` et `app` sur la même IP ;
> nginx distingue par `server_name`, chaque app sur un port distinct (3000/3001)
> avec 2 services systemd. **`staging.diabeo.fr` doit résoudre AVANT certbot**
> (validation HTTP-01).

## 12. Séquence complète — VPS vierge → recette en ligne

À exécuter APRÈS avoir créé l'entrée DNS `staging` (§11). Adapter les `<…>`.

```bash
# 0. Prérequis (root)
sudo apt update && sudo apt install -y nginx postgresql-client git curl ca-certificates certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -   # Node 22 (NodeSource)
sudo apt install -y nodejs
corepack enable && corepack prepare pnpm@10 --activate
sudo useradd -m -s /bin/bash diabeo

# 1. PostgreSQL 16 : base + extensions (ou OVH DBaaS → récupérer l'URL)
sudo -u postgres psql -c "CREATE ROLE diabeo LOGIN PASSWORD '<PWD_DB>';"
sudo -u postgres psql -c "CREATE DATABASE diabeo OWNER diabeo;"
sudo -u postgres psql -d diabeo -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS btree_gist;"
# Droit de poser session_replication_role (backfill audit + rétention) — cf. §3 étape 3b
sudo -u postgres psql -d diabeo -c "GRANT SET ON PARAMETER session_replication_role TO diabeo;"

# 2. Secrets + fichier d'env (9 obligatoires + fonctionnels)
sudo install -d -m 750 -o diabeo -g diabeo /etc/diabeo
openssl genrsa -out /tmp/jwt.key 2048 && openssl rsa -in /tmp/jwt.key -pubout -out /tmp/jwt.pub
sudo -u diabeo tee /etc/diabeo/recette.env >/dev/null <<EOF
NODE_ENV=production
APP_ENV=recette
NEXT_PUBLIC_APP_URL=https://staging.diabeo.fr
DATABASE_URL=postgresql://diabeo:<PWD_DB>@127.0.0.1:5432/diabeo?schema=public
HEALTH_DATA_ENCRYPTION_KEY=$(openssl rand -hex 32)
HMAC_SECRET=$(openssl rand -hex 32)
CONVERSATION_KEY_PEPPER=$(openssl rand -hex 32)
AUDIT_PEPPER=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
REDIS_KEY_PREFIX=diabeo:recette:
JWT_PRIVATE_KEY="$(awk 'NF{printf "%s\\n",$0}' /tmp/jwt.key)"
JWT_PUBLIC_KEY="$(awk 'NF{printf "%s\\n",$0}' /tmp/jwt.pub)"
UPSTASH_REDIS_REST_URL=<...>
UPSTASH_REDIS_REST_TOKEN=<...>
OVH_S3_ENDPOINT=https://s3.gra.io.cloud.ovh.net
OVH_S3_REGION=gra
OVH_S3_BUCKET=diabeo-documents-recette
OVH_S3_ACCESS_KEY=<...>
OVH_S3_SECRET_KEY=<...>
EOF
sudo chmod 600 /etc/diabeo/recette.env && shred -u /tmp/jwt.key /tmp/jwt.pub

# 3. Code (repo PRIVÉ → Deploy Key, cf. §7.a pour la génération + ajout GitHub)
#    /opt étant root:root, créer le dossier possédé par diabeo AVANT le clone.
sudo install -d -o diabeo -g diabeo /opt/diabeo
sudo -u diabeo git clone git@github.com:freecompub/Diabeo-BackOffice.git /opt/diabeo
sudo -u diabeo bash -lc 'cd /opt/diabeo && pnpm install --frozen-lockfile && pnpm prisma generate'

# 4. Base recette jetable + seed + build — env chargé via `set -a; . ; set +a`
#    (jamais `env $(grep|xargs)` : casse les PEM JWT_*). Le seed refuse
#    NODE_ENV=production → reset --skip-seed puis `unset NODE_ENV` + `db seed`.
sudo -u diabeo bash -lc '
  set -a; . /etc/diabeo/recette.env; set +a
  cd /opt/diabeo
  pnpm prisma migrate reset --force --skip-seed
  unset NODE_ENV
  pnpm prisma db seed
  pnpm build
'

# 5. Service systemd
sudo tee /etc/systemd/system/diabeo-recette.service >/dev/null <<'EOF'
[Unit]
Description=Diabeo Backoffice (recette)
After=network.target
[Service]
Type=simple
User=diabeo
WorkingDirectory=/opt/diabeo
# bash source l'env (PEM multi-lignes OK) — PAS EnvironmentFile (parseur divergent). Cf. §6.
ExecStart=/bin/bash -lc 'set -a; . /etc/diabeo/recette.env; set +a; exec pnpm start'
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now diabeo-recette

# 6. nginx + TLS (DNS staging → VPS déjà propagé, cf. §11)
#    Retirer le vhost par défaut, sinon il capte certbot (page « Welcome to nginx »).
sudo rm -f /etc/nginx/sites-enabled/default
sudo tee /etc/nginx/conf.d/diabeo-recette.conf >/dev/null <<'EOF'
server {
  server_name staging.diabeo.fr;
  client_max_body_size 10m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d staging.diabeo.fr

# 7. Vérification
cd /opt/diabeo && APP_ENV=recette ./deploy.sh status
curl -I https://staging.diabeo.fr
```

**Déploiements suivants** : `cd /opt/diabeo && APP_ENV=recette ./deploy.sh update`.

> ⚠️ **Ne jamais régénérer `HEALTH_DATA_ENCRYPTION_KEY` après le 1er boot** sans plan
> de rotation : il déchiffre les données de santé existantes. **Redis Upstash** et
> **OVH Object Storage** sont des services managés (créés dans leurs consoles).
