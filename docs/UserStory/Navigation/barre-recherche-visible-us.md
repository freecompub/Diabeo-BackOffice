# US-2623 — Barre de recherche visible (déclencheur de la palette)

> **Périmètre :** Diabeo BackOffice — navigation globale. **Complète US-2601** (palette
> de commande & recherche `Ctrl/Cmd-K`) en lui donnant une **affordance visible**.
> **Baselines :** `BASELINE-RBAC` · `BASELINE-DESIGN` · `BASELINE-I18N` (FR/EN/AR + RTL) · WCAG 2.1 AA.

## 🐞 Problème constaté

La recherche globale (US-2601) ne s'ouvre **qu'au clavier** (`Ctrl/Cmd-K`). Le header
(`NavigationShell`) n'affiche **aucun champ ni bouton** de recherche. Conséquences :

- **Découvrabilité** : un utilisateur qui ne connaît pas le raccourci ne trouve pas la recherche.
- **Accessibilité / tactile** : sur tablette **sans clavier**, la recherche est **inatteignable**
  (pas d'affordance pointeur).

## 👤 En tant que

Utilisateur backoffice (`ADMIN` / `DOCTOR` / `NURSE`).

## 🎯 Je veux / Afin de

Voir un **déclencheur de recherche visible** dans le header — afin d'ouvrir la recherche
patient/destination à la souris ou au tactile, sans connaître le raccourci clavier.

## 📌 Description fonctionnelle

- Un **bouton de recherche** dans le header du `NavigationShell` (variant `pro` uniquement) :
  - **Desktop** : présenté comme une **barre** « 🔍 Rechercher… » avec l'indice de raccourci
    (`⌘K` / `Ctrl K`).
  - **Mobile / tablette** : repli en **icône loupe** (cible ≥ 44 px).
- Le clic **ouvre la palette existante** (US-2601) — **aucune nouvelle logique de recherche**
  (mêmes résultats : destinations + patients du périmètre, scopé serveur).
- Le raccourci `Ctrl/Cmd-K` continue de fonctionner (les deux coexistent).
- `VIEWER` (espace patient, variant `patient`) : **pas** de palette → **pas** de bouton.

## ✔️ Critères d'acceptation

- Le bouton de recherche est **visible** dans le header pour les rôles staff (`pro`) ;
  absent pour le variant `patient`.
- Clic souris **et** activation tactile ouvrent la palette ; `Ctrl/Cmd-K` fonctionne toujours.
- A11y : `aria-label` explicite, indice de raccourci `aria-hidden` (décoratif), focus visible,
  cible ≥ 44 px (icône mobile), accessible au clavier (Tab + Entrée/Espace).
- Le libellé passe par i18n (FR/EN/AR) ; RTL correct (loupe + indice côté logique).
- Design system : classes sémantiques uniquement, aucun hex / Tailwind brut.

## 🧩 Règles métier

- **Réutilisation stricte** de la palette US-2601 (ouverture contrôlée) — pas de duplication
  de la recherche ni de nouvel appel API.
- Filtrage **serveur** du périmètre inchangé (la palette reste la seule source de résultats).
- Pas de donnée de santé exposée par le bouton (il n'affiche que le libellé « Rechercher »).

## 🗺️ Roadmap

**V1** — finition de la sous-série navigation médecin (complète US-2600/US-2601).

## 🔗 Dépendances

`US-2601` (palette de commande) · `US-2600` (navigation globale / `NavigationShell`) ·
baselines en tête.
