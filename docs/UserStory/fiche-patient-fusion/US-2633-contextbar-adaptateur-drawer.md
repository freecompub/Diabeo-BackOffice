# US-2633 — `PatientContextBar` page/drawer + adaptateur drawer

> 📌 Fiche patient · epic US-2630 · front/**sécurité** · Taille **L** · dépend de : US-2632

## Contexte
Monter `<PatientRecord>` dans le drawer de consultation à la place des onglets bespoke, en **préservant intégralement les propriétés de sécurité du drawer** (US-2018b). C'est l'étape qui met fin à la divergence des deux vues.

## Périmètre
- `PatientContextBar` : variante **éphémère/drawer** (bandeau « aucune donnée conservée » + actions agrandir/fermer), en plus de la variante page (flags, référent, « Nouvelle consultation »).
- **Adaptateur de transport drawer** : alimente `<PatientRecord>` via routes porteuses de `cTok` (`x-consultation-token`).

## Critères d'acceptation (sécurité — bloquants)
- **AC-1** Le drawer reste : `publicRef → cTok` (aucun id numérique en URL/historique/partage), jeton détruit au close (`sendBeacon`/`pagehide`), plafond absolu 60 min, single-active.
- **AC-2** `inert` / `aria-modal` / focus-trap / Échap préservés.
- **AC-3** `canAccessPatient` + `patientShareConsent` (fail-closed) réappliqués dans **chaque route `cTok`** (défense en profondeur, pas de confiance au seul jeton).
- **AC-4** Une ouverture = exactement un audit d'accès patient avec `surface: "consultation-drawer"` (ne pas court-circuiter `openConsultation`).
- **AC-5** Parité fonctionnelle avec les onglets actuels du drawer.

## Risques
Rejet de sécurité si le drawer fetch via id numérique. Choisir **une seule famille de composants charts** (page vs drawer) pour éviter le double. Couvre archi US-B + US-C.
