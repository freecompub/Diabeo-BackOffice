# Générateur de propositions d'ajustement — Guide fonctionnel

> Compagnon **fonctionnel** (non technique) de la spec `algorithme-propositions-ajustement.md`.
> Décrit ce que fait le générateur, où ça s'affiche, comment agir et voir les impacts.
> État : **fonctionnellement et techniquement complet** (activation prod = actions humaines, voir §11).
> Version rendue (clair/sombre) disponible en Artifact ; les valeurs chiffrées des exemples sont illustratives.

---

## 1. Le principe en une page

Chaque nuit, le générateur passe en revue les patients suivis. Pour chacun, il regarde les glycémies
récentes et se demande : **la dose actuelle amène-t-elle le patient dans la cible ?** Si non, il rédige
une **proposition d'ajustement** — une valeur précise, motivée, chiffrée.

Cette proposition n'est **jamais appliquée automatiquement**. Elle naît « en attente » (`pending`) et
attend qu'un **médecin** la lise, la comprenne, puis l'accepte ou la rejette. Principe fondateur : la
machine **suggère**, le soignant **décide**. Un infirmier ou le patient peuvent *proposer* ; seul un
médecin *valide* (ADR #13).

---

## 2. Le cycle de vie d'une proposition

1. **Rassembler** — glycémies (capteur CGM ou lecteur capillaire), repas, corrections, config insuline.
2. **Analyser** — par créneau / moment, comparer le résultat observé à la cible, en écartant l'ambigu.
3. **Proposer** — si écart significatif *et* sûr : calculer une valeur bornée + créer une proposition motivée.
4. **Revoir** — le médecin voit valeur actuelle → proposée, %, motif, provenance ; accepte ou rejette.
5. **Appliquer** — à l'acceptation, la valeur devient la dose active, après vérification que rien n'a bougé.

`Données → Analyse → Proposition « en attente » → Revue médecin → Dose active`

---

## 3. Les quatre leviers de titration

Chaque levier est jugé sur la glycémie qu'il influence **réellement**.

| Levier | Ce qu'il regarde | Direction | Exemple |
|---|---|---|---|
| **ICR** (ratio insuline/glucides, repas) | Glycémie **après le repas** | Après-repas trop haut → **baisser l'ICR** (plus d'insuline) | Après-déjeuner ~2,0 g/L (cible 1,80) → renforcer la dose du midi |
| **Basal** (débit de fond, pompe) | Glycémie **à jeun** (créneau nuit) | À jeun trop haut → **augmenter** le débit nocturne | Réveils ~1,55 g/L (cible 1,00) → hausser la basale de nuit |
| **ISF** (facteur de sensibilité, corrections) | Résultat d'une **correction propre** à ~5 h | Correction insuffisante → **baisser l'ISF** | Correction faite, encore haut 5 h après → renforcer les corrections |
| **Dose fixe** (« doses simples », par moment) | Creux **pré-dose du moment suivant** | Creux trop haut → **augmenter** la dose | Dose du matin jugée sur le **pré-déjeuner** (elle agit en aval) |

**Garde-fous cliniques par levier** (extraits) :
- **Somogyi (basal)** : un creux nocturne masqué par un réveil élevé → hausse **refusée** (aggraverait l'hypo).
- **Corrections propres (ISF)** : on exclut les corrections confondues par un repas, une insuline
  résiduelle (IOB) ou un resucrage — c'est ce qui rend le signal fiable.
- **Shift dose fixe** : une dose se juge sur la fenêtre **suivante** (l'attribuer au même moment
  titrerait le mauvais moment) ; seuils plus stricts en grossesse (diabète gestationnel).

---

## 4. Le mode « orientation » — patients non insulinés

Un patient **non insuliné** (souvent DT2 sous comprimés) ne reçoit **jamais** de proposition de dose
(frontière réglementaire dispositif médical / MDR). Le moteur lève des **signaux d'orientation**
(`ClinicalReviewFlag`), invitations à revoir le patient — jamais un geste thérapeutique :

- **HbA1c à réaliser ou actualiser** — dernière HbA1c > 6 mois ou absente.
- **HbA1c au-dessus de la cible** — récente mais mauvaise (comble le cas du patient sans capteur).
- **Temps dans la cible (TIR) sous l'objectif** — < 70 %, bornes adaptées à la pathologie.
- **Suivi glycémique à vérifier (observance)** — auto-surveillance insuffisante (ni capteur porté, ni
  assez de mesures capillaires). Signal **honnête** : mesure la fréquence de surveillance, pas la prise
  de comprimés (donnée non disponible). Un porteur de capteur régulier n'est jamais faussement signalé.

---

## 5. Les garde-fous cliniques (transverses)

- **Jamais auto-appliqué** — validation médecin explicite, aucune boucle fermée.
- **Garde hypoglycémie** — toute hausse d'insuline est supprimée si un creux hypo récent est présent.
- **Bornes de sécurité** — valeurs dans des bornes cliniques ; amplitude d'ajustement plafonnée (titration lente).
- **Dose délivrable** — débit pompe arrondi au pas programmable (0,05 U/h).
- **Rien sur signal faible** — trop peu de mesures / données ambiguës → **fail-closed** (rien proposé).
- **Traçabilité** — chaque accès aux données de santé et chaque décision journalisés, sans PHI en clair.

---

## 6. Où cela s'affiche — les écrans

### a. Tableau de bord du médecin
- **Carte « Propositions en attente »** (`PendingProposalsCard`) : liste les propositions (paramètre,
  valeur actuelle → proposée, % de changement), avec lien vers la revue.
- **Carte « Patients à revoir »** (`ReviewFlagsCard`) : les signaux d'orientation par patient.

### b. L'écran de revue — `/patients/[id]/review` (`ReviewClient`)
Le cœur de la décision. Par proposition, le médecin voit :

| Élément | Signification |
|---|---|
| **Transition de valeur** (`0,80 → 0,90`) | Dose actuelle et proposée, dans l'unité du paramètre |
| **Pourcentage** | Amplitude du changement (toujours bornée) |
| **Sens de risque** | « plus d'insuline » (à surveiller) / « moins d'insuline » (sûr) |
| **Provenance** | Algorithme / infirmier / patient / médecin — **dérivée serveur**, non falsifiable |
| **Fiabilité** | Confiance du moteur (selon le nombre de mesures) |
| **Motif** | Raison clinique, en clair |
| **Avertissement « valeur changée »** | La config a bougé depuis la proposition → acceptation **bloquée** (anti sur-correction), badges %/sens masqués |

Accepter / rejeter est réservé au **médecin** (ou admin).

### c. Onglet « Traitements » de la fiche patient
Édition **directe** par un médecin, ou flux « Proposer » pour un infirmier — capacités adaptées au rôle
(bandeau indiquant ce qui est permis).

### d. Espace patient — « Mon insulinothérapie » (`/(patient)/patient/insulin-therapy`)
Lecture adaptée au mode de traitement + possibilité de **proposer** (délai anti-emballement, puis
validation médecin).

---

## 7. Comment opérer un changement

Trois chemins, une seule validation :

- **Chemin A — médecin direct** : édition immédiate d'une valeur depuis l'onglet Traitements.
- **Chemin B — infirmier / patient propose** : proposition « en attente » + notification du référent.
- **Chemin C — moteur (cron)** : le run nocturne crée les propositions pour tous les patients suivis.

**Accepter / rejeter (médecin)** :
1. Ouvrir l'écran de revue du patient.
2. Lire la proposition (valeur, %, sens, motif, provenance).
3. Décider : « Accepter » applique ; « Rejeter » ferme sans changement.
4. **Vérification finale** : si la dose a été modifiée entre-temps → refus (`baselineMoved`) + régénérer.

> **Une proposition par créneau à la fois** : impossible d'empiler deux propositions en attente sur le
> même créneau / moment pour un patient (index unique partiel `one_pending_per_slot`).

---

## 8. Comment voir les impacts côté interface

- **Avant d'accepter** — l'écran de revue *est* la prévisualisation : transition `actuel → proposé`, %,
  sens de risque disent exactement ce qui va changer.
- **Si la base a bougé** — bandeau « la valeur actuelle a changé », badges masqués, acceptation bloquée.
- **Après acceptation** — la valeur proposée devient la dose active (onglet Traitements), la proposition
  passe « acceptée », décision tracée (qui, quand).
- **Effet clinique dans le temps** — se lit dans les **tendances** du patient (courbes par moment, TIR,
  carnet) : vérifier que l'ajustement rapproche de la cible.
- **Au tour suivant** — le moteur repart de la nouvelle dose active ; plus de proposition si la cible
  est atteinte, sinon une nouvelle suggestion de faible amplitude.

> **Pas de double-titration** : chaque levier lit des événements **distincts** (ICR = bolus repas,
> basal = à-jeun, ISF = corrections, dose fixe = creux pré-dose). Un même épisode ne déclenche pas deux
> propositions contradictoires ; les modes de traitement sont mutuellement exclusifs.

---

## 9. Deux scénarios de bout en bout

**Scénario 1 — Ajustement basal accepté.** Réveils à 1,55 g/L sur 14 j, sans creux nocturne →
proposition basale 0,80 → 0,90 U/h (+12,5 %). Le médecin voit « plus d'insuline · fiabilité moyenne ·
à jeun régulièrement haut », **accepte**. Une semaine après, réveils ~1,05 g/L → plus de proposition.

**Scénario 2 — Garde hypo qui bloque, puis orientation.** Après-déjeuner souvent haut *mais* hypos
récurrentes en journée. La garde hypo empêche de renforcer l'ICR (dangereux) → **aucune dose** ; le
moteur lève le signal « forte variabilité post-prandiale » (revoir timing/composition du bolus en
consultation, pas pousser la dose).

---

## 10. Les services (annexe technique légère)

| Brique | Rôle |
|---|---|
| `proposal-algorithm` | Analyseurs **purs** (ICR, basal, ISF, dose fixe) + garde hypo. Direction + valeur, sans DB. |
| `meal-trends` / `analytics` | Assemblages : journal repas, à-jeun nocturne, appariement corrections, creux pré-dose. |
| `proposal-generator` | Chef d'orchestre : route par mode, cibles, appelle les analyseurs, persiste + run portefeuille. |
| `adjustment` | Persistance + décision : création (provenance serveur, anti-doublon) et acceptation médecin (anti-dérive, application, audit). |
| `clinical-bounds` | Source unique des bornes/seuils cliniques (verrou anti-dérive). |
| Route `cron/generate-proposals` | Point d'entrée nocturne (secret, POST-only), déclenche le run portefeuille. |

---

## 11. État & activation en production

**Complet** (fonctionnel + technique) : 4 leviers, mode orientation, écrans, garde-fous, cron livrés et
testés. **Activation effective** = 2 actions humaines (hors dev), suivies dans l'issue GitHub #691 :

1. **Signature DPO** de la DPIA `docs/compliance/dpia-us2651-proposal-generator.md`.
2. **Bascule d'activation** : `PROPOSAL_CRON_ENABLED=true` (défaut *éteint*) + scheduler OVH — sert
   aussi de coupe-circuit d'incident. Voir `docs/runbook/cron-proposal-generator.md`.

Tant que l'interrupteur n'est pas activé, le moteur ne s'exécute pas : activation **propre et
réversible**, sans redéploiement.

---

*Source de vérité des règles cliniques : le code (`src/lib/clinical-bounds.ts`,
`src/lib/proposal-algorithm.ts`) + le catalogue `docs/clinical-logic/regles-et-constantes-diabete.md`.*
