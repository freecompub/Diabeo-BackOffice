# SCR-174 — Mode voyage / fuseau horaire

> 🔵 Priorité **V1** · 💬 Type **MODAL** · Catégorie **10-ModesContextuels**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-174` |
| **Catégorie** | 10-ModesContextuels |
| **Nom** | Mode voyage / fuseau horaire |
| **Type** | MODAL |
| **Priorité** | **V1** |
| **Story points** | 5 |
| **Route Next.js** | `(modal)` |

---

## 🎭 Personas concernés

DOCTOR, NURSE, patient

---

## 🧭 Navigation

### Vient de (parents)
Fiche patient ou config

### Mène vers (enfants / sorties)
Génération protocole

---

## 🎨 États possibles

- `default`
- `configuring`
- `generating-protocol`
- `ready`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Destination, dates, fuseau, génération auto protocole adaptation doses

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
TravelModeForm, ProtocolGenerator
```

### Route Next.js

```
(modal)
```

### User Stories référencées

- US-2234 Mode voyage


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
- Index par catégorie : [`10-modescontextuels/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
