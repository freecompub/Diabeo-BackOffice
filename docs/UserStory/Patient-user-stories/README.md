# Diabeo App Patient — User Stories US-3001 → US-3354

**354 User Stories** générées depuis l'inventaire fonctionnel
([Diabeo_App_Patient_Inventaire.xlsx](../Diabeo_App_Patient_Inventaire.xlsx)).

Format **B** : 3 sections plateformes complètes par US (iOS, Android, Web).
Modes contextuels (pédiatrie, grossesse, Ramadan, voyage, sport) intégrés
en option B (variantes inline dans chaque US concernée).

## Organisation

```
user-stories/
├── 0-MVP/    (108 US)
├── 1-V1/     (153 US)
├── 2-V2/     (69 US)
├── 3-V3/     (18 US)
└── 4-V4/     (6 US)
```

Sous chaque priorité : un sous-dossier par domaine fonctionnel (30 domaines).

## Statistiques

### Par priorité

| Priorité | Nombre | Index |
|----------|-------:|-------|
| MVP | 108 | [voir](0-MVP/README.md) |
| V1 | 153 | [voir](1-V1/README.md) |
| V2 | 69 | [voir](2-V2/README.md) |
| V3 | 18 | [voir](3-V3/README.md) |
| V4 | 6 | [voir](4-V4/README.md) |
| **TOTAL** | **354** | |

### Par plateforme

| Plateforme | Nombre |
|---|---:|
| 📱🖥️ | 183 |
| 📱 | 163 |
| 📱➡️🖥️ | 5 |
| 🖥️ | 3 |

### Intégrations externes

| Statut | Nombre |
|---|---:|
| Non | 261 |
| Oui | 80 |
| Partiel | 13 |

### Par domaine

| # | Domaine | Nombre |
|--:|---------|------:|
| 1 | Onboarding | 14 |
| 2 | Auth & sécurité app | 12 |
| 3 | Profil patient | 19 |
| 4 | Glycémie & CGM | 27 |
| 5 | Insuline & bolus | 17 |
| 6 | Repas & glucides | 18 |
| 7 | Activité physique | 10 |
| 8 | Événements & journal | 11 |
| 9 | Propositions médecin | 11 |
| 10 | Téléconsultation | 11 |
| 11 | Messagerie & notifs | 14 |
| 12 | Dispositifs & connectivité | 12 |
| 13 | Documents & ordonnances | 12 |
| 14 | Pharmacie & approvisionnement | 7 |
| 15 | Suivi & objectifs | 8 |
| 16 | ETP | 8 |
| 17 | Mode grossesse | 7 |
| 18 | Mode pédiatrique | 7 |
| 19 | Famille & aidants | 6 |
| 20 | Urgences & sécurité | 3 |
| 21 | Voyages | 7 |
| 22 | Communauté & support | 6 |
| 23 | Préférences & perso | 10 |
| 24 | Conformité & RGPD patient | 7 |
| 25 | Multi-pays | 6 |
| 26 | Wearables étendus | 7 |
| 27 | Recherche clinique | 5 |
| 28 | Procédures d'urgence | 55 |
| 29 | Hors-ligne & sync | 9 |
| 30 | Accessibilité avancée | 8 |


## Convention

- **ID** : `US-3001` à `US-3354` (US-3xxx réservé app patient)
- **US-2xxx** : backoffice professionnel (cf inventaire séparé)
- **Numérotation alignée** sur l'inventaire (`FNP-001` → `US-3001`)

## Format de chaque US

Chaque fichier .md contient :
1. Métadonnées (priorité, plateforme, faisabilité FR/DZ, story points par plateforme)
2. Contexte métier (persona patient, valeur produit, faisabilité)
3. **📱 Spécificités iOS** (stack, frameworks, APIs, permissions Info.plist, tests, App Store)
4. **🤖 Spécificités Android** (stack, dépendances, APIs, permissions Manifest, tests, Play Store)
5. **🌐 Spécificités Web** (stack, navigateurs, APIs web, capacités non disponibles, tests)
6. **🔄 Modes contextuels** (pédiatrie / grossesse / Ramadan / voyage / sport — variantes inline)
7. Critères d'acceptation (Gherkin)
8. Règles métier
9. Modèle de données (réutilise schema backend + cache local chiffré)
10. API & contrats
11. Scénarios d'erreur (table HTTP + UX-friendly)
12. Sécurité & conformité HDS (auth, stockage local, transit, audit, RGPD)
13. Plan de test 3 niveaux × 3 plateformes (+ sécurité + conformité + a11y)
14. Définition de Done (par plateforme)
15. Ressources

## Limites assumées

- Modèles Prisma référencent le schéma backoffice (cohérence garantie, pas de duplication)
- Endpoints API esquissés — à confirmer lors du contract design détaillé
- Story points heuristiques — recalibrer en planning poker équipe
- Modes contextuels intégrés sur les domaines évidents — affiner US par US

## US miroir backoffice (à venir)

Les fonctionnalités côté pro permettant de **configurer / superviser** ces fonctionnalités patient seront livrées dans un second lot (US-2214 → ~2264) couvrant 8 catégories : configuration seuils, supervision urgences, modes contextuels, gestion aidants, dispositifs, repas/adhésion, programmes ETP, messagerie templates.
