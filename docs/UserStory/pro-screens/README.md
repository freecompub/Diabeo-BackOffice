# Diabeo BackOffice — Cartographie des écrans

**185 écrans/composants** organisés en 26 catégories, avec 20 parcours utilisateurs critiques.

> 💡 Chaque écran a son propre fichier .md détaillé. Ce dossier est conçu pour être committé directement dans `docs/screens/` du repo.

## Statistiques globales

### Par priorité

| Priorité | Items | SP |
|----------|------:|---:|
| 🟢 **MVP** | 75 | 376 |
| 🔵 **V1** | 72 | 389 |
| 🟡 **V2** | 31 | 189 |
| 🟠 **V3** | 4 | 31 |
| 🔴 **V4** | 3 | 29 |
| **TOTAL** | **185** | **1014** |

### Par type

| Type | Nombre |
|------|------:|
| 📄 PAGE | 70 |
| 💬 MODAL | 47 |
| 📋 DRAWER | 5 |
| 📑 TAB | 11 |
| 🧙 WIZARD_STEP | 10 |
| 🗂️ PANEL | 7 |
| 🧩 COMPONENT | 34 |
| 🏗️ LAYOUT | 1 |


## Charge sprint estimée

Avec une vélocité équipe de **40 SP/sprint** (2 devs senior) :
- MVP : **~10 sprints** (376 SP)
- MVP+V1 : **~20 sprints**
- Tout : **~26 sprints**

Avec **60 SP/sprint** (3-4 devs) :
- MVP : ~7 sprints
- Tout : ~17 sprints

## Organisation des fichiers

```
screens/
├── README.md (ce fichier)
├── by-category/         ← navigation principale (par fonctionnalité)
│   ├── README.md
│   ├── 01-auth/
│   │   ├── README.md
│   │   ├── SCR-100-page-de-connexion.md
│   │   └── ...
│   ├── 02-layout/
│   │   └── ...
│   └── ... (26 catégories)
├── by-priority/         ← navigation par priorité (planning sprints)
│   ├── README.md
│   ├── MVP.md
│   ├── V1.md
│   ├── V2.md
│   ├── V3.md
│   └── V4.md
├── by-type/             ← navigation par type (audit design system)
│   ├── README.md
│   ├── PAGE.md
│   ├── MODAL.md
│   ├── COMPONENT.md
│   └── ...
└── journeys/            ← parcours utilisateurs critiques
    ├── README.md
    ├── J-01-premiere-consultation-patient.md
    ├── J-02-analyse-glycemie-ajustement-insuline.md
    └── ... (20 parcours)
```

## Format de chaque fiche écran

Chaque fichier `.md` d'écran contient :
- Métadonnées (ID, type, priorité, route, SP)
- Personas concernés
- Navigation (parents/enfants — avec liens cross-référencés)
- États possibles
- Notes UX clés
- Implémentation technique (composants React, route, US référencées)
- Définition de Done (design + dev + validation)

## Format de chaque parcours utilisateur

Chaque fichier `.md` de parcours contient :
- Métadonnées (persona, priorité, SP cumulés)
- Séquence d'écrans avec liens
- Diagramme Mermaid du flow
- Notes pour validation PO et tests E2E

## Lecture conseillée

### Pour un designer
1. Commencer par [`by-category/README.md`](by-category/README.md) pour avoir la vue produit
2. Parcourir les catégories prioritaires : Auth (01), Dashboard (03), Liste patients (04), Fiche patient (05)
3. Lire les parcours [`journeys/`](journeys/) pour comprendre les séquences UX
4. Identifier les composants réutilisables : [`by-type/COMPONENT.md`](by-type/COMPONENT.md)

### Pour un dev / PO
1. Commencer par [`by-priority/MVP.md`](by-priority/MVP.md) pour le périmètre minimal
2. Pour chaque écran MVP, lire son fichier individuel
3. Croiser avec les US backoffice (`Diabeo_UserStories_US2000.zip`)
4. Estimer la charge sprint avec les SP cumulés

### Pour un chef de projet
1. [`by-priority/README.md`](by-priority/README.md) pour la roadmap globale
2. [`journeys/README.md`](journeys/README.md) pour les parcours critiques
3. Statistiques de charge dans le tableau ci-dessus

## Limites assumées

- **Routes Next.js** : indicatives, à confirmer avec l'architecture App Router finale
- **Composants React** : suggestions de découpage, un dev senior peut découper différemment
- **Story points** : heuristiques (complexité visuelle + nombre d'états + intégrations) — recalibrer en planning poker
- **Parcours utilisateurs** : 20 critiques identifiés, en réalité ~30-40 — à compléter avec PO

## Liens externes

- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip` (213 US)
- US miroir patient management : `Diabeo_BackOffice_PatientManagement_US2214.zip` (51 US)
- Vue Excel design : `Diabeo_BackOffice_Ecrans_Design.xlsx`
- Vue Excel dev/sprint : `Diabeo_BackOffice_Ecrans_Dev.xlsx`
