# US-2276 — KPI activité cabinet (admin)

> 📌 **admin** · Priorité **V1** · Satellite de `US-2267`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2276` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **5** |
| **Persona** | ADMIN |
| **Dépendances** | US-2150 (analytics cabinet), US-2200 (gestion users), US-2267 |
| **US parente** | `US-2267` |

---

## 📋 Contexte produit

Section haute du dashboard administrateur — 4 cards KPI activité du mois : CA, patients actifs, équipe, audit HDS. Vue agrégée pilotage cabinet. Pas de drill-down clinique (réservé médecin), juste pilotage administratif.

---

## 🎨 Composition

### Layout
- 4 cards en grille horizontale
- Chaque card :
  - Label (11pt secondary)
  - Icône à droite (couleur ambre)
  - Grand chiffre (24pt) ou texte (J-12 pour audit)
  - Évolution (vs période précédente)

### Les 4 KPI
1. **CA du mois** (12 850 €) - évolution vs mois -1
2. **Patients actifs** (142) - évolution
3. **Équipe** (6) - répartition rôles
4. **Audit HDS** (J-12) - compte à rebours avec couleur évolutive

---

## ✅ Critères d'acceptation

### AC-1 — 4 KPI affichés
```gherkin
Étant donné ADMIN ouvre le dashboard
Quand section se rend
Alors 4 cards horizontales visibles
```

### AC-2 — CA évolution
```gherkin
Étant donné CA a augmenté de 18% vs mois -1
Quand card CA se rend
Alors +18% vs avril ↗ (vert)
```

### AC-3 — Audit HDS compte à rebours
```gherkin
Étant donné audit dû dans 12 jours
Quand card audit se rend
Alors J-12 (ambre, transition rouge si <7j)
```

### AC-4 — Multi-cabinet
```gherkin
Étant donné ADMIN switch cabinet
Quand section se rend
Alors KPI rechargés pour nouveau cabinet
```

### AC-5 — Cache 5 min
```gherkin
Étant donné ADMIN recharge dashboard 2 min plus tard
Quand même valeur
Alors KPI servis depuis cache Redis
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Cache Redis 5 min pour KPI (calculs coûteux)
- **RM-2** : Couleur audit : ambre si <14j, rouge si <7j
- **RM-3** : CA inclut TVA séparément si configuré
- **RM-4** : Multi-cabinet : KPI rechargés au switch

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/admin/kpi?cabinetId=...
  → { revenue, activePatients, teamSize, auditHdsDaysRemaining, trends }
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | 4 KPI affichés |
| Audit imminent (<14j) | Card ambre |
| Audit très imminent (<7j) | Card rouge |
| Loading | Skeleton 4 cards |

---

## 🧪 Tests prioritaires

- **Calcul CA** : valider avec dataset connu
- **Compte à rebours audit** : tester >14j, 14j, 7j, 0
- **Multi-cabinet** : valider rechargement
- **Cache Redis** : TTL 5 min vérifié

---

## 📦 DoD dashboard-spécifique

- [ ] 4 KPI exacts
- [ ] Compte à rebours audit avec couleurs
- [ ] Multi-cabinet fonctionnel
- [ ] Cache configuré

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2267

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
