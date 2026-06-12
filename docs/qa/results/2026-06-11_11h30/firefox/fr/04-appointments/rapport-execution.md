# Rapport d'exécution QA — 04-appointments.md — NON EXÉCUTÉ

**Date** : 2026-06-11 11h30 · **Navigateur** : firefox · **Langue** : fr · **Référence** : `04-appointments.md`

## Statut : ⏭️ NON EXÉCUTÉ

Cette combinaison n'a pas pu être exécutée avec l'outillage actuel.

**Motif** : seul Chrome (Blink) est pilotable par l'extension Claude in Chrome (moteur d'automatisation de ce skill).
- `safari` (WebKit) → non pilotable par l'extension Chrome.
- `firefox` (Gecko) → non pilotable par l'extension Chrome.

**Pour couvrir cette cellule** :
- Rejouer manuellement les scénarios de `04-appointments.md` dans le navigateur cible, **ou**
- ajouter un projet Playwright (`webkit` pour Safari, `firefox` pour Firefox) dans `playwright.bdd.config.ts` — Playwright pilote ces moteurs nativement.
