# Tester Diabeo Backoffice en local

Guide pas-à-pas pour faire tourner le backoffice sur ta machine (dev / test
manuel / démo locale).

---

## Prérequis

```bash
node --version    # >= 22
pnpm --version    # >= 10
docker --version  # n'importe quelle version récente
```

Sur Linux/macOS pour générer les clés (`openssl` standard).
Sur Windows : utiliser WSL2.

---

## 1. Cloner + installer

```bash
git clone https://github.com/freecompub/Diabeo-BackOffice.git
cd Diabeo-BackOffice
pnpm install --frozen-lockfile
```

---

## 2. Démarrer les services locaux (PostgreSQL + MinIO)

```bash
docker compose --profile local up -d

# Vérifier que tout est UP :
docker compose ps
# → postgres : healthy
# → minio : healthy
# → minio-setup : exited 0 (a créé le bucket diabeo-documents)
```

| Service | URL | Credentials |
|---|---|---|
| PostgreSQL 16 | `localhost:5432` | user `diabeo` / password `password` / db `diabeo` |
| MinIO API (S3) | `http://localhost:9000` | `minioadmin` / `minioadmin` |
| MinIO Console | `http://localhost:9001` | `minioadmin` / `minioadmin` |

Le bucket `diabeo-documents` est créé automatiquement par le service `minio-setup`.

---

## 3. Générer les clés et créer `.env`

```bash
cp .env.example .env
```

### 3.1 JWT RS256

```bash
openssl genrsa -out /tmp/jwt-private.pem 2048
openssl rsa -in /tmp/jwt-private.pem -pubout -out /tmp/jwt-public.pem

# Sortie à coller dans .env (les \n sont nécessaires) :
echo "JWT_PRIVATE_KEY=\"$(awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' /tmp/jwt-private.pem)\""
echo "JWT_PUBLIC_KEY=\"$(awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' /tmp/jwt-public.pem)\""
```

### 3.2 HMAC + clé de chiffrement (32 bytes hex chacun)

```bash
node -e "console.log('HMAC_SECRET=\"' + require('crypto').randomBytes(32).toString('hex') + '\"')"
node -e "console.log('HEALTH_DATA_ENCRYPTION_KEY=\"' + require('crypto').randomBytes(32).toString('hex') + '\"')"
```

Colle les 4 sorties dans `.env`.

### 3.3 Configuration S3 (déjà bonne pour le local)

Les valeurs MinIO par défaut dans `.env.example` fonctionnent telles quelles :

```env
OVH_S3_ENDPOINT="http://localhost:9000"
OVH_S3_BUCKET="diabeo-documents"
OVH_S3_ACCESS_KEY="minioadmin"
OVH_S3_SECRET_KEY="minioadmin"
OVH_S3_REGION="gra"
```

### 3.4 Variables optionnelles (peuvent rester vides)

| Variable | Effet si vide |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_KEY` + `FIREBASE_PROJECT_ID` | Push notifs renvoient 503 (dégradation silencieuse) |
| `RESEND_API_KEY` | Emails non envoyés (loggués dans la console à la place) |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Session revocation en mémoire (perdue au restart du serveur) |

---

## 4. Appliquer les migrations + seed

```bash
pnpm prisma generate
pnpm prisma migrate deploy   # applique baseline_v1 + post_deploy_sql + audit_metadata_patientid_gin
pnpm prisma db seed
```

Le seed crée :
- 5 users (admin, doctor, nurse, 2 patients DT1 + DT2)
- 30 jours de données CGM déterministes
- Configurations insuline complètes (ISF, ICR, basal par slot horaire)

---

## 5. Lancer le serveur dev

```bash
pnpm dev
# → http://localhost:3000
```

---

## 6. Se connecter

| Email | Mot de passe | Rôle |
|---|---|---|
| `admin@diabeo.test` | `Admin123!` | ADMIN |
| `docteur@diabeo.test` | `Doctor123!` | DOCTOR |
| `infirmiere@diabeo.test` | `Nurse123!` | NURSE |
| `patient.dt1@diabeo.test` | `Patient123!` | VIEWER (DT1) |
| `patient.dt2@diabeo.test` | `Patient123!` | VIEWER (DT2) |

> ⚠️ Ces credentials sont **uniquement** pour le dev local. Les valeurs sont
> définies dans `prisma/seed.ts`. Le TLD `.test` est réservé (RFC 2606) — il
> ne résoudra jamais publiquement, garantissant qu'on ne risque pas d'envoyer
> un email accidentel à un domaine réel.

---

## Routes intéressantes à explorer

| Route | Description |
|---|---|
| `/login` | Connexion (rate limit visible après 3 échecs) |
| `/` | Dashboard (KPI patients, alertes, TIR moyen) |
| `/patients` | Liste filtrable par pathologie DT1/DT2/GD |
| `/patients/1` | Fiche patient DT1 avec 30j CGM (4 onglets) |
| `/adjustment-proposals` | Workflow ajustement médecin (US-2047) |
| `/devices/pair?patientId=1` | Wizard pairing 3 étapes (US-2089) |
| `/import` | **Import MyDiabby** — connecter un compte, sync CGM. ⚠️ Gate `isStagingEnv()` : ouvert en dev local (`NODE_ENV=development`) ET recette (`APP_ENV=staging`), 404 en production. |
| Switcher locale en bas du sidebar | FR / EN / AR avec RTL pour l'arabe (US-2112) |

---

## Outils utiles

### Prisma Studio (interface DB visuelle)

```bash
pnpm prisma studio
# → http://localhost:5555
```

### Vérifications

```bash
pnpm test           # 1184 tests Vitest
pnpm tsc --noEmit   # type check (doit retourner exit 0)
pnpm lint           # ESLint (17 warnings préexistants, 0 errors)
```

### Tests E2E (Playwright)

```bash
pnpm exec playwright install --with-deps chromium   # 1x setup
pnpm test:e2e
```

---

## Reset & cleanup

### Reset complet de la DB locale (data jetée)

```bash
docker compose --profile local down -v   # -v supprime les volumes
docker compose --profile local up -d
pnpm prisma migrate deploy
npx tsx prisma/seed.ts
```

### Arrêt propre (data conservée)

```bash
# Ctrl+C dans le terminal qui fait tourner `pnpm dev`
docker compose --profile local down
```

### Redémarrage rapide

```bash
docker compose --profile local up -d
pnpm dev
```

---

## Troubleshooting

### 🚨 Solution universelle : reset complet

> 90 % des soucis en local viennent d'une DB dans un état incohérent
> (mélange `db push` historique + nouvelles migrations, schéma partiel,
> seed désaligné). **Commence toujours par ça** avant de débugger plus
> finement :

```bash
docker compose --profile local down -v   # -v supprime les volumes (data jetée)
docker compose --profile local up -d
sleep 5
pnpm prisma migrate deploy
pnpm prisma db seed
```

Si ça résout, le problème était de l'état résiduel. Sinon, voir les
sections ci-dessous.

### "Cannot connect to database"

```bash
docker compose --profile local ps    # postgres doit être healthy
docker compose --profile local logs postgres
```

### "Prisma migrate deploy" échoue sur `_prisma_migrations` already exists

Tu as une DB qui tournait avec `db push` avant US-2267. Solution :

```bash
pnpm prisma migrate resolve --applied 20260508135636_baseline_v1
pnpm prisma migrate resolve --applied 20260508140000_post_deploy_sql
pnpm prisma migrate resolve --applied 20260508150000_audit_metadata_patientid_gin
pnpm prisma migrate status   # doit dire "Database schema is up to date"
```

### Erreur de chiffrement au login

`HEALTH_DATA_ENCRYPTION_KEY` doit faire **exactement 32 bytes hex** (64 caractères
hexadécimaux). Re-générer si nécessaire :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

⚠️ Si tu changes la clé après avoir seedé, tu dois reset la DB
(`docker compose down -v` + remigrate + reseed) — l'ancien chiffrement n'est plus
déchiffrable.

### Port 5432, 9000, 9001 déjà utilisés

Un Postgres / MinIO local tourne déjà. Soit l'arrêter, soit changer les ports
dans `docker-compose.yml` (mais alors aussi dans `.env`).

---

## Pour aller plus loin

- Architecture & ADR : [CLAUDE.md](../CLAUDE.md)
- Roadmap : [docs/ROADMAP.md](./ROADMAP.md)
- Migrations Prisma : [docs/runbook/migrations.md](./runbook/migrations.md)
- Partitioning CGM (à activer quand le volume justifie) : [docs/runbook/postgres-partitioning.md](./runbook/postgres-partitioning.md)
