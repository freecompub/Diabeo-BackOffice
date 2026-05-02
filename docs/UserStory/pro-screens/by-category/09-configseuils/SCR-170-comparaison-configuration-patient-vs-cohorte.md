# SCR-170 — Comparaison configuration patient vs cohorte

> 🟡 Priorité **V2** · 📄 Type **PAGE** · Catégorie **09-ConfigSeuils**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-170` |
| **Catégorie** | 09-ConfigSeuils |
| **Nom** | Comparaison configuration patient vs cohorte |
| **Type** | PAGE |
| **Priorité** | **V2** |
| **Story points** | 5 |
| **Route Next.js** | `/patients/[id]/config-comparison` |

---

## 🎭 Personas concernés

DOCTOR

---

## 🧭 Navigation

### Vient de (parents)
Configuration patient

### Mène vers (enfants / sorties)
_Aucun_

---

## 🎨 États possibles

- `loading`
- `with-data`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Side-by-side : config patient vs templates vs cohorte similaire (anonymisée). Repérage outliers.

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
ConfigComparison, OutlierBadge
```

### Route Next.js

```
/patients/[id]/config-comparison
```

### User Stories référencées

- US-2223 Comparaison


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
- Index par catégorie : [`09-configseuils/README.md`](README.md)
- Index par priorité : [`../by-priority/V2.md`](../by-priority/V2.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
