# SCR-P-205 — 🍎 iOS — Vérification SMS (OTP)

> 🔵 Priorité **V1** · 📄 Type **PAGE** · Catégorie **01-Onboarding** · 📱🖥️ Toutes plateformes

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-P-205` |
| **Catégorie** | 01-Onboarding |
| **Nom** | Vérification SMS (OTP) |
| **Type** | PAGE |
| **Priorité** | **V1** |
| **Plateformes cibles** | 📱🖥️ Toutes plateformes |
| **Différences plateforme matérielles** | ✅ OUI — Auto-fill SMS OS-spécifique (iOS / Android) |
| **Story points (par plateforme)** | 3 |
| **Route** | `/onboarding/verify-phone` |

---

## 🎭 Personas concernés

Tous (selon politique)

---

## 🧭 Navigation

### Vient de (parents)
Inscription

### Mène vers (enfants)
Wizard profil

---

## 🎨 États possibles

- `pending`
- `verifying`
- `success`
- `error`
- `rate-limited`


> 💡 Chaque état doit avoir une UX définie (feedback visuel, message, comportement).

---

## 📐 Notes UX clés

Saisie 6 chiffres avec auto-fill, compte à rebours, bouton 'Renvoyer'

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

- FNP-004


---

## 🛠️ Implémentation iOS

> Cet écran a un **fichier dédié iOS** parce que les différences matérielles avec les autres plateformes le justifient :
> **Auto-fill SMS OS-spécifique (iOS / Android)**

## 🍎 Spécificités iOS

### Stack technique
- **SDK minimum** : iOS 16.0
- **Langage** : Swift 5.9+
- **Frameworks** : `SwiftUI`, `Combine`
- **Architecture** : MVVM + Coordinator

### APIs et capacités spécifiques
- APIs SwiftUI standard

### Permissions à déclarer (Info.plist)
- Aucune permission spécifique

### Comportement utilisateur iOS
- Navigation `NavigationStack` (iOS 16+)
- Haptic feedback `UIImpactFeedbackGenerator`
- Animations system-default (60 fps min, 120 fps si ProMotion)
- Support Dark Mode automatique

### Tests automatisés iOS
- Unitaires `XCTest` ≥ 80%
- UI `XCUITest` scénario nominal
- Accessibility Inspector + VoiceOver

### Distribution App Store
- Catégorie **Medical** (si applicable)
- Privacy Manifest (`PrivacyInfo.xcprivacy`) à jour
- TestFlight pour recette interne

### Composants
```
OtpInput, Countdown, ResendButton
```


### 🔗 Voir aussi (autres plateformes)

- [`SCR-P-205-android`](./SCR-P-205-verification-sms-otp-android.md) — version Android
- [`SCR-P-205-web`](./SCR-P-205-verification-sms-otp-web.md) — version Web
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

### iOS-spécifique
- [ ] Tests sur 3 devices (iPhone SE, iPhone 15, iPad)
- [ ] Validation TestFlight ≥ 5 testeurs
- [ ] Privacy Manifest à jour
- [ ] Aucun warning Xcode

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
