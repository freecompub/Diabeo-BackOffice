# SCR-P-224 — Mode verrou d'urgence

> 🟡 Priorité **V2** · 💬 Type **MODAL** · Catégorie **02-Auth** · 📱 Mobile (iOS + Android)

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-P-224` |
| **Catégorie** | 02-Auth |
| **Nom** | Mode verrou d'urgence |
| **Type** | MODAL |
| **Priorité** | **V2** |
| **Plateformes cibles** | 📱 Mobile (iOS + Android) |
| **Différences plateforme matérielles** | ❌ Non (UX cohérente) |
| **Story points (par plateforme)** | 5 |
| **Route** | `(overlay)` |

---

## 🎭 Personas concernés

Patients à risque (ex: violences)

---

## 🧭 Navigation

### Vient de (parents)
Geste secret / paramètres

### Mène vers (enfants)
Écran neutre

---

## 🎨 États possibles

- `default`
- `activated`
- `deactivated`


> 💡 Chaque état doit avoir une UX définie (feedback visuel, message, comportement).

---

## 📐 Notes UX clés

Cache l'app sous une apparence neutre (calculatrice fake). Activation discrète.

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

- FNP-022


---

## 🛠️ Implémentation par plateforme

> Cet écran a été classé **sans différences plateforme matérielles** : un seul fichier .md couvre les 3 implémentations.

## 🍎 Spécificités iOS

### Stack technique
- **SDK minimum** : iOS 16.0
- **Langage** : Swift 5.9+
- **Frameworks** : `SwiftUI`, `Combine`, `UserNotifications`, `CoreLocation`
- **Architecture** : MVVM + Coordinator

### APIs et capacités spécifiques
- **Critical Alerts** : entitlement `com.apple.developer.usernotifications.critical-alerts`
- Téléphonie via `tel:` URL scheme ou CallKit

### Permissions à déclarer (Info.plist)
- `NSLocationWhenInUseUsageDescription`

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
PanicMode
```

---

## 🤖 Spécificités Android

### Stack technique
- **API minimum** : 26 (Android 8.0)
- **API target** : 34 (Android 14)
- **Langage** : Kotlin 1.9+
- **Dépendances** : `Jetpack Compose`, `Coroutines + Flow`, `Firebase Cloud Messaging (FCM)`, `FusedLocationProviderClient`
- **Architecture** : MVVM + Hilt

### APIs et capacités spécifiques
- Notifications haute priorité : `IMPORTANCE_HIGH` + `CATEGORY_ALARM` + `FullScreenIntent`
- Numérotation `Intent.ACTION_CALL`

### Permissions (AndroidManifest.xml)
- `POST_NOTIFICATIONS` (API 33+)
- `ACCESS_FINE_LOCATION`
- `CALL_PHONE`

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
PanicMode
```

---

## 🌐 Spécificités Web

_Cet écran n'est pas implémenté en web (mobile only)._
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
