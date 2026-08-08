# Runbook — Supervision du VPS Diabeo

> Quoi installer sur le VPS (recette/prod) pour **savoir que ça tourne** et **être
> alerté avant l'incident**. Pensé pour un **VPS unique** (app Node/systemd +
> PostgreSQL + nginx ; Redis Upstash & Object Storage OVH **managés**). Complète la
> section *Monitoring* de [`docs/operations/runbook.md`](../operations/runbook.md)
> (sémantique `/api/health`, logs, audit) et le §9 backups de
> [`vps-setup.md`](./vps-setup.md).

## Principe

Trois questions, trois outils. On installe le **strict nécessaire** — pas de stack
Prometheus/Grafana/Loki (surdimensionnée pour un serveur unique).

| Question | Outil | Portée |
|---|---|---|
| L'app répond-elle ? | **Moniteur uptime externe** sur `/api/health` | Tier 0 |
| Le VPS va-t-il tomber ? (disque/RAM/CPU/Postgres) | **netdata** (local, alarmes) | Tier 0 |
| Le backup a-t-il tourné ? | **Dead-man's-switch** (Healthchecks.io) | Tier 0 |
| Trail HDS / erreurs app / brute-force | LDP, Sentry/GlitchTip, fail2ban | Tier 1 (prod) |

---

## Tier 0 — indispensable (à faire d'abord)

### 1. Moniteur uptime externe (`/api/health`)

**Pourquoi externe** : un check lancé **depuis le VPS** ne détecte pas un VPS
totalement down. Un moniteur externe teste **DNS + TLS + nginx + app** d'un coup.

- Service : UptimeRobot / BetterStack / Healthchecks (n'importe quel free tier).
- URL à surveiller : `https://staging.diabeo.fr/api/health` (prod :
  `https://app.diabeo.fr/api/health`).
- Intervalle : 60 s. Alerte sur : non-`200` **3 fois de suite**, et **expiration TLS**
  proche (la plupart des moniteurs le font nativement — filet en plus de certbot).
- Sémantique de la réponse (cf. `operations/runbook.md` §Monitoring) :
  `200 ok` · `503 degraded` (Redis down, app debout) · `503 down` (DB down).

> Rien à installer sur le VPS pour ce point — c'est un service tiers qui **appelle**
> l'endpoint public.

### 2. netdata — métriques hôte + alarmes

**Pourquoi** : sur un VPS unique, le risque n°1 est le **disque plein** (Postgres +
dumps `/tmp` + logs) puis l'**OOM**. netdata = binaire unique, per-seconde, alarmes
intégrées, empreinte faible.

```bash
# Install (paquet officiel netdata, dépôt géré par le script kickstart)
wget -qO /tmp/netdata-kickstart.sh https://get.netdata.cloud/kickstart.sh
sh /tmp/netdata-kickstart.sh --stable-channel --disable-telemetry
# → écoute en local sur 127.0.0.1:19999
```

> ⚠️ **Ne PAS exposer `:19999` publiquement.** Le dashboard netdata n'a pas d'auth.
> Y accéder via **tunnel SSH** (`ssh -L 19999:127.0.0.1:19999 diabeo-vps`) ou le
> mettre derrière nginx + Basic Auth. Vérifier qu'il n'écoute que sur loopback :
> `ss -ltnp | grep 19999`.

**Alarmes Diabeo** (modèles versionnés dans `ops/netdata/`) :

```bash
sudo cp ops/netdata/health.d/diabeo-disk.conf     /etc/netdata/health.d/
sudo cp ops/netdata/health.d/diabeo-postgres.conf /etc/netdata/health.d/
sudo netdatacli reload-health
```
- `diabeo-disk.conf` — WARN 80 % / CRIT 90 % sur l'espace **et** les inodes de `/`.
- `diabeo-postgres.conf` — saturation du pool de connexions (WARN 75 % / CRIT 90 %).
- OOM / RAM dispo / charge CPU / swap : **alarmes natives** netdata (rien à ajouter).

**Collecteur PostgreSQL** (si Postgres est **sur le VPS**) :
```bash
# Rôle de monitoring LECTURE SEULE (jamais le rôle applicatif diabeo)
sudo -u postgres psql -c "CREATE ROLE netdata LOGIN PASSWORD '<PWD_NETDATA>';"
sudo -u postgres psql -c "GRANT pg_monitor TO netdata;"
sudo cp ops/netdata/go.d/postgres.conf /etc/netdata/go.d/postgres.conf
sudo sed -i 's/<PWD_NETDATA>/<le_mot_de_passe_réel>/' /etc/netdata/go.d/postgres.conf
sudo systemctl restart netdata
```
> Postgres en **DBaaS OVH** : sauter ce collecteur (métriques dans la console OVH).

**Notifications** (email/Slack/Discord) — sinon les alarmes restent dans le dashboard :
```bash
sudo "$(dirname "$(command -v netdata)")/../libexec/netdata/plugins.d/health_alarm_notify.sh" test 2>/dev/null || true
sudo nano /etc/netdata/health_alarm_notify.conf   # renseigner p.ex. DISCORD_WEBHOOK_URL / SLACK_WEBHOOK_URL / EMAIL
# rôle "sysadmin" (utilisé par les alarmes Diabeo) → destinataire par défaut
sudo systemctl restart netdata
```

### 3. Dead-man's-switch backup (Healthchecks.io)

**Pourquoi** : un backup **silencieusement cassé** est pire que pas de backup. Le
dead-man's-switch alerte quand le ping **n'arrive pas** à l'heure prévue.

Câblé dans `deploy.sh backup` (variable `BACKUP_PING_URL`, cf. §9 `vps-setup.md`) :
il pinge `/start` au début, l'URL de base au **succès**, `/fail` en **échec**.

```bash
# 1. Créer un check sur https://healthchecks.io (schedule : daily, grâce 1h)
#    → récupérer l'URL de ping : https://hc-ping.com/<uuid>

# 2. L'ajouter à l'env du service de backup (NON committé)
echo 'BACKUP_PING_URL=https://hc-ping.com/<uuid>' | sudo tee -a /etc/diabeo/recette.env >/dev/null
# (ou dans une Environment= du service systemd de backup)

# 3. Tester une exécution manuelle
sudo -u diabeo bash -lc 'set -a; . /etc/diabeo/recette.env; set +a; cd /opt/diabeo; ./deploy.sh backup'
#    → le check passe "up" sur healthchecks.io ; si pg_dump/S3 échoue → "down" (alerte)
```

> Le timer systemd `diabeo-backup` (§9 `vps-setup.md`) déclenche ce même
> `deploy.sh backup` à 02:00 : le ping part automatiquement à chaque exécution.

---

## Tier 1 — prod / conformité HDS

À activer avant la mise en production (inutile de tout monter en recette).

- **Trail d'actions opérateur (HDS §IV.3, rétention 5 ans)** — forwarding
  `rsyslog → OVH LDP` : procédure complète dans
  [`operations/runbook.md`](../operations/runbook.md) §« Centralized log forwarding ».
  C'est l'exigence **réglementaire** ; c'est le vrai « must » du Tier 1.
- **Erreurs applicatives** — Sentry (SaaS) ou **GlitchTip** (self-host).
  ⚠️ **PII/santé** : scrubbing strict obligatoire (aucune glycémie/identité dans la
  stack d'erreurs). En cas de doute réglementaire → GlitchTip self-hosted (données
  gardées chez nous). Cf. [`.claude`/team] `healthcare-security-auditor` avant activation.
- **Brute-force / durcissement** — `fail2ban` (jails `sshd` + nginx). SSH est déjà
  key-only ; fail2ban ajoute la protection sur l'auth applicative et nginx.
- **PostgreSQL managé (DBaaS)** — activer les query logs OVH
  (`logsLevel=queries`) → LDP (cf. `operations/runbook.md` §« DB-level audit »).

---

## Ce qu'on n'installe **pas** (et pourquoi)

- **Prometheus + Grafana + Loki + Alertmanager** : conçu pour un parc/cluster.
  Sur un VPS unique, coût d'exploitation > valeur — netdata couvre le même besoin.
- **Agent de supervision pour Redis / Object Storage** : services **managés**
  (Upstash / OVH) → supervision et alertes dans leurs consoles respectives
  (ex. Upstash : alerte eval-error-rate, cf. `operations/runbook.md`).

---

## Checklist de mise en place (Tier 0)

- [ ] Moniteur uptime externe sur `/api/health` (alerte non-200 ×3 + expiration TLS).
- [ ] netdata installé, **loopback only** (`ss -ltnp | grep 19999` = 127.0.0.1).
- [ ] Alarmes `diabeo-disk.conf` (+ `diabeo-postgres.conf` si Postgres local) chargées.
- [ ] Notifications netdata configurées (rôle `sysadmin` → Slack/Discord/email).
- [ ] `BACKUP_PING_URL` renseignée + un `deploy.sh backup` manuel fait passer le check.
- [ ] (prod) LDP forwarding, Sentry/GlitchTip avec scrubbing, fail2ban.
