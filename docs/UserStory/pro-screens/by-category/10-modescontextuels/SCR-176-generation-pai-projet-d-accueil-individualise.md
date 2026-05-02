# SCR-176 — Génération PAI (Projet d'Accueil Individualisé)

> 🟡 Priorité **V2** · 📄 Type **PAGE** · Catégorie **10-ModesContextuels**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-176` |
| **Catégorie** | 10-ModesContextuels |
| **Nom** | Génération PAI (Projet d'Accueil Individualisé) |
| **Type** | PAGE |
| **Priorité** | **V2** |
| **Story points** | 13 |
| **Route Next.js** | `/patients/[id]/pai` |

---

## 🎭 Personas concernés

DOCTOR + parents + école

---

## 🧭 Navigation

### Vient de (parents)
Fiche patient pédiatrique

### Mène vers (enfants / sorties)
Signature numérique

---

## 🎨 États possibles

- `draft`
- `completing`
- `signing`
- `signed`
- `downloaded`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Template HAS, protocole urgence, autorisation médicaments, signatures multi-parties

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
PaiTemplate, MultiPartySigner
```

### Route Next.js

```
/patients/[id]/pai
```

### User Stories référencées

- US-2236 PAI numérique


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
- Index par priorité : [`../by-priority/V2.md`](../by-priority/V2.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
