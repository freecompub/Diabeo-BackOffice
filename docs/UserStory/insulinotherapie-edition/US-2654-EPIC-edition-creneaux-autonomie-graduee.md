# US-2654 — EPIC : Édition des créneaux horaires & autonomie graduée du patient

> 📌 Épic · fiche patient + espace patient · front + back + **migration Prisma** · Taille **XL**
> · fait suite à US-2645 (édition insulinothérapie multi-mode) · concerne l'ADR #13, la frontière MDR
>
> **Statut** : 🟡 spécification (à valider) — **aucun code de production avant validation de l'épic.**
> Cadrage de référence : Artifact « Édition des créneaux horaires » (v3).

## 1. Intention (voix produit)

> En tant que **médecin**, je veux **restructurer l'emploi du temps** de l'insulinothérapie
> d'un patient (changer les **heures** d'un créneau, en **ajouter** ou en **supprimer**),
> pas seulement en changer la valeur — dans **une seule fenêtre**, en validant l'ensemble
> d'un coup.
>
> En tant que **patient**, selon mon **niveau de maturité**, je veux pouvoir **proposer**
> (voire, à haut niveau et sous gouvernance, **appliquer**) un changement de mes réglages —
> sans jamais mettre ma sécurité en jeu.
>
> En tant que **médecin ou infirmier**, je veux pouvoir **relancer une génération de
> propositions** sur une **période que je choisis** (2 j à 2 semaines), sans attendre le
> run nocturne.

## 2. Le problème (constat ancré dans le code)

On peut changer la **valeur** d'un créneau, mais **pas ses heures** — et pour tout le monde :

| Opération | ISF | ICR | Basal (pompe) |
|---|---|---|---|
| Changer la **valeur** | ✅ | ✅ | ✅ |
| Changer les **heures** | ❌ | ❌ | ❌ |
| **Supprimer** un créneau | ❌ endpoint manquant | ❌ manquant | ✅ |
| **Créer** un créneau | ✅ | ✅ | ✅ |

Deux bugs latents découverts au cadrage :
- **IDOR** : `deleteIsf`/`deleteIcr` (`src/lib/services/insulin-therapy.service.ts`) ne sont **pas scopés patient**.
- **UI menteuse** : la page autonome `/insulin-therapy` masque un créneau puis appelle un DELETE
  inexistant avec `.catch(() => null)` → la base garde le créneau (dérive silencieuse sur une config médicale).

## 3. Décisions actées (avec l'utilisateur)

| # | Décision |
|---|---|
| D1 | **Modèle « fenêtre + groupe »** : une modale montre **tous les créneaux** d'un paramètre ; on édite valeur/heures, on ajoute/supprime une ligne, on valide **l'ensemble** (`Valider` / `Annuler`). |
| D2 | **« Valider » inactif tant que l'ensemble n'est pas cohérent** ; les lignes en conflit (trou / chevauchement) sont **surlignées**. |
| D3 | **Cohérence calculée côté front (UX), re-validée serveur (autorité)**. On ne fait jamais confiance au client sur une config médicale. |
| D4 | **Chevauchement = bloqué** (double-dose). **Trou ISF/ICR = bloqué au save** (possible car on valide le set final complet) ; **trou basal = avertissement** (fenêtre suspendue légitime). Le gate read-time `coherent` reste en défense. |
| D5 | Le service **enregistre un GROUPE** (« remplace l'ensemble », transactionnel), plus ligne par ligne. Choix **remplacer** (pas diff) — voir D7. |
| D6 | **Autonomie graduée par maturité** du patient (fixée par le soignant, tracée) : **junior** = valeurs ; **intermédiaire** = valeurs + créneaux ; **expert** = + refuser/contre-proposer + **auto-application** (gouvernée). |
| D7 | **Une seule proposition à la fois** par patient : si une est en cours, l'utilisateur est **alerté** et bloqué jusqu'à sa résolution. Conséquence : **zéro collision** (le point P2 de revue disparaît) et le « remplacer » simple suffit. |
| D8 | **Auto-application experte** : construite **maintenant**, mais **OFF par défaut** + activable seulement par la **gouvernance (direction médicale + DPO)** + **notification** médecin + **enveloppe de bornes** + **DPIA** dédiée. |
| D9 | **Génération à la demande** (médecin/infirmier) sur **fenêtre bornée [2 j, 14 j]** : réutilise le moteur existant, propose (n'applique pas), respecte D7, auditée. |
| D10 | **Restructurer** reste un **acte encadré** : médecin en direct ; patient/infirmier via proposition (selon maturité). Jamais de franchissement de la frontière MDR sans gouvernance (D8). |

> ⚠️ **Réserve tracée (avis dev)** : l'auto-application experte (D8) est un potentiel
> **mouvement de classe dispositif médical (MDR)**. Le dev fournit le harnais ;
> l'**activation** est une décision **direction médicale + DPO + qualité/réglementaire**,
> conditionnée à une **DPIA**. « Tracer les changements » est nécessaire mais **pas suffisant**.

## 4. Découpage en sous-US

| Sous-US | Titre | Nature |
|---|---|---|
| [US-2655](US-2655-socle-serveur-groupe.md) | Socle serveur : enregistrement transactionnel d'un **groupe** de créneaux (+ cohérence stricte serveur, fix IDOR, une-seule-proposition) | back |
| [US-2656](US-2656-fenetre-edition-creneaux.md) | La **fenêtre d'édition** « tous les créneaux » (fiche + espace patient, capacités par rôle) + retrait de la page autonome | front |
| [US-2657](US-2657-maturite-autonomie-graduee.md) | **Maturité** du patient & autonomie graduée (+ auto-application experte **gouvernée**) | back + conformité |
| [US-2658](US-2658-generation-a-la-demande.md) | **Génération à la demande** sur période [2 j, 14 j] (médecin/infirmier) | back |

**Dépendances** : US-2656 dépend de US-2655 (endpoint groupe) ; US-2657 dépend de US-2655
(chemin proposition/auto-apply) ; US-2658 est **indépendante** (peut être livrée en parallèle).

## 5. Report V3 (tracé, non construit ici)

**Check d'adhérence & profilage patient** : dans la génération, vérifier si les doses
**réellement utilisées** correspondent aux constantes du patient ; sinon analyser la dose
hors-config et son **impact** (positif/négatif) et **profiler** le patient (ce qui peut
éclairer la maturité, D6). **Prérequis captation de données** : on capte aujourd'hui
`recommendedDose` + `wasDelivered` (booléen), **pas le montant réellement injecté**.
Détail dans l'annexe de [US-2658](US-2658-generation-a-la-demande.md) + entrée ROADMAP V3.
« Profilage » = RGPD Art. 22 → **DPIA** ; le profil **éclaire** la décision du soignant, ne la remplace pas.

## 6. Garde-fous transverses (rappel)

- **Fail-closed** : un trou de couverture ISF/ICR ne peut plus être enregistré (D4) ; en défense,
  le calcul de bolus refuse (visiblement) toute heure non couverte — jamais une dose fausse.
- **Anti-IDOR** : tout accès/écriture scopé patient (`settings.patientId`) ; fix de `deleteIsf/deleteIcr`.
- **RBAC** : médecin = direct ; patient/infirmier = proposition (selon maturité) ; ADMIN = à revoir (bypass `canEditDirect`).
- **Audit** : chaque groupe journalisé `ancien set → nouveau set` (+ auteur, maturité), sans PHI.
- **Documentation / catalogue** : toute constante clinique nouvelle (enveloppe auto-application,
  bornes fenêtre génération) inscrite dans `docs/clinical-logic/regles-et-constantes-diabete.md`.

## 7. Hors périmètre de l'épic

- Le report V3 (check d'adhérence & profilage) — tracé, pas construit.
- Le déplacement d'heures **mono-créneau** (branche `feat/us2654-slot-hours-move` / PR #693) :
  **remplacé** par le modèle « groupe » (D1/D5) ; la branche reste en référence, non mergée.
