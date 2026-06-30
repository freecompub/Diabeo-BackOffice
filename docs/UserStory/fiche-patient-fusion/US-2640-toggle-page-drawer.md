# US-2640 — Toggle page ⇄ drawer + navigation + décommission anciens onglets drawer

> 📌 Fiche patient · epic US-2630 · front · Taille **M** · dépend de : US-2633, US-2635, US-2637, US-2638

## Contexte
Câbler la présentation unique aux deux points d'entrée et retirer l'ancien code des onglets bespoke du drawer.

## Périmètre
- Entrées : route page `/patients/[id]` + ouverture drawer (depuis liste/dashboard).
- Bouton « plein écran » / « page » dans le drawer ; cohérence focus/URL selon le mode.
- Décommission des anciens tabs drawer (`consultation/tabs/*`) une fois `<PatientRecord>` en place.

## Critères d'acceptation
- **AC-1** Le toggle ne casse aucun flux d'accès ; en drawer, toujours pas d'id en URL.
- **AC-2** Aucune régression d'audit d'ouverture (page = `getById`, drawer = `consultation.open`, `surface` distinct).
- **AC-3** Suppression de code mort sans perte de fonctionnalité (parité).

## Notes
Couvre archi US-K.
