# QA — Fiche patient unifiée (`<PatientRecord>`)

Écrans : `/patients/[id]` (mode **page**) et **drawer de consultation** (ouvert
depuis `/patients`). Même composant `<PatientRecord>`, mêmes onglets.
Voir [conventions](README.md#3-conventions--légende).

> Epic **US-2630** (livrée, PR #608→#619). Architecture :
> `docs/architecture/fiche-patient-unifiee.md`.
> **Réel** 🟢 : la fiche consomme les vraies routes analytics (`/api/analytics/*`)
> et le DTO serveur (`build-patient-record`). Tester en 2 contextes : **page**
> (`?patientId`) et **drawer** (`cTok`, aucun id en URL) — rendu identique.

---

## 0. Prérequis jeux de données

Prévoir **3 patients** pour couvrir les branches :

| Patient | Profil | Attendu |
|---|---|---|
| P-CGM | capteur actif OU relevés CGM < 14 j | mode **CGM** (AGP, TIR, GMI, courbe continue) |
| P-BGM | pas de capteur, relevés capillaires (`GlycemiaEntry`) + repas | mode **BGM** (carnet, % en cible, HbA1c labo, nuage) |
| P-GD / grossesse | `pathology=GD` **ou** `pregnancyMode=true` (DT1/DT2) sans `CgmObjective` | cibles **63–140** partout (pas 70–180) |

---

## Écran : Vue d'ensemble 🟢

**Rôle / RBAC** : NURSE+ ; accès via `canAccessPatient` (page) ou `cTok` résolu
serveur (drawer). Consentement de partage **fail-closed** (retiré → « partage
désactivé »).

### Affichage attendu — CGM

| Élément | État attendu |
|---|---|
| Sélecteur période | segments **7j / 14j / 30j / 90j** (`role=radiogroup`), 14j par défaut |
| KPI (grille) | Moyenne (mg/dL) · **TIR** (% en cible) · **GMI** (%) · CV (%) |
| Caveat < 14 j | bandeau « fenêtre courte → indicatif » si période = 7j |
| Caveat capture | bandeau si capture CGM < 70 % |
| Donut TIR | anneau des zones (veryLow→veryHigh) |
| Carte profil | pathologie (badge), diagnostic, sexe, âge, référent, moyenne, objectifs |

### Affichage attendu — BGM (fail-closed)

| Élément | État attendu |
|---|---|
| Bandeau | « Mode glycémie capillaire (BGM)… » (pas de TIR-temps/GMI/AGP) |
| KPI | **Moyenne des relevés** · **% de relevés en cible** · **Fréquence** (/jour) · **HbA1c (laboratoire)** datée |
| Caveat % cible | « ≠ temps dans la cible… biais d'échantillonnage » |
| HbA1c ancienne | badge « valeur ancienne (> 180 j) » si stale |
| Donut TIR | **absent** ; carte profil pleine largeur ; **aucun GMI** nulle part |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Changer la période | CGM `GET /api/analytics/glycemic-profile` · BGM `GET /api/analytics/bgm-stats` | KPI re-fetchés (debounce 250 ms), libellé = période **réellement affichée** | 1 audit READ par requête, metadata `{patientId, period}` **sans valeur clinique** |
| Retirer le consentement patient | (garde route) | « partage désactivé », aucune donnée rendue | 403 fail-closed |

**🔴 À vérifier** : un patient **BGM** n'expose JAMAIS TIR-temps / GMI / donut /
AGP, même si d'anciens relevés CGM existent (gating sur `dataSource`).

---

## Écran : Profil glycémique — AGP (CGM) 🟢

| Élément | État attendu |
|---|---|
| Onglet | libellé **« Profil glycémique (AGP) »** en CGM |
| Graphe | bandes percentiles **P10/P25/P50/P75/P90** + bande cible pathology-aware |
| Suffisance | slot < seuil relevés → **pas de bande** (médiane seule / trou), jamais un faux 0 |
| Empty-state | < 14 j / capture faible → mention « indicatif » |
| Vue Journalier | bascule Moyenne ⇄ **Tableau journalier** (1 ligne/jour) |
| Lazy-load | **aucun** appel `/agp` tant que l'onglet n'est pas ouvert |

## Écran : Profil glycémique — Carnet (BGM) 🟢

| Élément | État attendu |
|---|---|
| Onglet | libellé **« Carnet glycémique »** (jamais « AGP ») |
| Grille | 4 moments **Nuit / Matin / Midi / Soir** — moyenne colorée pathology-aware + nb relevés |
| Plancher | < 3 relevés/moment → **« Données insuffisantes »** (pas de moyenne) |
| Caveat | « moyenne de relevés… non comparable à un temps dans la cible » |
| Endpoint | `GET /api/analytics/bgm-daily-pattern` (audit READ GLYCEMIA_ENTRY) |

---

## Écran : Tendances de repas 🟢

### CGM

| Élément | État attendu |
|---|---|
| Mini-courbes | 4 courbes alignées sur l'heure du repas (Nuit/Matin/Midi/Soir), bande cible |
| Insuffisant | < 3 repas appariés → « données insuffisantes » (pas de courbe) |
| Journal | table jour × Matin/Midi/Soir × **Avant / Après / Glucides / Bolus** (numérique) |
| Non prescriptif | flag excursion « à corréler à l'ICR/timing/repas » (jamais « augmenter X ») |

### BGM

| Élément | État attendu |
|---|---|
| Bandeau | « Carnet capillaire… pas de courbe continue » |
| Courbes | **absentes** (journal seul) |
| Journal | avant/après capillaires réels ou « — » (**zéro interpolation**) |

**🔴 À vérifier** : le **texte libre repas** n'apparaît nulle part (journal =
numérique). Appariement BGM correct **été ET hiver** (pas de décalage 1–2 h).

---

## Écran : Glycémie 🟢

| Contexte | Attendu |
|---|---|
| CGM | courbe 24 h + dernière glycémie + note relevés hors plage d'affichage |
| BGM | **nuage de points** modal-day (heure du jour × mg/dL), bande cible, résumé sr-only |

---

## Drawer ⇄ Page (US-2640)

| Action | Effet |
|---|---|
| Clic ligne patient (liste) | ouvre le **drawer** (overlay), URL reste `/patients` (aucun id) |
| Bouton **« ouvrir en page »** (en-tête drawer) | ferme le drawer + navigue `/patients/[id]` (route gardée `canAccessPatient`) |
| Bouton agrandir | drawer plein écran (in-place) |
| Boutons d'en-tête | cibles tactiles **44×44** ; `role=dialog` + `aria-modal` ; focus au titre à l'ouverture |

---

## Accessibilité (gate AC-3) ✅

- Segments période/vue : `role=radiogroup`/`radio`, clavier ←/→/Home/End.
- Onglets : `tablist` + `aria-label`, navigation clavier.
- Viz (AGP, mini-courbes, nuage BGM) : `role=figure` + **alternative sr-only**.
- `GlycemiaValue` : `showZoneLabel` (info pas seulement couleur) dans le carnet.
- Tables (journal repas, journalier) : `caption` sr-only + en-têtes multi-niveaux
  (`scope`/`headers`/`id`).
- `prefers-reduced-motion` respecté (AGP).

---

## Scénarios (Gherkin)

```gherkin
Feature: Fiche patient unifiée — CGM vs BGM

  Scenario: Patient CGM — vue d'ensemble
    Given un patient avec capteur actif
    When j'ouvre sa fiche (page ou drawer)
    Then je vois Moyenne, TIR, GMI, CV et le donut TIR
    And l'onglet Profil s'intitule "Profil glycémique (AGP)"

  Scenario: Patient BGM — fail-closed
    Given un patient sans capteur, avec relevés capillaires
    When j'ouvre sa fiche
    Then je ne vois NI TIR-temps NI GMI NI donut NI AGP
    And je vois "% de relevés en cible", HbA1c laboratoire, fréquence, carnet par moment
    And l'onglet Profil s'intitule "Carnet glycémique"

  Scenario: Grossesse — cibles strictes
    Given une patiente pregnancyMode=true typée DT1 sans CgmObjective
    When j'ouvre sa fiche
    Then la cible affichée est 63–140 mg/dL (et non 70–180)

  Scenario: Lazy-load d'un onglet
    Given une fiche patient ouverte sur "Vue d'ensemble"
    When je n'ai pas encore cliqué l'onglet "Tendances de repas"
    Then aucun appel à /api/analytics/meal-trends n'a été émis

  Scenario: Drawer sans id en URL
    Given la liste des patients
    When j'ouvre un patient en drawer
    Then l'URL reste /patients et aucune requête analytics ne porte l'id en URL

  Scenario: Toggle drawer vers page
    Given un patient ouvert en drawer (dossier chargé)
    When je clique "ouvrir en page plein écran"
    Then le drawer se ferme et je navigue vers /patients/[id]
```

---

## Points de non-régression (checklist rapide)

- [ ] BGM : aucun indicateur CGM-only visible (gating `dataSource`).
- [ ] Libellé de période = donnée réellement affichée (pas de faux libellé).
- [ ] Onglet inactif = aucun fetch (lazy-load).
- [ ] Drawer = aucun id patient en URL.
- [ ] Journal repas = numérique (pas de texte libre).
- [ ] Cibles GD/grossesse = 63–140 partout.
- [ ] Audit : 1 READ/agrégat, metadata sans valeur clinique.
