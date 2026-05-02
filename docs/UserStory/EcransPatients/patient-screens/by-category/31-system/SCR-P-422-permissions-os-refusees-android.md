# SCR-P-422 — 🤖 Android — Permissions OS refusées

> 🟢 Priorité **MVP** · 📄 Type **PAGE** · Catégorie **31-System** · 📱 Mobile (iOS + Android)

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-P-422` |
| **Catégorie** | 31-System |
| **Nom** | Permissions OS refusées |
| **Type** | PAGE |
| **Priorité** | **MVP** |
| **Plateformes cibles** | 📱 Mobile (iOS + Android) |
| **Différences plateforme matérielles** | ✅ OUI — Deeplink vers settings OS différent (iOS Settings.bundle / Android Settings.ACTION_APPLICATION_DETAILS_SETTINGS) |
| **Story points (par plateforme)** | 3 |
| **Route** | `/permissions-required` |

---

## 🎭 Personas concernés

Tous

---

## 🧭 Navigation

### Vient de (parents)
Demande permission refusée

### Mène vers (enfants)
Settings OS

---

## 🎨 États possibles

- `default`
- `with-deeplink-settings`


> 💡 Chaque état doit avoir une UX définie (feedback visuel, message, comportement).

---

## 📐 Notes UX clés

Explication pédagogique, bouton 'Ouvrir réglages'

---

## 🔄 Modes contextuels applicables

Selon le profil patient, cette fonctionnalité doit adapter son comportement :

- 👶 **Mode pédiatrique** : multi-aidants, double notification parent, mode école si applicable
- 🤰 **Mode grossesse** : cibles strictes obstétriques, suivi SA si pertinent
- 🌙 **Mode Ramadan** : adaptation jeûne, conseils Sahur/Iftar
- ✈️ **Mode voyage** : adaptation fuseau horaire, contacts urgence locaux
- 🏃 **Mode sport** : vigilance hypo post-effort

> Voir l'US correspondante pour le détail des comportements par mode.

---

## 🔌 User Stories référencées

- _Aucune US directement référencée_


---

## 🛠️ Implémentation Android

> Cet écran a un **fichier dédié Android** parce que les différences matérielles avec les autres plateformes le justifient :
> **Deeplink vers settings OS différent (iOS Settings.bundle / Android Settings.ACTION_APPLICATION_DETAILS_SETTINGS)**

## 🤖 Spécificités Android

### Stack technique
- **API minimum** : 26 (Android 8.0)
- **API target** : 34 (Android 14)
- **Langage** : Kotlin 1.9+
- **Dépendances** : `Jetpack Compose`, `Coroutines + Flow`
- **Architecture** : MVVM + Hilt

### APIs et capacités spécifiques
- APIs Compose / AndroidX standard

### Permissions (AndroidManifest.xml)
- Aucune permission spécifique

### Comportement utilisateur Android
- Navigation `NavHost` Compose
- Haptic `HapticFeedbackConstants.CONTEXT_CLICK`
- Material Motion (250ms / 350ms)
- Dynamic Color (Material You) + fallback Diabeo
- Dark Theme auto

### Tests automatisés Android
- Unitaires `JUnit 5` + `MockK` ≥ 80%
- UI `Compose UI Test`
- Firebase Test Lab multi-devices
- Accessibility Scanner

### Distribution Play Store
- Catégorie **Medical**
- Data Safety form à jour
- Health Apps Policy compliance
- Internal Testing track

### Composants
```
PermissionsRequiredPage
```


### 🔗 Voir aussi (autres plateformes)

- [`SCR-P-422-ios`](./SCR-P-422-permissions-os-refusees-ios.md) — version iOS
---

## ✅ Définition de Done

### Design (commun)
- [ ] Wireframe basse fidélité validé
- [ ] Maquette haute fidélité (Figma) validée par PO
- [ ] Tous les états listés sont designés
- [ ] Variantes responsive si applicable
- [ ] Conformité design system Diabeo (Sérénité Active)
- [ ] Accessibility review : contraste, taille texte, focus order
- [ ] Mode sombre testé si applicable

### Développement (commun)
- [ ] Composants implémentés (cf liste)
- [ ] Route fonctionnelle
- [ ] Tous les états gérés (loading, empty, error, success...)
- [ ] Tests E2E sur scénario nominal
- [ ] Tests d'accessibilité OK
- [ ] Internationalisation FR + AR (RTL) si UI

### Android-spécifique
- [ ] Tests Firebase Test Lab ≥ 5 références
- [ ] Validation Internal Testing track
- [ ] Data Safety form à jour
- [ ] Aucun warning Lint

### Sécurité & conformité (commun)
- [ ] AuditLog patient si action sensible
- [ ] Données chiffrées (cache local + transit)
- [ ] OWASP MASVS L2 (mobile) / ASVS L2 (web) vérifié
- [ ] Pas de secret en dur

### Validation
- [ ] Code review approuvée
- [ ] Validation produit / PO

---

## 🔗 Ressources

- Cartographie complète : [`README.md`](../README.md)
- Inventaire fonctionnel : `Diabeo_App_Patient_Inventaire.xlsx`
- US patient : `Diabeo_AppPatient_UserStories_US3000.zip`
