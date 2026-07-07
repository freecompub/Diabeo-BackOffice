# US-2657 — Maturité du patient & autonomie graduée (avec auto-application experte gouvernée)

> 📌 Sous-US de [US-2654](US-2654-EPIC-edition-creneaux-autonomie-graduee.md) · front + back + **gouvernance** · Taille **XL** · **Version : V1**
> · dépend de : US-2648, US-2649, US-2650, US-2655 (socle serveur groupe)
>
> **Statut** : 🟡 spécifiée — **aucun code avant validation.**
>
> ⚠️ **Frontière dispositif médical (MDR).** Cette US introduit la possibilité qu'un **paramètre de posologie** soit modifié **par le patient sans validation d'un professionnel de santé** (auto-application). C'est un **déplacement de classe** au sens du règlement (UE) 2017/745 (MDR). L'auto-application ne peut être livrée **qu'adossée** au harnais de gouvernance décrit au §5 : sans lui, la fonctionnalité reste **désactivée en dur** (flag `autoApply` OFF par défaut, non basculable sans décision de gouvernance + DPIA).

---

## 1. Intention (voix produit)

**Patient — autonomie graduée, jamais brutale.**
> « Au fur et à mesure que je comprends mon diabète, je gagne en autonomie sur mes réglages. Au début je *propose* une valeur, mon médecin valide. Plus tard je peux aussi réorganiser mes créneaux horaires. Quand mon équipe estime que je maîtrise vraiment, je peux *refuser* une proposition qu'on me fait, en faire une *contre-proposition*, et — si et seulement si mon équipe l'a explicitement décidé et encadré — appliquer moi-même certains petits ajustements sans attendre une validation, dans une enveloppe de sécurité que je ne peux pas franchir. »

**Médecin — c'est lui qui distribue l'autonomie, et il garde la main.**
> « **Je** décide du niveau de maturité de mon patient (ce n'est **jamais** auto-déclaré). Je peux le monter ou le redescendre à tout moment ; chaque changement est tracé. Même pour un patient "Expert", l'auto-application reste **fermée par défaut** : elle n'existe que si la direction médicale + le DPO l'ont ouverte pour ce patient, dans une enveloppe bornée, et **je suis notifié** de chaque changement auto-appliqué. Rien de risqué ne peut être auto-appliqué : tout ce qui sort de l'enveloppe **retombe en proposition** que je valide. »

Le niveau de maturité est un **codage de l'éducation thérapeutique du patient (ETP)** : il traduit une compétence clinique constatée par le soignant, pas une préférence d'interface.

---

## 2. Décisions actées (niveaux × capacités × voie d'application)

| Niveau | Modifier une **VALEUR** | Modifier les **CRÉNEAUX** (ajout/suppression/déplacement) | **Refuser** une proposition médecin | **Contre-proposer** | **Auto-application** | Voie d'application par défaut |
|---|---|---|---|---|---|---|
| **Junior** | ✅ | ❌ | ❌ | ❌ | ❌ | **Proposition** → validation DOCTOR |
| **Intermédiaire** | ✅ | ✅ | ❌ | ❌ | ❌ | **Proposition** → validation DOCTOR |
| **Expert** | ✅ | ✅ | ✅ | ✅ | ✅ *(gouvernée, voir §5)* | **Proposition** → validation DOCTOR, **sauf** si `autoApply=ON` **et** changement **dans l'enveloppe** (§4) |

Invariants non négociables :
- Le niveau est **posé par le soignant** (DOCTOR ; NURSE en création selon RBAC existant, jamais VIEWER). **Jamais** auto-déclaré par le patient. Toute tentative patient d'élever son propre niveau est **rejetée + auditée**.
- L'auto-application (colonne Expert) **n'est pas** une propriété du niveau seul : elle exige **en plus** le flag per-patient `autoApply=ON` **et** le passage de l'**enveloppe de sécurité** (§4). Niveau Expert + `autoApply=OFF` ⇒ **tout passe en proposition** (comportement identique à Intermédiaire pour la voie d'application).
- Tout ce qui **sort de l'enveloppe** ⇒ **retombe en proposition validée médecin** (fail-safe, jamais un rejet silencieux ni une application partielle).

---

## 3. Le modèle de maturité (matrice de capacités)

### 3.1 Définition des niveaux

- **Junior — « je propose une valeur ».**
  Peut éditer la **valeur** d'un créneau **existant** (ISF, ICR, débit basal, ou dose fixe selon le mode). **Ne peut pas** toucher à la **structure** (bornes horaires, ajout/suppression de créneau). Toute édition **produit une proposition** `pending` → validation DOCTOR (flux US-2649). Cap patient : `PATIENT_MAX_CHANGE_PERCENT` (10 %) / `FIXED_DOSE_PATIENT_MAX_DELTA_U` (1 U), cooldown `PATIENT_PROPOSAL_COOLDOWN_HOURS` (24 h).

- **Intermédiaire — « je propose aussi une réorganisation ».**
  Tout Junior **+** peut **ajouter / supprimer / déplacer** des créneaux horaires (restructuration ISF/ICR/basal, cf. US-2655/US-2656). Toujours **en proposition** → validation DOCTOR. La restructuration reste soumise aux invariants existants (couverture 24 h, pas de trou non couvert → fail-closed du calcul de bolus, délivrabilité basale).

- **Expert — « je peux dire non, contre-proposer, et parfois appliquer moi-même ».**
  Tout Intermédiaire **+** :
  1. **Refuser** une proposition émise par le médecin (droit du patient, §6) ;
  2. **Contre-proposer** une valeur/structure alternative (§6) ;
  3. **Auto-appliquer** un changement — **uniquement** si `autoApply=ON` (gouvernance, §5) **et** si le changement est **dans l'enveloppe** (§4). Sinon : contre-proposition/édition **retombe en proposition** validée médecin.

### 3.2 Qui pose le niveau, comment il change, traçabilité

- **Pose / modification** : acte soignant (DOCTOR ; NURSE en création selon RBAC). Stocké au niveau du dossier patient (`Patient.maturityLevel`, enum `JUNIOR | INTERMEDIATE | EXPERT`, **défaut `JUNIOR`**).
- **Réversibilité** : le soignant peut **rétrograder** à tout moment (ex. hypo répétées, événement clinique). Une rétrogradation sous Expert **désactive de facto** l'auto-application (le flag `autoApply` devient inopérant tant que le niveau n'est pas Expert — garde ET logique, pas OU).
- **Audit** : chaque pose/changement de niveau ⇒ `auditService.log` (`action: "MATURITY_LEVEL_CHANGED"`, `resource: "PATIENT"`, `metadata: { patientId, from, to, actorRole }`). Aucune PHI en clair.

### 3.3 Matrice de capacités (récapitulatif machine-lisible)

| Capacité | Junior | Intermédiaire | Expert |
|---|:---:|:---:|:---:|
| `editValue` | ✅ (proposition) | ✅ (proposition) | ✅ (proposition **ou** auto §4/§5) |
| `editSlots` (add/del/move) | ❌ | ✅ (proposition) | ✅ (proposition **ou** auto §4/§5) |
| `refuseProposal` | ❌ | ❌ | ✅ |
| `counterPropose` | ❌ | ❌ | ✅ |
| `autoApply` | ❌ | ❌ | ✅ **ssi** `autoApply=ON` **ET** enveloppe OK (§4) |

> Note d'implémentation (non dosante) : cette matrice est une **table de capacités serveur** (source unique), évaluée côté service avant toute écriture. Le front ne fait que **refléter** l'état ; la garde d'autorité est **serveur** (un client altéré ne peut pas s'auto-élever).

### 3.4 Emplacement & contrôle UI — **où le médecin pose le niveau**

- **Où** : fiche patient `/patients/[id]`, **onglet « Traitements »**, encart **« Autonomie du patient »** placé **en tête de l'onglet**, au-dessus du bandeau de capacité d'édition insuline (US-2648b). Emplacement choisi parce que la maturité **gouverne directement** les capacités d'édition présentées juste en dessous — le soignant voit « ce que le patient a le droit de faire » et « ses réglages » au même endroit. Un **badge lecture seule** « Autonomie : Intermédiaire » est **répliqué dans l'onglet Aperçu** (lecture d'un coup d'œil, non éditable).
- **Contrôle** : sélecteur segmenté à 3 crans **Junior · Intermédiaire · Expert** (`SegmentedControl` / `Select` shadcn), cran courant mis en évidence. Design system uniquement (classes sémantiques, aucun hex).
- **Qui peut changer** : **DOCTOR** (rôle **exactement** DOCTOR + `canAccessPatient`). **NURSE / VIEWER** : **lecture seule** (badge grisé, sélecteur `disabled`). Le **patient** ne voit **jamais** un contrôle de son propre niveau (cf. AC-1, auto-élévation rejetée + auditée).
- **Confirmation avant application** :
  - **Montée** de niveau → modale nommant explicitement la **capacité accordée** (« Vous autorisez ce patient à **restructurer ses créneaux horaires** » pour → Intermédiaire ; « … à **refuser vos propositions et contre-proposer** » pour → Expert).
  - **Descente** de niveau → modale rappelant que quitter **Expert neutralise l'auto-application** (levier d'urgence médecin, §5.4).
- **Effet** : immédiat — au prochain rendu, l'onglet Traitements et la **fenêtre de groupe (US-2656)** reflètent les nouvelles capacités (via la table de capacités serveur, §3.3). Aucune donnée de dose n'est modifiée par un changement de niveau.
- **Audit** : `MATURITY_LEVEL_CHANGED` (`from`, `to`, `actorRole`, `patientId`), sans PHI.
- **Défaut** : tout patient (existant migré / nouveau) démarre **Junior** — le cran le plus restrictif.

---

## 4. L'enveloppe de sécurité de l'auto-application — **cœur clinique**

> **Principe fondateur.** Un patient qui auto-applique un changement **hors enveloppe doit être *impossible*** — pas « découragé », pas « averti » : **techniquement impossible**. Hors enveloppe ⇒ la voie d'auto-application **n'existe pas** ; le changement est **transformé en proposition** `pending` validée DOCTOR. Fail-safe, jamais fail-open.

L'auto-application n'est **autorisée que si TOUTES** les conditions ci-dessous sont réunies (conjonction, court-circuit fail-closed dès la première fausse) :

### C1 — Autorité (capacité)
`maturityLevel === EXPERT` **ET** `patient.autoApply === true` (flag gouverné §5). Sinon → proposition.

### C2 — Type de changement : **VALEUR sur créneau existant uniquement**
- **Autorisé à l'auto-application** : modification de la **valeur** d'un créneau **déjà existant** (ISF, ICR, débit basal, dose fixe).
- **JAMAIS auto-applicable** (`AUTO_APPLY_STRUCTURAL_ALLOWED = false`) : **ajout**, **suppression** ou **déplacement d'heures** d'un créneau. Une restructuration touche la **couverture 24 h** et le **risque de trou** (fail-closed du calcul de bolus) : trop structurant pour être unilatéral. ⇒ **toujours** proposition, même Expert + `autoApply=ON`.

### C3 — Amplitude bornée (delta)
- **Ratios (ISF/ICR/basal)** : `|Δ| ≤ AUTO_APPLY_MAX_CHANGE_PERCENT` (10 %, aligné sur le cap patient — l'auto-application ne peut **jamais** dépasser ce qu'une proposition patient pourrait demander).
- **Dose fixe** : `|Δ| ≤ AUTO_APPLY_FIXED_DOSE_MAX_DELTA_U` (1,0 U, miroir de `FIXED_DOSE_PATIENT_MAX_DELTA_U`).
- Au-delà ⇒ **proposition** (le médecin voit une demande d'amplitude « non-titration »).

### C4 — Bornes cliniques absolues (jamais franchies)
La **valeur résultante** doit rester **strictement dans** `CLINICAL_BOUNDS` : `ISF_*`, `ICR_MIN/MAX`, `BASAL_MIN/MAX`, planchers dose fixe. **Franchir** une borne clinique n'est **ni auto-applicable ni proposable** : c'est un **rejet dur** à la saisie (invariant existant, hors flux gouvernance). L'enveloppe ne peut jamais « ouvrir » une valeur hors bornes.

### C5 — Délivrabilité
- Basal résultant = multiple de `PUMP_BASAL_INCREMENT` (0,05 U/h) via `isDeliverableBasalRate`.
- Dose fixe résultante = multiple de `FIXED_DOSE_DELIVERY_INCREMENT_U` (0,5 U).
- Non délivrable ⇒ **proposition** (pas d'arrondi silencieux auto-appliqué).

### C6 — **Garde de sens hypo (direction guard)** — la plus sensible
Un changement **augmentant l'exposition insulinique** est la **direction de risque hypo aigu**. Sont « insulin-increasing » :
- **baisse d'ICR** (moins de g/U ⇒ plus d'insuline/glucide),
- **baisse d'ISF** (mg/dL/U plus petit ⇒ correction plus forte ⇒ plus d'insuline),
- **hausse du débit basal**,
- **hausse d'une dose fixe**.

Règle : **l'auto-application d'un changement insulin-increasing est bloquée** dès qu'un **signal hypo récent** est présent, réutilisant la **garde HYPO des analyseurs** (US-2651) :
- **une** hypo **sévère** (niveau 2, < 0,54 g/L) sur la fenêtre ⇒ **bloque** ⇒ proposition ;
- **≥ `HYPO_LEVEL1_RECURRENCE_MIN` (2)** hypos **niveau 1** (0,54–0,70 g/L) ⇒ **bloque** ⇒ proposition.

Un changement insulin-increasing bloqué **ne disparaît pas** : il **retombe en proposition** pour que le médecin décide **en voyant le contexte hypo**. (Les changements insulin-**decreasing** restent enveloppés par C3–C5 mais ne sont pas soumis à la garde hypo — baisser l'insuline ne crée pas d'hypo aiguë ; voir la réserve « sous-dosage » §10.)

### C7 — Anti-cliquet (fréquence + cumul)
- **Cooldown** : `AUTO_APPLY_COOLDOWN_HOURS` (72 h) entre deux **auto-applications** sur le **même (patient × paramètre × créneau)** — un ajustement auto-appliqué doit être **observé ≥ 3 jours** avant le suivant (aligné sur `FIXED_DOSE_COOLDOWN_HOURS`). Plus strict que le cooldown de proposition (24 h) : ici il n'y a pas de médecin en boucle pour temporiser.
- **Cumul glissant** : la somme des deltas auto-appliqués sur un (paramètre × créneau) est plafonnée à `AUTO_APPLY_MAX_CUMULATIVE_PERCENT_PER_WEEK` (15 %) sur 7 jours glissants — empêche une **dérive par petits pas** (chaque pas dans l'enveloppe, mais le cumul non). Au-delà ⇒ proposition.

### C8 — Évaluation de l'enveloppe = **fail-closed**
Toute **donnée manquante, ambiguïté ou erreur** dans l'évaluation d'une condition (fenêtre glycémique indisponible, mode indéterminé, valeur non parseable…) ⇒ **l'enveloppe est réputée NON franchie** ⇒ proposition. On n'auto-applique **jamais** sur un doute.

**Sortie de l'algorithme d'enveloppe** (contrat) :
```
evaluateAutoApplyEnvelope(patient, change, glycemiaWindow) →
  { decision: "AUTO_APPLY", ... }                       // C1..C8 tous vrais
| { decision: "FALLBACK_PROPOSAL", failedCheck: Cx }    // au moins une fausse
| { decision: "HARD_REJECT", reason: "outOfClinicalBounds" } // C4 franchie
```
Le résultat (`decision` + `failedCheck` + before/after) est **audité systématiquement** (§5), y compris les `FALLBACK_PROPOSAL`.

---

## 5. Gouvernance & conformité

### 5.1 Flag `autoApply` — OFF par défaut, bascule gouvernée
- **Colonne per-patient** `Patient.autoApply: boolean` — **défaut `false`**, migration positionnant `false` pour **tous** les patients existants.
- **Qui bascule** : **jamais** un DOCTOR seul, **jamais** le patient. Bascule réservée à une **décision de gouvernance** matérialisée par un **rôle/attribut `GOVERNANCE`** (direction médicale **+** DPO). L'acte de bascule exige une **référence de décision de gouvernance** (id de décision) et une **référence de DPIA** (voir 5.3) — sans ces deux références, la bascule est **refusée** (fail-closed).
- **Effet ET-logique** : `autoApply=ON` est **inopérant** si `maturityLevel !== EXPERT`. Rétrograder le niveau **neutralise** l'auto-application sans avoir à re-basculer le flag.

### 5.2 Notification du médecin référent (awareness, pas validation)
- À **chaque** changement **auto-appliqué**, le **médecin référent** (`PatientReferent`) est **notifié** (canal notif existant). La notification est une **prise de connaissance**, **pas** une validation : le changement est **déjà appliqué**. Elle inclut : paramètre, créneau, valeur avant/après, résultat de l'enveloppe (« AUTO_APPLY »), horodatage. **Aucune PHI en clair** hors canal sécurisé.
- Le médecin conserve le droit de **rétrograder** le niveau ou de **re-proposer** une correction s'il juge l'auto-application inopportune.

### 5.3 Audit complet + DPIA (dépendance dure)
- **Audit** : chaque auto-application ⇒ `BolusCalculationLog`/`AdjustmentProposal` **+** `auditService.logWithTx` (`action: "AUTO_APPLIED_SETTING"`), avec : `maturityLevel`, `autoApply`, **before/after**, **résultat de la vérification d'enveloppe** (`decision`, `failedCheck` le cas échéant), acteur = patient, id de décision de gouvernance. Tout dans une **transaction Prisma** (application + log atomiques, ADR #15). Les `FALLBACK_PROPOSAL` et `HARD_REJECT` sont **aussi** audités (pourquoi ça n'a **pas** été auto-appliqué = donnée de sûreté).
- **DPIA — prérequis bloquant** : activer l'auto-application **sur des patients réels** exige une **DPIA dédiée** (`docs/compliance/dpia-auto-application.md`) validée **avant** toute bascule `autoApply=ON` en production. C'est une **dépendance dure**, **pas** un « nice-to-have dev-only » : la garde 5.1 (référence DPIA obligatoire) **matérialise** ce prérequis dans le code. Sans DPIA référencée ⇒ bascule refusée.
- **Frontière MDR** : la DPIA + le dossier de gouvernance doivent expliciter le **déplacement de classe** (auto-modification d'un paramètre de dosage sans validation HCP) et l'**enveloppe** comme **mesure de maîtrise du risque** documentée.

### 5.4 Emplacement & contrôle UI — **où l'on bascule `autoApply` (gouvernance)**

- **Séparation stricte d'autorité** : le **médecin** change le *niveau* (§3.4) ; il **ne peut PAS** basculer `autoApply`. La bascule est un **acte de gouvernance**, pas un acte de soin. Deux autorités, deux contrôles distincts.
- **Où** : un panneau **« Auto-application — gouvernance »** rendu **uniquement pour le rôle `GOVERNANCE`** (invisible pour DOCTOR / NURSE / VIEWER / patient). Recommandation : panneau **dans la fiche patient** (onglet Traitements, sous l'encart « Autonomie »), gated `GOVERNANCE`, pour conserver le contexte patient — plutôt qu'un écran d'admin déconnecté. Alternative acceptable : un écran d'administration gouvernance listant les patients **éligibles** (niveau Expert).
- **Pré-conditions à l'activation** (toutes requises, sinon **refus fail-closed** — le bouton « Activer » reste inactif) :
  1. `maturityLevel === EXPERT` (sinon toggle `disabled` + explication « niveau Expert requis ») ;
  2. **Référence de décision de gouvernance** (champ obligatoire — id de décision direction médicale) ;
  3. **Référence de DPIA** (champ obligatoire — pointeur vers `docs/compliance/dpia-auto-application.md` validée).
- **Ce que voit le médecin** : un **indicateur lecture seule** « Auto-application : **activée** par la gouvernance le JJ/MM/AAAA » ou « **désactivée** » — **non actionnable** par lui. Transparence sans autorité.
- **Désactivation (kill-switch)** :
  - la **gouvernance** peut désactiver à tout moment (immédiat, audité) ;
  - le **médecin** ne bascule pas le flag mais dispose d'un **levier d'urgence clinique** : **rétrograder le niveau** sous Expert neutralise **instantanément** l'auto-application (garde ET-logique §3.2 / §5.1) — sans attendre la gouvernance.
- **Audit** : `AUTO_APPLY_FLAG_CHANGED` (`from`, `to`, `decisionRef`, `dpiaRef`, acteur gouvernance, `patientId`), sans PHI. Toute **tentative** d'un rôle non-`GOVERNANCE` de basculer le flag → refus 403 audité.

---

## 6. Refuser / contre-proposer (workflow)

- **Refuser (droit du patient, Expert).** Le patient peut **refuser** une proposition émise par le médecin. La proposition passe `rejected` (traçé, `reviewedByRole=PATIENT`, motif optionnel chiffré `proposerComment`). **Rien n'est appliqué.** Le médecin est notifié.
- **Contre-proposer (Expert).** Le patient émet une **contre-proposition** (valeur/structure alternative), bornée (C3–C5 s'appliquent à la saisie). Routage :
  - **Cas standard (`autoApply=OFF` ou hors enveloppe)** : la contre-proposition **route vers le médecin** comme une nouvelle proposition `pending` (**dialogue** patient ⇄ médecin) → décision DOCTOR (accept/reject).
  - **Cas gouverné (`autoApply=ON` et dans l'enveloppe §4)** : la contre-proposition **peut être auto-appliquée** (même enveloppe C1–C8, notif médecin, audit). Hors enveloppe ⇒ retour au cas standard (proposition).
- Une contre-proposition ne peut **jamais** contourner l'enveloppe : la voie « dialogue médecin » est le **défaut de sûreté**.

---

## 7. Critères d'acceptation (Gherkin FR)

```gherkin
Fonctionnalité: Maturité du patient & autonomie graduée avec auto-application gouvernée

  Scénario: AC-1 — Le niveau de maturité est posé par le soignant, jamais auto-déclaré
    Étant donné un patient de niveau "Junior"
    Quand le patient tente d'élever son propre niveau à "Expert"
    Alors la requête est rejetée (403)
    Et l'événement est audité (action "MATURITY_LEVEL_SELF_ELEVATION_DENIED")
    Et le niveau du patient reste "Junior"

  Scénario: AC-2 — Junior peut modifier une valeur mais pas restructurer
    Étant donné un patient de niveau "Junior"
    Quand il modifie la valeur d'un créneau ISF existant dans son cap patient
    Alors une proposition "pending" est créée et le médecin est notifié
    Mais quand il tente d'ajouter ou de supprimer un créneau
    Alors l'action est refusée (capacité non accordée au niveau Junior)

  Scénario: AC-3 — Intermédiaire peut restructurer les créneaux (en proposition)
    Étant donné un patient de niveau "Intermédiaire"
    Quand il ajoute un créneau ICR couvrant une plage horaire non couverte
    Alors une proposition "pending" de restructuration est créée
    Et la couverture 24 h reste garantie (aucun trou non couvert)
    Et rien n'est appliqué sans validation DOCTOR

  Scénario: AC-4 — Expert + autoApply ON : changement DANS l'enveloppe est auto-appliqué
    Étant donné un patient "Expert" avec autoApply activé par la gouvernance
    Et aucune hypo récente sur la fenêtre
    Quand il modifie la valeur d'un créneau basal existant de +8 % (dans le cap 10 %, valeur délivrable, dans les bornes)
    Alors le changement est AUTO-APPLIQUÉ
    Et le médecin référent est notifié (prise de connaissance)
    Et l'auto-application est auditée avec before/after et résultat d'enveloppe "AUTO_APPLY"

  Scénario: AC-5 — Expert : changement HORS enveloppe (amplitude) retombe en proposition
    Étant donné un patient "Expert" avec autoApply activé
    Quand il tente une hausse de dose fixe de +2,0 U (au-delà du cap 1,0 U auto-apply)
    Alors le changement n'est PAS auto-appliqué
    Et il retombe en proposition "pending" validée DOCTOR
    Et le fallback est audité (failedCheck = amplitude)

  Scénario: AC-6 — Un changement structurel n'est JAMAIS auto-appliqué, même Expert + ON
    Étant donné un patient "Expert" avec autoApply activé
    Quand il ajoute ou supprime un créneau, ou déplace ses heures
    Alors le changement retombe en proposition validée DOCTOR
    Et il n'existe aucune voie d'auto-application pour une modification structurelle

  Scénario: AC-7 — Garde de sens hypo : hausse d'insuline bloquée si hypo récente
    Étant donné un patient "Expert" avec autoApply activé
    Et une hypo sévère (< 0,54 g/L) sur la fenêtre récente
    Quand il tente une baisse d'ICR (direction insulin-increasing) dans le cap
    Alors l'auto-application est BLOQUÉE par la garde hypo
    Et le changement retombe en proposition, avec le contexte hypo visible du médecin

  Scénario: AC-8 — Garde de sens hypo : hypos niveau 1 récurrentes bloquent aussi
    Étant donné un patient "Expert" avec autoApply activé
    Et au moins 2 hypos niveau 1 (0,54–0,70 g/L) sur la fenêtre
    Quand il tente une hausse de débit basal dans le cap
    Alors l'auto-application est bloquée et retombe en proposition

  Scénario: AC-9 — autoApply OFF par défaut bloque l'auto-application même pour un Expert
    Étant donné un patient "Expert" dont le flag autoApply est OFF (défaut)
    Quand il modifie une valeur dans l'enveloppe
    Alors le changement N'EST PAS auto-appliqué
    Et il route en proposition validée DOCTOR (comportement identique à Intermédiaire)

  Scénario: AC-10 — Rétrograder le niveau neutralise l'auto-application
    Étant donné un patient "Expert" avec autoApply ON
    Quand le médecin le rétrograde à "Intermédiaire"
    Alors l'auto-application devient inopérante (garde ET niveau=Expert ET autoApply=ON)
    Et le changement de niveau est audité

  Scénario: AC-11 — Bascule du flag autoApply refusée sans gouvernance ni DPIA
    Étant donné un DOCTOR sans rôle GOVERNANCE
    Quand il tente d'activer autoApply pour un patient
    Alors la bascule est refusée
    Et même la gouvernance ne peut activer sans référence de décision ET référence de DPIA (fail-closed)

  Scénario: AC-12 — Anti-cliquet : cooldown entre deux auto-applications
    Étant donné un patient "Expert" avec autoApply ON ayant auto-appliqué un basal il y a 12 h
    Quand il tente une nouvelle auto-application sur le même créneau basal
    Alors elle est bloquée par le cooldown (72 h) et retombe en proposition

  Scénario: AC-13 — Anti-cliquet : cumul hebdomadaire plafonné
    Étant donné un patient "Expert" avec autoApply ON ayant déjà auto-appliqué +12 % cumulés sur un créneau ISF sur 7 jours
    Quand il tente +5 % supplémentaires (cumul 17 % > 15 %)
    Alors l'auto-application est bloquée et retombe en proposition

  Scénario: AC-14 — Contre-proposition Expert route vers le médecin hors enveloppe/OFF
    Étant donné un patient "Expert" avec autoApply OFF
    Quand il refuse une proposition médecin et émet une contre-proposition
    Alors la proposition initiale passe "rejected" (tracé)
    Et la contre-proposition route en "pending" vers le médecin (dialogue)
    Et rien n'est appliqué sans décision DOCTOR

  Scénario: AC-15 — Fail-closed de l'évaluation d'enveloppe
    Étant donné un patient "Expert" avec autoApply ON
    Et une fenêtre glycémique indisponible (donnée manquante)
    Quand il tente une auto-application insulin-increasing
    Alors l'enveloppe est réputée NON franchie
    Et le changement retombe en proposition (jamais d'auto-application sur un doute)
    Et le fallback est audité

  Scénario: AC-16 — Le médecin pose le niveau depuis la fiche patient (onglet Traitements)
    Étant donné un DOCTOR responsable du patient, sur l'onglet Traitements
    Quand il change le niveau d'autonomie de "Junior" à "Intermédiaire"
    Alors une confirmation nomme la capacité accordée (restructurer les créneaux)
    Et après confirmation le niveau est "Intermédiaire"
    Et le changement est audité (MATURITY_LEVEL_CHANGED avec from/to/actorRole)
    Et un NURSE ne voit ce contrôle qu'en lecture seule
    Et le patient ne voit aucun contrôle de son propre niveau

  Scénario: AC-17 — Le médecin ne peut pas basculer l'auto-application
    Étant donné un DOCTOR sur la fiche d'un patient "Expert"
    Quand il consulte la section auto-application
    Alors il voit un indicateur en lecture seule (activée ou désactivée par la gouvernance)
    Et aucun contrôle ne lui permet de basculer le flag autoApply
    Mais il peut rétrograder le niveau pour neutraliser l'auto-application (levier d'urgence)

  Scénario: AC-18 — La gouvernance active l'auto-application avec les références obligatoires
    Étant donné un utilisateur de rôle GOVERNANCE sur un patient "Expert"
    Quand il tente d'activer autoApply sans référence de décision ou sans référence de DPIA
    Alors l'activation est refusée (fail-closed)
    Et quand il fournit la référence de décision ET la référence de DPIA puis active
    Alors autoApply passe à ON
    Et l'acte est audité (AUTO_APPLY_FLAG_CHANGED avec decisionRef et dpiaRef)
    Et un rôle non-GOVERNANCE tentant la bascule reçoit 403 audité
```

---

## 8. Constantes / catalogue (à enregistrer dans `docs/clinical-logic/regles-et-constantes-diabete.md`)

Nouvelles constantes à ajouter dans `src/lib/clinical-bounds.ts` (source de vérité) + catalogue (§1 « Bornes de sécurité » et une nouvelle sous-section « Auto-application experte gouvernée — enveloppe de sécurité »), verrouillées anti-drift par `tests/unit/clinical-bounds.test.ts` :

| Constante | Valeur proposée | Sens clinique / rôle | Fichier source |
|---|---|---|---|
| `AUTO_APPLY_MAX_CHANGE_PERCENT` | `10` (%) | Amplitude max auto-applicable sur un ratio ISF/ICR/basal. **≤ `PATIENT_MAX_CHANGE_PERCENT`** : l'auto-application ne dépasse jamais ce qu'une proposition patient pourrait demander. | `clinical-bounds.ts` |
| `AUTO_APPLY_FIXED_DOSE_MAX_DELTA_U` | `1.0` (U) | Delta max auto-applicable sur une dose fixe. Miroir de `FIXED_DOSE_PATIENT_MAX_DELTA_U`. | `clinical-bounds.ts` |
| `AUTO_APPLY_STRUCTURAL_ALLOWED` | `false` | Verrou : un changement **structurel** (ajout/suppression/déplacement de créneau) **n'est jamais** auto-applicable → toujours proposition. | `clinical-bounds.ts` |
| `AUTO_APPLY_COOLDOWN_HOURS` | `72` (h) | Cooldown entre deux auto-applications sur (patient × paramètre × créneau). Observation ≥ 3 j (aligné `FIXED_DOSE_COOLDOWN_HOURS`) ; plus strict que le cooldown proposition (24 h). | `clinical-bounds.ts` |
| `AUTO_APPLY_MAX_CUMULATIVE_PERCENT_PER_WEEK` | `15` (%) | Anti-cliquet : cumul glissant 7 j des deltas auto-appliqués sur un (paramètre × créneau). < cap moteur (20 %). | `clinical-bounds.ts` |

Constantes/règles **réutilisées** (à référencer, pas à redéfinir) :
- `PATIENT_MAX_CHANGE_PERCENT` (10 %), `FIXED_DOSE_PATIENT_MAX_DELTA_U` (1,0 U) — plafonds patient servant de base à l'enveloppe.
- `CLINICAL_BOUNDS` ISF/ICR/basal + planchers dose fixe — bornes absolues **jamais** franchies (C4).
- `PUMP_BASAL_INCREMENT` (0,05) / `isDeliverableBasalRate`, `FIXED_DOSE_DELIVERY_INCREMENT_U` (0,5) — délivrabilité (C5).
- Garde HYPO analyseurs : seuils hypo sévère (54 mg/dL) / cible basse (70 mg/dL), `HYPO_LEVEL1_RECURRENCE_MIN` (2) — garde de sens hypo (C6).
- `PATIENT_PROPOSAL_COOLDOWN_HOURS` (24 h) — cooldown des propositions (voie non auto-appliquée).

Éléments de modèle de données (à décrire dans le catalogue + schéma) : enum `MaturityLevel { JUNIOR, INTERMEDIATE, EXPERT }`, `Patient.maturityLevel` (défaut `JUNIOR`), `Patient.autoApply` (bool, défaut `false`), rôle/attribut `GOVERNANCE`, actions d'audit `MATURITY_LEVEL_CHANGED`, `AUTO_APPLIED_SETTING`, `AUTO_APPLY_ENVELOPE_FALLBACK`.

---

## 9. Hors périmètre

- **UI de la modale de groupe** (US-2656) — présentation groupée des réglages, non traitée ici.
- **Endpoint serveur de groupe** (US-2655) — agrégation serveur des créneaux, hors périmètre.
- **Génération à la demande** des propositions (US-2658) — déclenchement manuel du générateur, séparé.
- **Détermination automatique de la maturité par profilage / vérification d'observance** (analyse d'adhésion, TIR, régularité) pour *suggérer* un niveau : **V3, US séparée** (annexe US-2658). Dans cette US, le niveau reste **posé exclusivement par le soignant** ; aucun calcul n'élève ou ne suggère automatiquement un niveau.

---

## 10. Réserves cliniques signalées (pour revue `medical-domain-validator`)

1. **C6 (garde de sens hypo)** ne s'applique qu'aux changements *insulin-increasing*. Les changements *insulin-decreasing* sont laissés auto-applicables sans garde hypo (baisser l'insuline ne crée pas d'hypo aiguë) — mais un patient qui *baisse* trop son basal risque une hyperglycémie/acido-cétose à moyen terme. L'anti-cliquet C7 (cumul 15 %/7 j) borne cette dérive ; **à confirmer clinique** si un garde-fou symétrique « sous-dosage » est souhaité.
2. Valeurs proposées pour `AUTO_APPLY_COOLDOWN_HOURS` (72 h) et `AUTO_APPLY_MAX_CUMULATIVE_PERCENT_PER_WEEK` (15 %) **à faire valider medical** — calées par cohérence avec les constantes existantes (titration ≥ 3 j, cumul < cap moteur 20 %), pas sur une référence externe formelle.

---

### Rappels de conformité (checklist livraison)
- [ ] Table de capacités **évaluée serveur** (aucune autorité côté client) ; auto-élévation patient rejetée + auditée.
- [ ] Enveloppe **fail-closed** ; hors enveloppe ⇒ **proposition** (jamais rejet silencieux, jamais application partielle).
- [ ] Flag `autoApply` **OFF par défaut** ; bascule **GOVERNANCE** exigeant **id décision + réf. DPIA** (fail-closed).
- [ ] **DPIA dédiée** (`docs/compliance/dpia-auto-application.md`) validée **avant** toute activation en production (dépendance dure, matérialisée dans le code).
- [ ] Notification médecin référent à **chaque** auto-application (awareness).
- [ ] Audit **before/after + résultat d'enveloppe** sur auto-application **et** fallbacks, en transaction Prisma.
- [ ] Constantes ajoutées à `clinical-bounds.ts` **+** catalogue `regles-et-constantes-diabete.md` **+** verrou `clinical-bounds.test.ts`, dans la **même PR**.
- [ ] JSDoc sur `evaluateAutoApplyEnvelope`, la table de capacités, la garde de sens hypo, avec référence explicite à la **frontière MDR**.
