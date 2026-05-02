# SCR-140 — Editor — Ratios IC/FS par tranche horaire

> 🟢 Priorité **MVP** · 💬 Type **MODAL** · Catégorie **05-FichePatient**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-140` |
| **Catégorie** | 05-FichePatient |
| **Nom** | Editor — Ratios IC/FS par tranche horaire |
| **Type** | MODAL |
| **Priorité** | **MVP** |
| **Story points** | 8 |
| **Route Next.js** | `(modal full-page)` |

---

## 🎭 Personas concernés

DOCTOR

---

## 🧭 Navigation

### Vient de (parents)
Tab Insuline

### Mène vers (enfants / sorties)
Confirmation

---

## 🎨 États possibles

- `view`
- `editing`
- `validation-error (bornes sécurité)`
- `saving`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Timeline 24h, segments éditables, valeurs par segment, alertes bornes cliniques

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
TimelineEditor, RatioSlot, BoundsValidator
```

### Route Next.js

```
(modal full-page)
```

### User Stories référencées

- US-2044 IC
- US-2045 FS
- US-2048 Bornes sécurité


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
- Index par catégorie : [`05-fichepatient/README.md`](README.md)
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
