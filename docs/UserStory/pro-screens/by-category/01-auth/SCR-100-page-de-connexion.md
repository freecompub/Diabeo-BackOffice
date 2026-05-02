# SCR-100 — Page de connexion

> 🟢 Priorité **MVP** · 📄 Type **PAGE** · Catégorie **01-Auth**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-100` |
| **Catégorie** | 01-Auth |
| **Nom** | Page de connexion |
| **Type** | PAGE |
| **Priorité** | **MVP** |
| **Story points** | 5 |
| **Route Next.js** | `/login` |

---

## 🎭 Personas concernés

Tous rôles non authentifiés

---

## 🧭 Navigation

### Vient de (parents)
_Aucun_

### Mène vers (enfants / sorties)
Mot de passe oublié, Saisie 2FA, Dashboard (post-auth)

---

## 🎨 États possibles

- `default`
- `loading`
- `error (mauvais credentials)`
- `error (compte verrouillé)`
- `error (rate limited)`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Champ email + mdp, bouton biométrie/PSC, lien mot de passe oublié, bouton création compte (médecin)

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
LoginForm, PasswordField, BiometricButton, PscButton, ErrorBanner
```

### Route Next.js

```
/login
```

### User Stories référencées

- US-2001 Login JWT
- US-2002 2FA TOTP


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
