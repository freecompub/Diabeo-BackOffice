# Rapport d'exécution QA — {{NN-domaine}}.md — NON EXÉCUTÉ

**Date** : {{YYYY-MM-DD HHhMM}} · **Navigateur** : {{safari|firefox}} · **Langue** : {{fr|ar}} · **Référence** : `{{NN-domaine}}.md`

## Statut : ⏭️ NON EXÉCUTÉ

Cette combinaison n'a pas pu être exécutée avec l'outillage actuel.

**Motif** : seul Chrome (Blink) est pilotable par l'extension Claude in Chrome (moteur d'automatisation de ce skill).
- `safari` (WebKit) → non pilotable par l'extension Chrome.
- `firefox` (Gecko) → non pilotable par l'extension Chrome.

**Pour couvrir cette cellule** :
- Rejouer manuellement les scénarios de `{{NN-domaine}}.md` dans le navigateur cible, **ou**
- ajouter un projet Playwright (`webkit` pour Safari, `firefox` pour Firefox) dans `playwright.bdd.config.ts` — Playwright pilote ces moteurs nativement.
