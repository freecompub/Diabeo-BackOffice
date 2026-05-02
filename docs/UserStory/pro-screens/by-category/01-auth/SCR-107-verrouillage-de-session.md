# SCR-107 — Verrouillage de session

> 🔵 Priorité **V1** · 💬 Type **MODAL** · Catégorie **01-Auth**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-107` |
| **Catégorie** | 01-Auth |
| **Nom** | Verrouillage de session |
| **Type** | MODAL |
| **Priorité** | **V1** |
| **Story points** | 3 |
| **Route Next.js** | `(overlay global)` |

---

## 🎭 Personas concernés

Tous rôles

---

## 🧭 Navigation

### Vient de (parents)
Tout écran après inactivité

### Mène vers (enfants / sorties)
Page connexion ou retour

---

## 🎨 États possibles

- `default`
- `success (mdp correct)`
- `error`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Affichage minimal pour ne pas exposer données. Champ mdp ou biométrie.

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
LockOverlay, PasswordField, BiometricButton
```

### Route Next.js

```
(overlay global)
```

### User Stories référencées

- US-2007 Sessions multiples


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
