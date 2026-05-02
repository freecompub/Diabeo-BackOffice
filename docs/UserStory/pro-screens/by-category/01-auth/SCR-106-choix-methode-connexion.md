# SCR-106 — Choix méthode connexion

> 🔵 Priorité **V1** · 💬 Type **MODAL** · Catégorie **01-Auth**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-106` |
| **Catégorie** | 01-Auth |
| **Nom** | Choix méthode connexion |
| **Type** | MODAL |
| **Priorité** | **V1** |
| **Story points** | 2 |
| **Route Next.js** | `/login (modal méthodes)` |

---

## 🎭 Personas concernés

Médecins France

---

## 🧭 Navigation

### Vient de (parents)
Page connexion

### Mène vers (enfants / sorties)
Login PSC OAuth, e-CPS

---

## 🎨 États possibles

- `default`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Boutons : email/mdp, PSC (FR), e-CPS, carte CPS (lecteur requis)

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
AuthMethodSelector
```

### Route Next.js

```
/login (modal méthodes)
```

### User Stories référencées

- US-2008 PSC
- US-2010 e-CPS
- US-2009 Carte CPS


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
- Index par catégorie : [`01-auth/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
