# SCR-250 — Sécurité du compte

> 🟢 Priorité **MVP** · 📄 Type **PAGE** · Catégorie **22-Profil**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-250` |
| **Catégorie** | 22-Profil |
| **Nom** | Sécurité du compte |
| **Type** | PAGE |
| **Priorité** | **MVP** |
| **Story points** | 5 |
| **Route Next.js** | `/account/security` |

---

## 🎭 Personas concernés

Tous

---

## 🧭 Navigation

### Vient de (parents)
Menu user

### Mène vers (enfants / sorties)
Changement mdp, Setup 2FA

---

## 🎨 États possibles

- `default`
- `editing-mdp`
- `regenerating-2fa`
- `saved`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Changer mdp, activer/désactiver 2FA, codes récup, sessions actives

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
SecurityForm, TwoFactorManager, SessionsList
```

### Route Next.js

```
/account/security
```

### User Stories référencées

- US-2002 2FA
- US-2007 Sessions


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
- Index par catégorie : [`22-profil/README.md`](README.md)
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
