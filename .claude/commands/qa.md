---
description: Lance la campagne QA Diabeo. Sans argument = boucle complète (tous les domaines × FR/AR × Chrome/Safari/Firefox) avec archivage horodaté par navigateur et langue. Avec argument = restreint au domaine/langue indiqué.
argument-hint: "[domaine] [langue]  — vide = matrice complète"
---

Lance la campagne QA. Arguments : **$ARGUMENTS** (vide = matrice complète).

Applique le skill `qa-domain-runner`. Déroulé :

1. **Confirmer le périmètre** : si `$ARGUMENTS` est vide, prévenir que la matrice
   complète = 12 domaines × 2 langues (FR/AR) × 3 navigateurs (Chrome/Safari/Firefox,
   un par moteur Blink/WebKit/Gecko) et demander si on lance tout ou un
   sous-ensemble. Si un domaine/langue est donné, restreindre la boucle.
2. **Vérifier les pré-requis** : app sur `http://localhost:3000`, seed chargé,
   navigateur interactif connecté, dossier Téléchargements connecté + téléchargements
   multiples autorisés. Si un pré-requis manque, le signaler et s'arrêter.
3. **Créer le dossier de run** : `docs/qa/results/<YYYY-MM-DD_HHhMM>/`.
4. **Boucler** `navigateur → langue → domaine` :
   - `safari`/`firefox` → écrire un rapport « NON EXÉCUTÉ » (template `assets/rapport-non-execute-template.md`), ne pas piloter (non pilotables par l'extension Chrome).
   - `chrome` → régler la langue (`PUT /api/account/locale` + reload ; RTL pour `ar`),
     lire `docs/qa/NN-domaine.md`, exécuter les scénarios Gherkin (vérifs réseau),
     capturer tous les états via `scripts/capture.js`. **Demander l'accord** avant
     toute écriture réelle.
5. **Archiver** chaque combinaison sous
   `docs/qa/results/<run>/<navigateur>/<langue>/<domaine>/` (rapport + captures
   `<domaine>_<ecran>_<etat>.jpg`).
6. **Synthèse** : écrire `docs/qa/results/<run>/SYNTHESE.md` (matrice domaines ×
   combinaisons, statuts, liens vers les rapports).
7. **Restituer** la synthèse + quelques captures clés.

Rappels : verrouillage login en dernier ; refus RBAC = absence UI + 403 API ;
purger un zip homonyme dans ~/Downloads avant chaque téléchargement.
