# SCR-253 — Recherche full-text avancée

> 🔵 Priorité **V1** · 📄 Type **PAGE** · Catégorie **23-Recherche**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-253` |
| **Catégorie** | 23-Recherche |
| **Nom** | Recherche full-text avancée |
| **Type** | PAGE |
| **Priorité** | **V1** |
| **Story points** | 8 |
| **Route Next.js** | `/search` |

---

## 🎭 Personas concernés

DOCTOR, NURSE, VIEWER

---

## 🧭 Navigation

### Vient de (parents)
Topbar / Cmd+K résultats

### Mène vers (enfants / sorties)
Détail résultat

---

## 🎨 États possibles

- `default`
- `searching`
- `results`
- `no-results`
- `advanced-mode`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Filtres : patients, documents, messages, audit. Recherche dans contenu chiffré via HMAC.

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
AdvancedSearch, FacetsPanel, ResultsList
```

### Route Next.js

```
/search
```

### User Stories référencées

- US-2019 Recherche full-text


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
- Index par catégorie : [`23-recherche/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
