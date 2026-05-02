# SCR-P-353 — 🤖 Android — Bouton SOS (FAB rouge)

> 🔵 Priorité **V1** · 💬 Type **MODAL** · Catégorie **20-Urgences** · 📱🖥️ Toutes plateformes

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-P-353` |
| **Catégorie** | 20-Urgences |
| **Nom** | Bouton SOS (FAB rouge) |
| **Type** | MODAL |
| **Priorité** | **V1** |
| **Plateformes cibles** | 📱🖥️ Toutes plateformes |
| **Différences plateforme matérielles** | ✅ OUI — Téléphonie + GPS + SMS — APIs OS-spécifiques (CallKit, Intent.ACTION_CALL, tel: link) |
| **Story points (par plateforme)** | 8 |
| **Route** | `(modal)` |

---

## 🎭 Personas concernés

Tous

---

## 🧭 Navigation

### Vient de (parents)
Dashboard / FAB toujours accessible

### Mène vers (enfants)
Procédure SOS

---

## 🎨 États possibles

- `ready`
- `triggered`
- `calling`
- `location-shared`


> 💡 Chaque état doit avoir une UX définie (feedback visuel, message, comportement).

---

## 📐 Notes UX clés

Activation 1 tap → géoloc + alerte contacts + numéro SAMU pré-composé

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

- FNP-243


---

## 🛠️ Implémentation Android

> Cet écran a un **fichier dédié Android** parce que les différences matérielles avec les autres plateformes le justifient :
> **Téléphonie + GPS + SMS — APIs OS-spécifiques (CallKit, Intent.ACTION_CALL, tel: link)**

## 🤖 Spécificités Android

### Stack technique
- **API minimum** : 26 (Android 8.0)
- **API target** : 34 (Android 14)
- **Langage** : Kotlin 1.9+
- **Dépendances** : `Jetpack Compose`, `Coroutines + Flow`, `Firebase Cloud Messaging (FCM)`, `FusedLocationProviderClient`
- **Architecture** : MVVM + Hilt

### APIs et capacités spécifiques
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
SosFab, SosTrigger
```


### 🔗 Voir aussi (autres plateformes)

- [`SCR-P-353-ios`](./SCR-P-353-bouton-sos-fab-rouge-ios.md) — version iOS
- [`SCR-P-353-web`](./SCR-P-353-bouton-sos-fab-rouge-web.md) — version Web
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
