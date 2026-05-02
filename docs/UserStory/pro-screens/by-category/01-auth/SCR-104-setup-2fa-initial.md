# SCR-104 — Setup 2FA initial

> 🟢 Priorité **MVP** · 🧙 Type **WIZARD_STEP** · Catégorie **01-Auth**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-104` |
| **Catégorie** | 01-Auth |
| **Nom** | Setup 2FA initial |
| **Type** | WIZARD_STEP |
| **Priorité** | **MVP** |
| **Story points** | 5 |
| **Route Next.js** | `/setup/2fa` |

---

## 🎭 Personas concernés

Tous rôles 1ère connexion

---

## 🧭 Navigation

### Vient de (parents)
Dashboard (1ère connexion)

### Mène vers (enfants / sorties)
Codes de récup, Dashboard

---

## 🎨 États possibles

- `default`
- `scanning`
- `success`
- `error code invalide`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

QR code à scanner, code manuel, validation par 1er TOTP

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
QrCodeDisplay, OtpInput, BackupCodes
```

### Route Next.js

```
/setup/2fa
```

### User Stories référencées

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
