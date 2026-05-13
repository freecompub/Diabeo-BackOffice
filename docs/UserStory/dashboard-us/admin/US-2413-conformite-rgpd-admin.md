# US-2413 — Conformité & RGPD (admin)

> 📌 **admin** · Priorité **V1** · Satellite de `US-2410`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2413` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **5** |
| **Persona** | ADMIN |
| **Dépendances** | US-2190 (audit HDS), US-2191 (gestion demandes RGPD), US-2192 (notifs CNIL), US-2193 (backups), US-2410 |
| **US parente** | `US-2410` |

---

## 📋 Contexte produit

Section droite du dashboard administrateur — 4 statuts conformité critiques : audit HDS, demandes RGPD, backup, notifications CNIL. Vue synthétique des obligations légales en cours. Couleur évolutive selon urgence (vert OK, ambre à traiter, rouge urgent).

---

## 🎨 Composition

### Layout
- Header : icône shield-check + 'Conformité & RGPD'
- 4 lignes statut :
  - Audit HDS annuel (J-12) - ambre
  - Demandes RGPD (2 ouvertes) - ambre
  - Backup hier 02h (✓ OK) - vert
  - Notifs CNIL (0 en cours) - vert
- Tap chaque ligne → page dédiée

### Couleurs statuts
- Vert (✓ OK) : conformité respectée
- Ambre (à traiter) : action requise mais pas urgente
- Rouge (urgent) : action immédiate requise

---

## ✅ Critères d'acceptation

### AC-1 — 4 statuts affichés
```gherkin
Étant donné ADMIN consulte la section
Quand elle se rend
Alors 4 lignes statut visibles
```

### AC-2 — Statut vert OK
```gherkin
Étant donné backup réussi hier 02h
Quand section se rend
Alors ligne 'Backup hier 02h' avec badge ✓ OK vert
```

### AC-3 — Statut ambre à traiter
```gherkin
Étant donné 2 demandes RGPD ouvertes
Quand section se rend
Alors ligne 'Demandes RGPD' avec badge '2 ouvertes' ambre
```

### AC-4 — Tap → page dédiée
```gherkin
Étant donné ADMIN clique ligne audit HDS
Quand il valide
Alors page Audit HDS s'ouvre
```

### AC-5 — Backup en échec
```gherkin
Étant donné backup d'hier a échoué
Quand section se rend
Alors ligne avec badge ❌ ÉCHEC rouge + alerte visuelle
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Statuts mis à jour temps réel via WebSocket (changement de statut critique)
- **RM-2** : Couleur évolutive : vert → ambre (< 14j) → rouge (< 7j) pour les obligations à échéance
- **RM-3** : Backup vérifié quotidiennement via job nocturne
- **RM-4** : Notifs CNIL : remontées depuis incidents détectés

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/admin/compliance
  → { hdsAudit, rgpdRequests, backup, cnilNotifications }

WS /api/dashboard/admin/compliance/stream
  → events : compliance.changed
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | 4 lignes statut affichées |
| Statut critique | Badge rouge + alerte visuelle |
| Loading | Skeleton 4 lignes |

---

## 🧪 Tests prioritaires

- **4 statuts** : valider chaque type (vert/ambre/rouge)
- **Drill-down** : navigation correcte par ligne
- **Backup échec** : alerte visuelle
- **WebSocket** : mise à jour statut temps réel

---

## 📦 DoD dashboard-spécifique

- [ ] 4 statuts exacts
- [ ] Couleurs évolutives validées
- [ ] WebSocket testé
- [ ] Drill-downs fonctionnels
- [ ] Backup en échec → alerte

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2410
- US liées : US-2190, US-2191, US-2192, US-2193

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
