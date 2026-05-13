# US-2410 — Dashboard administrateur (page principale)

> 📌 **admin** · Priorité **V1**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2410` |
| **Type** | Page composite |
| **Priorité** | **V1** |
| **Story points** | **8** |
| **Persona** | ADMIN (🖥️ Web ≥1024px) |
| **Dépendances** | US-2001 (login), US-2011 (audit), US-2012 (RBAC ADMIN), US-2411 (KPI activité), US-2412 (facturation), US-2413 (conformité), US-2415 (sidebar admin) |

---

## 📋 Contexte produit

Dashboard du rôle ADMIN — orienté **pilotage cabinet** (activité, conformité, infrastructure) plutôt que clinique. CA mensuel, factures impayées, audit HDS, demandes RGPD, santé système. Sessions ponctuelles ciblées (15-30 min, quelques fois/semaine). Couleur ambre pour distinguer des 3 autres dashboards.

Cf prototype interactif « Dashboard administrateur » et écran SCR-117 (à ajouter).

---

## 🎨 Composition

### KPI activité (4 cards en haut)
- CA du mois · Patients actifs · Équipe · Audit HDS
- Source : US-2411

### Zone principale (3/5 + 2/5)

**Gauche : Facturation à traiter (3/5)**
- Source : US-2412
- 3 sous-cards (Impayées / En retard / Encaissées)
- Top 3 impayées avec liens factures

**Droite : Conformité & RGPD (2/5)**
- Source : US-2413
- Statuts : Audit HDS, Demandes RGPD, Backup, Notifs CNIL

### Zone basse : Santé système 24h
### Sidebar dédiée admin
- Source : US-2415
- 2 sections : Pilotage + Administration
- Pilotage : Tableau de bord (actif), Analytics
- Administration : Facturation, Utilisateurs, RGPD & audit, Système, Paramètres

---

## ✅ Critères d'acceptation

### AC-1 — Composition pilotage
```gherkin
Étant donné ADMIN connecté
Quand il ouvre le dashboard
Alors 4 KPI activité en haut, facturation + conformité au milieu, santé système en bas
```

### AC-2 — Multi-cabinet
```gherkin
Étant donné ADMIN appartient à plusieurs cabinets
Quand il ouvre le dashboard
Alors switcher de cabinet visible dans sidebar, dashboard reflète le cabinet actif
```

### AC-3 — Drill-down facture impayée
```gherkin
Étant donné facture impayée depuis 30j+
Quand l'ADMIN clique dessus
Alors atterrit sur Détail facture avec actions (relancer, refund, ...)
```

### AC-4 — Alerte audit HDS imminent
```gherkin
Étant donné audit HDS dû dans <14 jours
Quand l'ADMIN consulte le dashboard
Alors card audit en orange avec compte à rebours + CTA 'Préparer audit'
```

### AC-5 — Santé système temps réel
```gherkin
Étant donné un service externe tombe en panne
Quand l'ADMIN consulte le dashboard
Alors service en orange/rouge avec dernière mesure d'uptime
```

### AC-6 — Demande RGPD nouvelle
```gherkin
Étant donné patient soumet une demande RGPD
Quand l'ADMIN charge le dashboard
Alors compteur 'Demandes RGPD' incrémenté, alerte visuelle
```

### AC-7 — RBAC strict ADMIN
```gherkin
Étant donné utilisateur non-ADMIN essaie d'accéder
Quand il tape l'URL /admin
Alors redirigé vers page 403 avec message explicite
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Accès strictement réservé au rôle ADMIN (middleware requireRole(['ADMIN']))
- **RM-2** : Données affichées agrégées (CA, totaux, %) — pas de données patient individuelles sauf cas conformité
- **RM-3** : Cache Redis longues durées (TTL 5 min KPI, 1 min santé système, 10 min facturation)
- **RM-4** : Multi-cabinet : si ADMIN appartient à 2+ cabinets, switcher en haut de sidebar
- **RM-5** : Audit HDS et notifications CNIL avec compte à rebours visuel (orange <14j, rouge <7j)
- **RM-6** : Santé système monitorée via probes externes (uptime monitoring service)
- **RM-7** : Couleur dominante ambre #BA7517 pour distinction visuelle

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/admin
  → { kpiActivity, billingToProcess, compliance, systemHealth }

GET /api/admin/cabinets (si multi-entité)
  → cabinets accessibles par l'ADMIN

WS /api/admin/system-health/stream
  → events : service.down, service.up, service.degraded
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | KPI + facturation + conformité + santé système |
| Loading | Skeleton par section |
| Multi-cabinet | Switcher dans sidebar, contexte rechargé au switch |
| Audit imminent (<14j) | Card orange avec compte à rebours |
| Service dégradé | Card santé système orange avec uptime affiché |
| 403 non-ADMIN | Page d'accès refusé avec message |

---

## 🧪 Tests prioritaires

- **RBAC ADMIN strict** : tentative non-ADMIN → 403
- **Multi-cabinet** : tester switcher avec ADMIN appartenant à 2+ cabinets
- **Drill-down** : clic sur facture impayée → page détail
- **Audit HDS imminent** : tester compte à rebours et alerte visuelle
- **Santé système** : simuler panne service → mise à jour temps réel
- **Cache Redis** : valider TTL différenciés

> Plan de test détaillé dans `docs/testing/baseline.md`.

---

## 📦 DoD dashboard-spécifique

- [ ] RBAC ADMIN strict appliqué (tests 403 pour autres rôles)
- [ ] Multi-cabinet fonctionnel (switcher + contexte)
- [ ] Tous les drill-downs opérationnels
- [ ] Cache Redis configuré avec TTL appropriés
- [ ] WebSocket santé système testé
- [ ] Validation produit avec ADMIN réel
- [ ] Conformité HDS de l'écran lui-même (audit ses propres logs)

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- Cartographie écran : SCR-117 (Dashboard administrateur — à ajouter)
- Prototype : Dashboard administrateur
- US satellites : US-2411, US-2412, US-2413, US-2415

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
