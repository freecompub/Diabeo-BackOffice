# US-2624 — Pont Dossier ↔ Consultation (lanceur de revue)

> **Périmètre :** Diabeo BackOffice — navigation médecin. **Relie US-2604** (dossier
> patient, onglets) et **US-2605** (mode revue de consultation). Rétablit la
> **distinction Dossier / Consultation** du mockup `docs/mockups/navigation.html`.
> **Baselines :** `BASELINE-RBAC` · `BASELINE-DESIGN` · `BASELINE-I18N` (FR/EN/AR + RTL) · WCAG 2.1 AA.

## 🐞 Problème constaté

Le mockup distingue deux écrans reliés par la barre de contexte patient :
- **Dossier patient** (Vue 2) — onglets, lecture des données ;
- **Consultation / Mode revue** (Vue 3) — séance structurée en 6 étapes
  (`Encounter`, décisions, compte rendu en addendum immuable),
  **lancée depuis le Dossier** via le bouton « ▶ Nouvelle consultation ».

Dans l'implémentation, les **deux routes existent** (`/patients/[id]` et
`/patients/[id]/review`), mais **aucun lien d'interface ne mène à la consultation** :
`PatientContextBar` n'expose que *Switcher* + *Message*. La route `/review` est donc
**orpheline** (atteignable seulement en tapant l'URL) → côté UX, la distinction
Dossier ↔ Consultation est **invisible**.

## 👤 En tant que

Soignant ayant accès au patient (`DOCTOR` / `NURSE` / `ADMIN`).

## 🎯 Je veux / Afin de

Lancer une **consultation** depuis le **dossier** (et revenir au dossier depuis la
consultation) — afin de retrouver la distinction « consulter le dossier » vs
« mener une séance de revue » prévue par la maquette.

## 📌 Description fonctionnelle

- **Dossier → Consultation** : `PatientContextBar` (dossier) affiche un bouton
  **« ▶ Nouvelle consultation »** → `/patients/[id]/review`. Visible pour **tout
  soignant ayant accès au patient** (cohérent avec la garde de route `canAccessPatient` ;
  la **décision** thérapeutique reste DOCTOR-only à l'étape 5).
- **Consultation → Dossier** : dans la revue, le retour de la barre pointe sur le
  **dossier** (« ‹ Retour au dossier ») et non plus sur « Ma journée ».
- Le bouton **n'apparaît pas dans la consultation elle-même** (pas d'auto-lien) :
  `PatientContextBar` rend le lanceur uniquement quand on le lui demande (dossier).
- Ouverture/reprise de l'`Encounter` du jour : inchangée (`encounterService.openOrResume`,
  déclenchée par le chargement de `/review`).

## ✔️ Critères d'acceptation

- Depuis le **dossier**, un bouton « Nouvelle consultation » mène à `/patients/[id]/review`.
- Le bouton est **absent de la consultation** (la barre y affiche « Retour au dossier »).
- `VIEWER` n'a ni dossier pro ni consultation (route hors de son périmètre) → pas de bouton.
- A11y : bouton avec libellé explicite, focus visible, cible ≥ 44 px ; i18n FR/EN/AR + RTL.
- Design system : classes sémantiques uniquement.

## 🧩 Règles métier

- **Aucune nouvelle garde d'accès** : le lanceur ne fait que naviguer ; l'autorisation
  réelle reste `canAccessPatient` (route `/review`) + DOCTOR-only sur la décision.
- Réutilisation stricte de `PatientContextBar` (partagée dossier/revue) via props de
  configuration — pas de duplication de barre.

## 🗺️ Roadmap

**V1** — finition navigation médecin (relie US-2604 / US-2605, fidélité mockup).

## 🔗 Dépendances

`US-2604` (dossier/onglets) · `US-2605` (mode revue) · `US-2603` (`PatientContextBar`) ·
baselines en tête.
