# SCR-243 — OCR document scanné

> 🟡 Priorité **V2** · 💬 Type **MODAL** · Catégorie **20-Documents**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-243` |
| **Catégorie** | 20-Documents |
| **Nom** | OCR document scanné |
| **Type** | MODAL |
| **Priorité** | **V2** |
| **Story points** | 5 |
| **Route Next.js** | `(modal)` |

---

## 🎭 Personas concernés

DOCTOR, NURSE

---

## 🧭 Navigation

### Vient de (parents)
Upload document (option)

### Mène vers (enfants / sorties)
Validation OCR

---

## 🎨 États possibles

- `uploading`
- `ocr-processing`
- `results`
- `validation`
- `applied`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Tesseract/Vision API, indexation full-text, validation manuelle

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
OcrFlow, ResultsValidator
```

### Route Next.js

```
(modal)
```

### User Stories référencées

- US-2144 OCR


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
- Index par catégorie : [`20-documents/README.md`](README.md)
- Index par priorité : [`../by-priority/V2.md`](../by-priority/V2.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
