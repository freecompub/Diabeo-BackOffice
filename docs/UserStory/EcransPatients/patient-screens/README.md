# Diabeo App Patient — Cartographie des écrans

**242 écrans logiques** couvrant 3 plateformes (iOS, Android, Web), organisés en 36 catégories, avec 20 parcours utilisateurs critiques.

**292 fichiers .md** générés selon la **logique hybride** :
- Écrans avec différences plateforme matérielles (33) → fichiers dédiés par plateforme
- Écrans sans différences (209) → fichier unifié avec 3 sections inline

> 💡 Conçu pour être committé directement dans `docs/screens-patient/` du repo.

## Statistiques globales

### Par priorité (avec SP cumulés ×plateformes)

| Priorité | Items | SP×plat |
|----------|------:|--------:|
| 🟢 **MVP** | 96 | 1267 |
| 🔵 **V1** | 100 | 1254 |
| 🟡 **V2** | 34 | 423 |
| 🟠 **V3** | 9 | 164 |
| 🔴 **V4** | 3 | 69 |
| **TOTAL** | **242** | **3177** |

### Par plateforme cible

| Plateforme | Items |
|------------|------:|
| 📱🖥️ Toutes plateformes | 220 |
| 📱 Mobile (iOS + Android) | 17 |
| 🍎 iOS uniquement | 3 |
| 🤖 Android uniquement | 2 |

### Par type

| Type | Nombre |
|------|------:|
| 📄 PAGE | 158 |
| 💬 MODAL | 46 |
| 📋 DRAWER | 1 |
| 🧙 WIZARD_STEP | 8 |
| 🧩 COMPONENT | 28 |
| 🏗️ LAYOUT | 1 |


## Charge sprint estimée

Avec une vélocité de **40 SP/sprint** par plateforme (3 équipes en parallèle iOS/Android/Web) :
- MVP : ~11 sprints (3 équipes × 40 SP)
- Tout : ~27 sprints (3 équipes × 40 SP)

Avec une **équipe unique** vélocité 40 SP/sprint qui travaille les 3 plateformes :
- MVP : ~32 sprints
- Tout : ~80 sprints

## Organisation des fichiers

```
patient-screens/
├── README.md (ce fichier)
├── by-category/         ← navigation par fonctionnalité
│   ├── README.md
│   ├── 01-onboarding/
│   ├── 02-auth/
│   ├── 03-profil/
│   └── ... (32 catégories)
├── by-priority/         ← planning sprints
│   ├── README.md
│   ├── MVP.md
│   ├── V1.md
│   └── ...
├── by-platform/         ← audit plateformes (NOUVEAU)
│   ├── README.md
│   ├── all.md
│   ├── mobile.md
│   ├── ios-only.md
│   └── android-only.md
├── by-type/             ← audit design system
│   ├── README.md
│   └── ...
└── journeys/            ← 20 parcours utilisateurs
    ├── README.md
    └── J-P-01-...md
```

## Format des fichiers

### Écran sans différence plateforme (1 fichier)
- Métadonnées
- Personas
- Navigation (parents/enfants avec liens)
- États possibles
- Modes contextuels applicables
- US référencées
- **3 sections plateformes inline** : iOS / Android / Web
- Définition de Done commune

### Écran avec différence plateforme (2 ou 3 fichiers)
Un fichier `{scr_id}-{slug}-ios.md`, `-android.md`, `-web.md`
- Toutes les sections communes (haut du fichier)
- Une section plateforme **complète** au lieu de 3
- Justification de la différence en haut
- **Liens cross-référencés** vers les autres versions plateforme
- Définition de Done plateforme-spécifique

## Convention de numérotation

- **ID** : `SCR-P-200` à `SCR-P-441` (P = Patient)
- **SCR-100+** : backoffice pro (cartographie séparée)
- Suffixes plateforme : `-ios`, `-android`, `-web`

## Limites assumées

- **Différences plateforme matérielles** identifiées sur signaux explicites (BLE, caméra, biométrie, watch, push critiques) — affiner si nouveaux signaux émergent
- **Routes** indicatives, à confirmer architecture finale
- **Composants** suggestions de découpage
- **Story points** heuristiques, recalibrer en planning poker
- **Modes contextuels** mentionnés génériquement, voir US pour le détail

## Liens externes

- Inventaire fonctionnel : `Diabeo_App_Patient_Inventaire.xlsx`
- US patient : `Diabeo_AppPatient_UserStories_US3000.zip` (354 US)
- Cartographie backoffice : `Diabeo_BackOffice_Ecrans_MD.zip`
- Vue Excel design : `Diabeo_AppPatient_Ecrans_Design.xlsx`
- Vue Excel dev : `Diabeo_AppPatient_Ecrans_Dev.xlsx`
