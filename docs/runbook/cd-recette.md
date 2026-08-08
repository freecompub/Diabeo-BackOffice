# Runbook — Déploiement continu (CD) recette via GitHub Actions

> Déploie **automatiquement la recette** à chaque merge sur `main`, si la CI est
> verte. Exécution sur un **runner self-hosted** installé sur le VPS recette
> (aucune clé SSH exposée). Workflow : `.github/workflows/deploy-recette.yml`.

## 1. Comment ça marche

```
merge sur main  →  workflow "CI" (tests)  ──verte──▶  workflow "Deploy recette"
                                                        └─ runner self-hosted (VPS)
                                                           └─ /opt/diabeo/deploy.sh update
                                                              (pull + migrate deploy + build + restart)
```

- Déclencheur : `workflow_run` sur la **fin** du workflow `CI` (branche `main`) —
  le deploy ne part **que si `conclusion == success`** (CI verte). Plus un
  `workflow_dispatch` (ré-exécution manuelle depuis l'onglet Actions).
- `concurrency: deploy-recette` : un seul déploiement à la fois.
- `environment: recette` : permet d'ajouter des règles de protection (Settings →
  Environments) et de scoper des secrets si besoin.

## 2. Installation du runner self-hosted (une seule fois, sur le VPS)

> ### 🔑 Quel token ? — **Registration token, PAS un PAT**
>
> Cette architecture **ne nécessite AUCUN Personal Access Token (PAT)**. Le
> `<TOKEN_FOURNI_PAR_GITHUB>` de la commande `config.sh` ci-dessous est un
> **registration token** :
> - il est **affiché tout prêt** par GitHub dans *Settings → Actions → Runners →
>   New self-hosted runner* (page de création du runner) ;
> - **aucune permission à choisir** — il ne sert qu'à enregistrer le runner ;
> - il est **jetable** (expire en ~1 h ; il en faut un nouveau à chaque
>   ré-enregistrement).
>
> Le reste du CD fonctionne **sans secret longue-durée** : le workflow utilise le
> `GITHUB_TOKEN` auto-injecté (`permissions: contents: read`), et le `deploy.sh`
> tire le code via la **Deploy Key SSH** déjà posée (`vps-setup.md §7.a`).
>
> **Si (et seulement si)** tu veux scripter l'enregistrement/rotation du runner via
> l'API GitHub, un fine-grained PAT **scopé au seul repo `Diabeo-BackOffice`** avec
> **Repository permissions → Administration : Read and write** (et *rien* d'autre)
> suffit. Sinon, reste sur le registration token de l'UI — c'est le sens du choix
> « runner self-hosted » : pas de PAT à gérer.

Dans GitHub : *Settings → Actions → Runners → New self-hosted runner* (Linux x64) —
suivre les commandes fournies, **en ajoutant le label `recette`** et en installant
le service sous l'utilisateur applicatif :

```bash
# En tant qu'utilisateur `diabeo` (celui qui possède /opt/diabeo)
sudo -u diabeo -i
mkdir -p ~/actions-runner && cd ~/actions-runner
# … télécharger le runner (commandes exactes données par GitHub) …
./config.sh --url https://github.com/freecompub/Diabeo-BackOffice \
            --token <TOKEN_FOURNI_PAR_GITHUB> \
            --labels recette \
            --name vps-recette --unattended
exit

# Installer en service systemd (démarre au boot, redémarre en cas de crash)
cd /home/diabeo/actions-runner
sudo ./svc.sh install diabeo
sudo ./svc.sh start
```

> Le job tourne donc **sous l'utilisateur `diabeo`**, dans le contexte du VPS — il
> peut lancer `/opt/diabeo/deploy.sh` directement.

## 3. Autorisation sudo requise

`deploy.sh update` redémarre le service via `sudo systemctl restart`. Le runner
(user `diabeo`) doit pouvoir le faire **sans mot de passe** — règle sudoers ciblée
(principe du moindre privilège, PAS de `NOPASSWD: ALL`) :

```bash
# /etc/sudoers.d/diabeo-deploy  (via `sudo visudo -f /etc/sudoers.d/diabeo-deploy`)
diabeo ALL=(root) NOPASSWD: /usr/bin/systemctl restart diabeo-recette
```

## 4. Prérequis côté VPS

- `/opt/diabeo` **déjà bootstrappé** (clone + `/etc/diabeo/recette.env` + service
  systemd `diabeo-recette`) — cf. `docs/runbook/vps-setup.md` §7/§12. Le workflow
  échoue proprement si `/opt/diabeo/deploy.sh` est absent.
- Node 22 + pnpm 10 disponibles pour l'utilisateur `diabeo`.
- Le runner a accès réseau à la DB (migrations) et au registre npm (install/build).

## 5. Environment GitHub `recette` (optionnel mais recommandé)

*Settings → Environments → New environment → `recette`*. Permet, si voulu :
- des **secrets** scopés recette,
- une **règle de protection** (ex. limiter aux branches `main`),
- un **historique de déploiements** visible dans l'onglet Environments.

## 6. Exploitation

- **Déclenchement normal** : automatique après chaque merge sur `main` (CI verte).
- **Rejouer un déploiement** : onglet *Actions → Deploy recette → Run workflow*
  (`workflow_dispatch`).
- **Logs** : onglet Actions (+ `journalctl -u diabeo-recette` sur le VPS).
- **Rollback** : la recette est jetable → `git revert` + re-run, ou
  `prisma migrate reset --force` (cf. `docs/runbook/release-glycemie-gl.md §5`).

## 7. Sécurité (rappels HDS)

- **Aucune clé SSH exposée** (runner local au VPS) ni secret d'infra dans le repo.
- Le runner tourne en utilisateur **non-root** applicatif ; sudo **ciblé** au seul
  `systemctl restart`.
- Les **migrations** sont appliquées par `migrate deploy` (idempotent) ; en recette
  jetable, une migration destructive est sans enjeu. ⚠️ **Ne PAS réutiliser ce
  modèle auto pour la PROD** : y prévoir approbation manuelle (Environment protégé
  + reviewers) + backup + pré-vol avant toute migration destructive.
- Runner self-hosted : ne l'exposer **qu'à un repo de confiance** (pas de fork PR
  exécutant du code arbitraire — ici le trigger est `workflow_run`/`dispatch` sur
  `main`, jamais un `pull_request` de fork).
