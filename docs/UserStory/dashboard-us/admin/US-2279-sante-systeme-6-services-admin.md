# US-2279 — Santé système 6 services (admin)

> 📌 **admin** · Priorité **V1** · Satellite de `US-2267`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2279` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **8** |
| **Persona** | ADMIN |
| **Dépendances** | US-2210 (monitoring infrastructure), US-2267 |
| **US parente** | `US-2267` |

---

## 📋 Contexte produit

Section basse du dashboard administrateur — santé des 6 services critiques sur 24h : API, DB, MinIO, FCM, Email, CGM sync. Chaque service avec uptime % et indicateur visuel. Mise à jour temps réel via WebSocket pour détection rapide de panne.

---

## 🎨 Composition

### Layout
- Header : icône server + 'Santé système (24h)' + badge global
- Grid 6 colonnes
- Chaque service :
  - Indicateur LED (vert/orange/rouge)
  - Nom service
  - Uptime 24h en %

### Les 6 services
- **API** : backend principal Next.js
- **DB** : PostgreSQL 16
- **MinIO** : storage S3-compatible
- **FCM** : Firebase Cloud Messaging (push)
- **Email** : service envoi (Sendgrid / etc.)
- **CGM sync** : sync glycémies (Dexcom/Abbott APIs)

### Badge global
- 'Tous services OK' (vert) si tous up
- 'X service(s) dégradé(s)' (ambre) si 1+ dégradé
- 'X service(s) en panne' (rouge) si 1+ down

---

## ✅ Critères d'acceptation

### AC-1 — 6 services affichés
```gherkin
Étant donné ADMIN consulte la section
Quand elle se rend
Alors 6 mini-cards avec LED + uptime
```

### AC-2 — LED vert si up
```gherkin
Étant donné service à 99.98%
Quand se rend
Alors LED vert (1px 50% radius)
```

### AC-3 — LED ambre si dégradé
```gherkin
Étant donné service à 95%
Quand se rend
Alors LED orange + uptime en ambre
```

### AC-4 — LED rouge si down
```gherkin
Étant donné service à 0%
Quand se rend
Alors LED rouge + alerte visuelle
```

### AC-5 — Badge global
```gherkin
Étant donné tous services up
Quand se rend
Alors 'Tous services OK' (vert)
```

### AC-6 — WebSocket temps réel
```gherkin
Étant donné service tombe en panne
Quand WebSocket pousse événement
Alors LED passe au rouge en <30s + alerte
```

### AC-7 — Tap service → détail
```gherkin
Étant donné ADMIN clique sur service
Quand il valide
Alors page Status page interne s'ouvre
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Monitoring via probes externes (UptimeRobot ou équivalent)
- **RM-2** : Seuils : up >99%, dégradé 95-99%, down <95%
- **RM-3** : WebSocket pour mise à jour temps réel (latence <30s)
- **RM-4** : Calcul uptime 24h rolling
- **RM-5** : Pas de données patient dans cette section

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/admin/system-health
  → 6 services avec uptime + statut

WS /api/dashboard/admin/system-health/stream
  → events : service.down, service.up, service.degraded
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | 6 services avec LED vert |
| Service dégradé | 1+ LED ambre, badge global ambre |
| Service en panne | 1+ LED rouge, badge global rouge + alerte |
| WS déconnecté | Indicateur 'reconnexion en cours' |
| Loading | Skeleton 6 cards |

---

## 🧪 Tests prioritaires

- **6 services** : valider chaque avec différents statuts
- **LED** : valider couleurs selon uptime
- **WebSocket** : mise à jour temps réel <30s
- **Calcul uptime** : valider rolling 24h
- **Badge global** : tous up / dégradé / panne

---

## 📦 DoD dashboard-spécifique

- [ ] 6 services monitorés
- [ ] LED couleurs correctes
- [ ] WebSocket fonctionnel
- [ ] Calcul uptime exact
- [ ] Badge global cohérent
- [ ] Drill-down vers status page interne

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2267
- US liée : US-2210

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
