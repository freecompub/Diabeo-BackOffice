# SCR-103 — Récupération mot de passe — Définition nouveau

> 🟢 Priorité **MVP** · 📄 Type **PAGE** · Catégorie **01-Auth**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-103` |
| **Catégorie** | 01-Auth |
| **Nom** | Récupération mot de passe — Définition nouveau |
| **Type** | PAGE |
| **Priorité** | **MVP** |
| **Story points** | 3 |
| **Route Next.js** | `/reset-password/[token]` |

---

## 🎭 Personas concernés

Tous rôles via lien email

---

## 🧭 Navigation

### Vient de (parents)
Email reçu

### Mène vers (enfants / sorties)
Page connexion

---

## 🎨 États possibles

- `default`
- `error token invalide/expiré`
- `error mdp trop faible`
- `success`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Indicateur force mdp en temps réel, double saisie, contraintes affichées

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
PasswordField, PasswordStrength, ConfirmField
```

### Route Next.js

```
/reset-password/[token]
```

### User Stories référencées

- US-2003 Reset password email
- US-2006 Politique mdp


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
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
