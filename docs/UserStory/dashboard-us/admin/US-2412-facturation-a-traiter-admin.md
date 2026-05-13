# US-2412 — Facturation à traiter (admin)

> 📌 **admin** · Priorité **V1** · Satellite de `US-2410`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2412` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **8** |
| **Persona** | ADMIN |
| **Dépendances** | US-2107 (Tableau revenus — Groupe 7 Facturation), US-2410 |
| **US parente** | `US-2410` |

---

## 📋 Contexte produit

Section centrale du dashboard administrateur — vue synthétique de la facturation à traiter. 3 sous-cards (Impayées / En retard / Encaissées) + Top 3 impayées avec liens directs vers les factures. Drill-down rapide pour traiter une facture en 2 clics.

---

## 🎨 Composition

### Layout
- Header : icône receipt + 'Facturation à traiter'
- 3 sous-cards (Impayées rouge, En retard ambre, Encaissées vert)
  - Chaque : chiffre + montant
- Section 'Top 3 impayées' :
  - 3 lignes : référence facture + patient + montant
- CTA 'Voir tout' → page Facturation

### Drill-down
- Tap sur ligne facture → page Détail facture
- Actions disponibles : relancer, refund, marquer payé

---

## ✅ Critères d'acceptation

### AC-1 — 3 sous-cards
```gherkin
Étant donné ADMIN consulte facturation
Quand section se rend
Alors 3 sous-cards (Impayées / En retard / Encaissées) avec chiffres + montants
```

### AC-2 — Top 3 impayées
```gherkin
Étant donné 8 factures impayées
Quand section se rend
Alors 3 lignes top impayées triées par montant décroissant
```

### AC-3 — Drill-down facture
```gherkin
Étant donné ADMIN clique sur ligne facture
Quand il valide
Alors page Détail facture s'ouvre avec actions
```

### AC-4 — Calcul totaux exacts
```gherkin
Étant donné data backend
Quand section calcule
Alors montants exacts (TTC) affichés
```

### AC-5 — Cache 10 min
```gherkin
Étant donné ADMIN recharge
Quand valeurs servies depuis cache
Alors TTL 10 min
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Cache Redis 10 min pour totaux facturation
- **RM-2** : Top 3 impayées triées par montant décroissant
- **RM-3** : En retard = impayée depuis >30j
- **RM-4** : Encaissées = facturées et payées dans le mois en cours

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/admin/billing
  → { unpaid: { count, amount }, late: { count, amount }, paid: { count, amount }, topUnpaid: [...] }
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | 3 sous-cards + top 3 |
| Loading | Skeleton 3 sous-cards + 3 lignes |
| Empty (rare) | 'Aucune facture à traiter' |

---

## 🧪 Tests prioritaires

- **Calculs totaux** : valider dataset connu
- **Tri top 3** : valider par montant décroissant
- **Drill-down** : navigation correcte vers page Détail facture
- **Cache 10 min** : TTL vérifié

---

## 📦 DoD dashboard-spécifique

- [ ] 3 sous-cards exactes
- [ ] Top 3 impayées triées correctement
- [ ] Drill-down fonctionnel
- [ ] Cache configuré
- [ ] Edge case 'En retard >30j' correct

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2410
- US liée : US-2107 (et le Groupe 7 Facturation au complet : US-2102 à US-2110)

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
