# SCR-201 — Thread détail (par patient)

> 🔵 Priorité **V1** · 📄 Type **PAGE** · Catégorie **15-Messagerie**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-201` |
| **Catégorie** | 15-Messagerie |
| **Nom** | Thread détail (par patient) |
| **Type** | PAGE |
| **Priorité** | **V1** |
| **Story points** | 8 |
| **Route Next.js** | `/messages/[patientId]` |

---

## 🎭 Personas concernés

DOCTOR, NURSE, VIEWER

---

## 🧭 Navigation

### Vient de (parents)
Inbox / Fiche patient

### Mène vers (enfants / sorties)
Composer, Pièces jointes

---

## 🎨 États possibles

- `loading`
- `with-messages`
- `typing-indicator`
- `sending`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Conversation chronologique, pièces jointes, indicateurs vu/lu

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
MessageThread, MessageComposer, AttachmentList
```

### Route Next.js

```
/messages/[patientId]
```

### User Stories référencées

- US-2076


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
- Index par catégorie : [`15-messagerie/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
