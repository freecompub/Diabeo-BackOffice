# SCR-163 — Configuration seuils alertes hypo/hyper

> 🟢 Priorité **MVP** · 💬 Type **MODAL** · Catégorie **09-ConfigSeuils**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-163` |
| **Catégorie** | 09-ConfigSeuils |
| **Nom** | Configuration seuils alertes hypo/hyper |
| **Type** | MODAL |
| **Priorité** | **MVP** |
| **Story points** | 5 |
| **Route Next.js** | `(modal)` |

---

## 🎭 Personas concernés

DOCTOR

---

## 🧭 Navigation

### Vient de (parents)
Configuration patient

### Mène vers (enfants / sorties)
Validation

---

## 🎨 États possibles

- `view`
- `editing`
- `validation-error`
- `saving`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Seuils niveau 1 / niveau 2, jour/nuit différenciés, alerte vibreur/son

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
AlertThresholdsEditor, NightDayDiff
```

### Route Next.js

```
(modal)
```

### User Stories référencées

- US-2215 Config seuils alerte


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
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
