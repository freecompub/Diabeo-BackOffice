# SCR-183 — Statut sync temps réel cohorte

> 🔵 Priorité **V1** · 📄 Type **PAGE** · Catégorie **12-Dispositifs**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-183` |
| **Catégorie** | 12-Dispositifs |
| **Nom** | Statut sync temps réel cohorte |
| **Type** | PAGE |
| **Priorité** | **V1** |
| **Story points** | 8 |
| **Route Next.js** | `/analytics/sync-status` |

---

## 🎭 Personas concernés

DOCTOR, ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Analytics

### Mène vers (enfants / sorties)
Fiche patient

---

## 🎨 États possibles

- `loading`
- `default`
- `filtered`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Indicateur live : sync OK / retard / critique. Filtre cohorte. Bulk actions.

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
CohortSyncBoard, FreshnessIndicator
```

### Route Next.js

```
/analytics/sync-status
```

### User Stories référencées

- US-2243 Statut sync


---

## ✅ Définition de Done (écran)

### Design
- [ ] Wireframe basse fidélité validé
- [ ] Maquette haute fidélité (Figma) validée par PO
- [ ] Tous les états listés ci-dessus sont designés
- [ ] Variantes responsive (≥1024px / 768px-1024px / <768px) si applicable
- [ ] Conformité design system Diabeo (Sérénité Active)
- [ ] Accessibility review : contraste, taille texte, focus order
- [ ] Mode sombre testé si applicable

### Développement
- [ ] Composants React implémentés (cf liste ci-dessus)
- [ ] Route Next.js fonctionnelle
- [ ] Tous les états gérés (loading, empty, error, success...)
- [ ] RBAC appliqué (cf US référencées)
- [ ] Tests E2E Playwright sur scénario nominal
- [ ] Tests d'accessibilité axe-core verts (0 critique)
- [ ] Performance : LCP < 2.5s, INP < 200ms (si page)
- [ ] Internationalisation FR + AR (RTL) si UI

### Validation
- [ ] Code review approuvée
- [ ] Validation produit / PO
- [ ] Validation healthcare-security-auditor si écran sensible

---

## 🔗 Ressources

- Cartographie complète : [`README.md`](../README.md)
- Index par catégorie : [`12-dispositifs/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
