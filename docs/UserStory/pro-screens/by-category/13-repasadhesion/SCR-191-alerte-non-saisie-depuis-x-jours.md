# SCR-191 — Alerte non-saisie depuis X jours

> 🔵 Priorité **V1** · 💬 Type **MODAL** · Catégorie **13-RepasAdhesion**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-191` |
| **Catégorie** | 13-RepasAdhesion |
| **Nom** | Alerte non-saisie depuis X jours |
| **Type** | MODAL |
| **Priorité** | **V1** |
| **Story points** | 3 |
| **Route Next.js** | `(modal)` |

---

## 🎭 Personas concernés

DOCTOR (config) / Notif

---

## 🧭 Navigation

### Vient de (parents)
Configuration patient ou Dashboard

### Mène vers (enfants / sorties)
Action relance

---

## 🎨 États possibles

- `config`
- `alert-active`
- `dismissed`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Configuration seuil + relance auto + tracking

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
NoSaveAlertConfig
```

### Route Next.js

```
(modal)
```

### User Stories référencées

- US-2253 Alerte non-saisie


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
- Index par catégorie : [`13-repasadhesion/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
