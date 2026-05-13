# US-2415 — Sidebar pilotage + administration (admin)

> 📌 **admin** · Priorité **V1** · Satellite de `US-2410`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2415` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **3** |
| **Persona** | ADMIN |
| **Dépendances** | US-2012 (RBAC), US-2410 |
| **US parente** | `US-2410` |

---

## 📋 Contexte produit

Sidebar dédiée au rôle ADMIN. Structure en 2 sections distinctes : Pilotage (vues stratégiques) + Administration (actions opérationnelles). Couleur ambre cohérente avec dashboard administrateur. Badges count sur sections nécessitant action.

---

## 🎨 Composition

### Section 1 — Pilotage (top)
- 📊 Tableau de bord (actif sur page admin)
- 📈 Analytics

### Divider

### Section 2 — Administration
- 💰 Facturation (badge count impayées)
- 👥 Utilisateurs (count équipe)
- 🔒 RGPD & audit (badge count demandes)
- 📊 Système
- ⚙️ Paramètres

### Bottom
- Mon compte (link vers profil)

### Couleurs
- Section active : background ambre clair, texte ambre foncé
- Hover : background neutre
- Badges : rouge pour impayées critique, ambre pour à traiter

---

## ✅ Critères d'acceptation

### AC-1 — 2 sections distinctes
```gherkin
Étant donné ADMIN ouvre le backoffice
Quand sidebar se rend
Alors Pilotage en haut, Administration en bas séparé par divider
```

### AC-2 — État actif visuel
```gherkin
Étant donné ADMIN est sur 'Tableau de bord'
Quand sidebar se rend
Alors 'Tableau de bord' surligné en ambre
```

### AC-3 — Badge count Facturation
```gherkin
Étant donné 8 factures impayées
Quand sidebar se rend
Alors badge '8' rouge à côté de 'Facturation'
```

### AC-4 — Badge count RGPD
```gherkin
Étant donné 2 demandes RGPD ouvertes
Quand sidebar se rend
Alors badge '2' ambre à côté de 'RGPD & audit'
```

### AC-5 — Navigation par tap
```gherkin
Étant donné ADMIN clique 'Utilisateurs'
Quand il valide
Alors page gestion utilisateurs s'ouvre
```

### AC-6 — Multi-cabinet
```gherkin
Étant donné ADMIN appartient à 2 cabinets
Quand sidebar se rend
Alors switcher en haut au-dessus des sections
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Sidebar visible uniquement pour rôle ADMIN
- **RM-2** : Couleur ambre cohérente avec dashboard admin
- **RM-3** : Badges count rafraîchis avec les valeurs réelles (pas en dur)
- **RM-4** : Multi-cabinet : switcher en haut, reload du dashboard au switch

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/admin/sidebar-data
  → { unpaidCount, teamSize, rgpdRequestsCount, cabinets (si multi) }
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default ADMIN | Sidebar complète visible |
| Non-ADMIN | Sidebar admin non rendue (redirige page 403) |
| Multi-cabinet | Switcher en haut |
| Loading | Skeleton sidebar |

---

## 🧪 Tests prioritaires

- **RBAC** : sidebar admin uniquement pour ADMIN
- **Badges** : valider count exact
- **État actif** : surligné selon page courante
- **Multi-cabinet** : switcher fonctionnel
- **Accessibilité** : navigation clavier OK

---

## 📦 DoD dashboard-spécifique

- [ ] Sidebar visible uniquement ADMIN
- [ ] Badges count corrects et rafraîchis
- [ ] État actif visuel
- [ ] Multi-cabinet fonctionnel
- [ ] Accessibilité clavier validée

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2410

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
