# US-2632 — Composant présentational `<PatientRecord>` + contrat de données

> 📌 Fiche patient · epic US-2630 · front · Taille **M** · dépend de : —

## Contexte
Socle de la fusion : extraire le rendu des onglets de `PatientDetailClient` vers un **composant « dumb »** piloté par un **DTO normalisé**, agnostique de la source de données (page RSC ou drawer `cTok`). Aucun changement fonctionnel/visuel à cette étape.

## Périmètre
- `<PatientRecord>` présentational : en-tête + onglets (Vue d'ensemble · Glycémie · AGP · Tendances de repas · Traitements · Documents), rendu à partir d'un DTO unique.
- Contrat de props normalisé, futur-proof pour : période, vue, `dataSource` CGM/BGM, mode page/drawer.
- Page `/patients/[id]` câblée sur `<PatientRecord>` (parité visuelle stricte).

## Critères d'acceptation
- **AC-1** Aucune régression visuelle/fonctionnelle de la page existante.
- **AC-2** Le composant **ne construit aucune URL contenant un id patient numérique** (préparation drawer) — les liens (ex. téléchargement document) passent par le contrat, pas par `?patientId=` en dur.
- **AC-3** Zéro calcul clinique côté composant (rend des valeurs déjà projetées).
- **AC-4** Design system : tokens uniquement (migration des hex/Tailwind brut de la maquette).

## Risques
Bien isoler le contrat (il porte toute l'évolutivité : drawer, BGM, période, vue). Couvre archi US-A.
