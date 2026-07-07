# US-2658 — Génération de propositions à la demande, sur une période (2 j → 14 j)

> 📌 Sous-US de [US-2654](US-2654-EPIC-edition-creneaux-autonomie-graduee.md) · **back** · Taille **M** · **indépendante** (livrable en parallèle)
> · **Version : V1**
>
> **Statut** : 🟡 spécifiée — **aucun code avant validation.**
> **Risque** : faible — réutilisation du moteur existant, fenêtré. Aucun nouveau levier de dose.
> **Dépend de** : US-2651 (générateur de propositions), US-2650 (une proposition à la fois).
> **Sources code** : `src/lib/services/proposal-generator.service.ts` (`generateForPatient`), `src/app/api/cron/generate-proposals/route.ts`, `src/lib/clinical-bounds.ts`.

---

## 1. Intention (voix produit)

> **Médecin / infirmier** : « Mon patient a vécu un changement récent — reprise du sport, sortie d'hospitalisation, modification de traitement, arrêt de travail, jeûne, voyage. Le carnet du run nocturne s'appuie encore en partie sur des jours qui ne reflètent plus sa titration actuelle. Je veux **relancer une analyse maintenant, sur une période que je choisis** (par exemple les 4 derniers jours depuis sa sortie d'hôpital), sans attendre le cron de 2 h du matin, et sans que les données trop anciennes ne polluent le signal. »

Le run nocturne (cron) reste le mode par défaut, portefeuille-large, sur fenêtre fixe (14 j ICR/basal, 30 j ISF). US-2658 ajoute une **entrée manuelle, patient-ciblée, fenêtre-choisie**, pour le cas où le soignant sait que « les X derniers jours » sont la bonne base d'analyse — ni plus (données périmées), ni la fenêtre standard imposée.

C'est un **outil de relance clinicien**, pas un nouvel algorithme : même moteur, mêmes garde-fous, simplement déclenché à la demande et fenêtré.

---

## 2. Décisions actées

| # | Décision | Justification |
|---|----------|---------------|
| D1 | Déclenchement manuel réservé à **DOCTOR ou NURSE**, patient-ciblé | Acte de suivi soignant. Le NURSE peut déjà créer une config non validée (RBAC) ; relancer une analyse est du même ordre. |
| D2 | **Patient exclu** de ce déclenchement | La génération est un outil de suivi ; le patient ne pilote pas l'analyse (il peut seulement, ailleurs, formuler une demande d'ajustement bornée — US-2649). |
| D3 | Fenêtre d'analyse **choisie**, bornée à **[2 j ; 14 j]** | < 2 j : signal trop faible (nombre de repas/nadirs appariés insuffisant). > 14 j : données trop anciennes, ne reflètent plus la titration en cours (aligné `AGP_SUFFICIENCY.MIN_DAYS = 14`). |
| D4 | **Réutilise `generateForPatient`** avec la fenêtre en **paramètre borné** | Zéro nouveau chemin de calcul. Tous les garde-fous existants s'appliquent mécaniquement. |
| D5 | **Propose, n'applique jamais** | ADR #13 : `BolusCalculationLog`/moteur → `AdjustmentProposal` `pending` → validation médecin. Le déclenchement à la demande ne change pas ce contrat. |
| D6 | **Une proposition à la fois** : si une proposition `pending` existe déjà pour le patient (même paramètre × créneau), le déclenchement **alerte et n'empile pas** | Réutilise l'anti-empilement `one_pending_per_slot` (US-2650). L'appelant reçoit un retour explicite `proposalAlreadyPending`. |
| D7 | **Audité** : qui a déclenché, quelle fenêtre, quand | Traçabilité HDS — l'acteur est le soignant réel (pas l'acteur système `null` du cron). |
| D8 | Le run à la demande **reste `basalBolus` / `fixedDose` / `nonInsulin`-aware** | Le routage par mode de `generateForPatient` est inchangé : un non-insuliné n'obtient que des flags d'orientation, jamais une dose. |

---

## 3. Le paramètre fenêtre

### Rationale clinique des bornes

- **Plancher 2 jours.** En deçà, l'échantillon est trop maigre pour un signal fiable : le moteur exige **≥ 3 repas appariés par créneau** (`MIN_MEALS_PER_SLOT`), **≥ 3 nuits de nadir** pour autoriser une hausse basale (`MIN_NADIR_NIGHTS`, garde Somogyi), et **≥ 3 relevés par moment** pour la dose fixe. Sur 2 jours, ces seuils ne sont généralement pas atteints → **le moteur ne propose rien**, ce qui est le comportement voulu (voir « bords » ci-dessous).
- **Plafond 14 jours.** Au-delà, on ré-introduit des jours qui ne reflètent plus la titration actuelle — exactement ce que le déclenchement à la demande cherche à éviter (« depuis le changement de mode de vie »). 14 j est aussi la fenêtre standard AGP (`AGP_SUFFICIENCY.MIN_DAYS`) et la fenêtre par défaut du run ICR/basal.

### Alimentation du lookback moteur

Aujourd'hui, `generateForPatient` utilise des constantes de période :

- `ANALYSIS_PERIOD = "14d"` — ICR, basal, dose fixe (repas, à-jeun, creux pré-dose) ;
- `ISF_ANALYSIS_PERIOD = "30d"` — corrections propres appariées (plus rares).

US-2658 introduit une **fenêtre d'analyse paramétrable** `windowDays ∈ [2 ; 14]`, injectée à la place de `ANALYSIS_PERIOD` pour les chemins ICR / basal / dose fixe (fenêtres passées à `dailyJournal`, `fastingTrend`, `fixedDoseTrend`).

**Point clinique à trancher pour l'ISF** : le chemin ISF s'appuie délibérément sur **30 jours** car les corrections propres (sans glucides confondants) sont rares (validé medical #683). Deux options, à arbitrer avec le medical-domain-validator :

1. **ISF conserve sa fenêtre 30 j** même en run à la demande (le paramètre ne borne que ICR/basal/dose fixe) — cohérent avec la rareté du signal ISF, mais l'utilisateur qui choisit « 4 j » ne s'attend peut-être pas à ce que l'ISF regarde 30 j.
2. **ISF suit la fenêtre choisie**, plafonnée à `windowDays` — plus intuitif, mais sur une fenêtre courte l'ISF ne proposera quasiment jamais rien (trop peu de corrections propres). Fail-closed : pas de risque, mais peu de rendement.

> **DÉCIDÉ — option 1 : l'ISF conserve sa fenêtre 30 j** même en run à la demande (le paramètre `windowDays`
> ne borne que ICR / basal / dose fixe). Raison : le sens du paramètre « fenêtre » est « base d'analyse
> post-prandiale récente » ; l'ISF est un signal structurellement plus lent (corrections propres rares), et
> le raccourcir reviendrait à l'éteindre. **À rendre explicite dans l'UI** (« la fenêtre s'applique aux repas
> et au à-jeun ; l'analyse des corrections reste sur 30 jours ») et dans la JSDoc/le retour d'API.

### Comportement aux bords (et pourquoi c'est correct)

- **2 j avec données minces → très probablement AUCUNE proposition.** Ce n'est **pas une erreur** : c'est le principe fail-closed du moteur. Sous les seuils de suffisance (`MIN_MEALS_PER_SLOT`, `MIN_NADIR_NIGHTS`, `BGM_CARNET.MIN_READINGS_PER_MOMENT`), le générateur `continue` sans produire de dose. Le retour est un **succès** avec `created: 0` et un motif, pas un `400`/`500`.
- **Heure non couverte par la config** : `findSlotForHour` renvoie `undefined`, le moteur ignore le créneau (pas de fallback, jamais de dose sur une heure non configurée).
- **CGM insuffisant** : les tendances sont CGM-only et fail-closed ; un patient BGM pur en `basalBolus` n'obtient pas de proposition ICR de ce chemin (comportement existant, inchangé).

---

## 4. Interaction avec les garde-fous existants

Le chemin à la demande **n'ajoute aucun risque de dose** : c'est **le même moteur, fenêtré**. Tous les garde-fous restent actifs par construction (ils vivent dans `generateForPatient` / `analyze*` / `createEngineProposal`, pas dans l'entrée cron) :

| Garde-fou | Source | Reste actif ? |
|-----------|--------|---------------|
| **Garde hypo** (hypo sévère niveau 2 → supprime toute hausse d'insuline ; hypo légère niveau 1 récurrente → freine) | `analyze*`, `HYPO_LEVEL1_RECURRENCE_MIN` | ✅ identique |
| **Coverage guard Somogyi** (hausse basale seulement si ≥ 3 nuits de nadir CGM) | `MIN_NADIR_NIGHTS` | ✅ identique |
| **Bornes cliniques** (ISF/ICR/basal/dose, cap ± 20 % moteur, snap délivrable) | `CLINICAL_BOUNDS`, `createEngineProposal` (`valueOutOfBounds`) | ✅ identique |
| **Seuils de suffisance de données** (≥ 3 repas/créneau, ≥ 3 relevés/moment, portes qualité pré-repas) | `MIN_MEALS_PER_SLOT`, portes `isMealUsableForIcr` | ✅ identique — **renforcé** par le plancher fenêtre 2 j |
| **Une proposition à la fois** (anti-empilement) | index `one_pending_per_slot` / `duplicatePendingProposal` | ✅ identique — de surcroît, D6 pré-vérifie et alerte |
| **Deadband post-prandial asymétrique** (ne titre pas contre la cible à jeun) | `POSTPRANDIAL_TITRATION_LOW_*`, `getCgmDefaults().ok` | ✅ identique |
| **Frontière MDR** (`nonInsulin` → jamais de dose, flags seuls) | routage mode + `createEngineProposal` (`nonInsulinNoDose`) | ✅ identique |
| **Propose, n'applique jamais** (pending, gaté médecin) | ADR #13 | ✅ identique |

**Conclusion sécurité** : puisque l'unique différence avec le cron est (a) l'acteur d'audit (soignant réel vs système `null`), (b) le périmètre (un patient vs portefeuille) et (c) la fenêtre (choisie vs fixe), **aucune surface de dosage nouvelle n'est ouverte**. Le risque résiduel est celui, déjà accepté, du moteur US-2651.

---

## 5. Contrat d'API (esquisse)

> Esquisse non contractuelle — schémas Zod et forme définitive à figer avec typescript-pro / nextjs-developer.

### Endpoint

```
POST /api/patients/{patientId}/proposals/generate
```

- **Auth** : JWT RS256, **rôle DOCTOR ou NURSE** (`requireRole`), périmètre patient vérifié (portefeuille du soignant).
- **Corps** :

```jsonc
{
  "windowDays": 4   // entier, 2 ≤ windowDays ≤ 14
}
```

- **Validation Zod** :

```ts
z.object({
  windowDays: z.number().int().min(2).max(14),
})
```

Hors bornes (`< 2`, `> 14`, non entier) → **400** `{ error: "windowOutOfBounds" }` (jamais de run silencieux sur une fenêtre invalide).

### Réponses

| Cas | Statut | Corps (sans PHI) |
|-----|--------|------------------|
| Propositions créées | `200` | `{ created, flagged, slotsConsidered, mealsUsable, windowDays }` |
| Rien à proposer (données minces / bon contrôle) | `200` | `{ created: 0, flagged: 0, reason: "nothingToPropose", windowDays }` |
| Une proposition `pending` existe déjà | `409` | `{ error: "proposalAlreadyPending" }` |
| Fenêtre hors [2 ; 14] | `400` | `{ error: "windowOutOfBounds" }` |
| Rôle non autorisé (patient, VIEWER) | `403` | `{ error: "forbidden" }` |
| Patient hors périmètre / soft-deleted | `404` | `{ error: "patientNotFound" }` |

> **Note** : « rien à proposer » est un **succès `200`**, pas une erreur — c'est le résultat clinique attendu quand le signal est insuffisant. Seul l'empilement (`409`) et la fenêtre invalide (`400`) sont des refus.

### Audit

À chaque déclenchement (succès ou « rien à proposer ») :

```ts
await auditService.log({
  userId,                       // soignant réel (≠ null du cron)
  action: "CREATE",
  resource: "ADJUSTMENT_PROPOSAL",
  resourceId: String(patientId),
  ipAddress, userAgent, requestId,
  metadata: { kind: "proposal.generator.on_demand", patientId, windowDays, created, flagged },
})
```

`metadata.patientId` en pivot forensics (convention US-2268).

---

## 6. Critères d'acceptation (Gherkin FR)

```gherkin
Fonctionnalité: Génération de propositions à la demande, sur une période choisie

  Contexte:
    Étant donné un soignant authentifié (médecin ou infirmier)
    Et un patient de son portefeuille en mode "basalBolus" correctement configuré

  Scénario: Fenêtre valide avec signal suffisant → génération
    Étant donné 14 jours de données CGM avec ≥ 3 repas appariés par créneau
    Quand le soignant déclenche une génération avec windowDays = 14
    Alors le moteur analyse les 14 derniers jours
    Et une ou plusieurs propositions "pending" sont créées
    Et la réponse est 200 avec created ≥ 1

  Scénario: Fenêtre sous la borne → rejet 400
    Quand le soignant déclenche une génération avec windowDays = 1
    Alors la requête est rejetée avec 400 "windowOutOfBounds"
    Et aucun run moteur n'est exécuté

  Scénario: Fenêtre au-dessus de la borne → rejet 400
    Quand le soignant déclenche une génération avec windowDays = 21
    Alors la requête est rejetée avec 400 "windowOutOfBounds"

  Scénario: Fenêtre valide mais données trop minces → rien à proposer (pas une erreur)
    Étant donné seulement 2 jours de données avec 1 repas apparié par créneau
    Quand le soignant déclenche une génération avec windowDays = 2
    Alors aucune proposition n'est créée
    Et la réponse est 200 avec created = 0 et reason = "nothingToPropose"

  Scénario: La garde hypo bloque toujours une hausse d'insuline
    Étant donné une hypo sévère (< 0,54 g/L) mesurée sur la fenêtre pour un créneau
    Quand le soignant déclenche une génération sur ce créneau
    Alors aucune proposition augmentant l'insuline n'est créée pour ce créneau

  Scénario: Une proposition pending existe déjà → alerte, pas d'empilement
    Étant donné une proposition "pending" pour ce patient (même paramètre × créneau)
    Quand le soignant déclenche une génération
    Alors la réponse est 409 "proposalAlreadyPending"
    Et aucune seconde proposition n'est créée pour ce couple

  Scénario: Bornes cliniques respectées
    Quand une génération produit une valeur hors [ISF/ICR/basal] bornes ou > ± 20 %
    Alors la proposition est rejetée par createEngineProposal (fail-closed)
    Et aucune proposition hors bornes n'est persistée

  Scénario: Patient non insuliné → flags d'orientation, jamais de dose
    Étant donné un patient en mode "nonInsulin"
    Quand le soignant déclenche une génération
    Alors seuls des ClinicalReviewFlag d'orientation peuvent être levés
    Et aucune proposition de dose n'est créée

  Scénario: Rôle patient interdit
    Étant donné une requête portant un JWT de rôle PATIENT
    Quand elle appelle l'endpoint de génération à la demande
    Alors la réponse est 403 "forbidden"

  Scénario: Chaque déclenchement est audité
    Quand un soignant déclenche une génération (succès ou "rien à proposer")
    Alors un audit "proposal.generator.on_demand" est émis
    Et il porte userId (soignant réel), patientId, windowDays et l'horodatage
```

---

## 7. Hors périmètre

- **Auto-application** d'une proposition générée à la demande — interdit (ADR #13), reste `pending` gaté médecin.
- **Accès patient** à ce déclenchement — hors périmètre (D2).
- **Fenêtres < 2 j ou > 14 j**, fenêtres à dates absolues (`[du … au …]`) — le paramètre est un nombre de jours de lookback borné ; les plages calendaires arbitraires sont une évolution ultérieure.
- **Changement du lookback ISF 30 j** — conservé tel quel (voir §3, à confirmer medical) ; pas de refonte du signal ISF ici.
- **Modification des garde-fous, seuils cliniques ou formules de dose** — US-2658 ne fait que *fenêtrer* et *déclencher* le moteur existant.
- **Génération portefeuille à la demande** (tous les patients d'un coup, en manuel) — hors périmètre ; ce cas reste couvert par le cron nocturne.
- **Report d'adhérence / profilage patient** — reporté en **V3** (voir annexe ci-dessous).

---

## Annexe — Report V3 : check d'adhérence & profilage patient

> **Statut : V3 — NON développé maintenant. Prérequis : captation de données.**
> À suivre en roadmap comme évolution du moteur de génération et intrant du niveau de maturité (US-2657). Cette annexe cadre l'idée et son **coût de faisabilité honnête**, pas une spécification prête à coder.

### L'idée

Lors de la génération, l'algorithme ne se contenterait plus de titrer sur l'issue glycémique : il **vérifierait d'abord si les doses réellement utilisées par le patient correspondent à ses constantes configurées** (ISF / ICR / basal / dose fixe).

- **Doses ≈ config** → le patient applique bien sa prescription → **titration normale** (le comportement actuel du moteur suffit).
- **Doses qui dévient de la config** → le patient s'auto-gère différemment de ce qui est prescrit. On analyserait alors **la dose hors-config et son impact glycémique** (positif : meilleur contrôle ; négatif : hypo/hyper), et on s'en servirait pour **profiler le patient** (style d'auto-gestion : autonome et compétent / dévie au détriment du contrôle / erratique). Ce profil pourrait **informer le niveau de maturité** (US-2657).

### Faisabilité — état réel des données

`BolusCalculationLog` (immutable) stocke aujourd'hui, pour chaque calcul :

- `recommendedDose` — la dose **recommandée** par le moteur ;
- `wasDelivered` (booléen) — le patient a-t-il **suivi la reco ou non** ;
- `isfUsedGl` / `icrUsed` / `inputCarbsGrams` — les constantes et l'entrée du calcul.

**Ce qu'on sait déjà** : « le patient a suivi la reco, oui/non » (`wasDelivered`) et le contexte de calcul (constantes appliquées, glucides saisis).

**Ce qu'on NE sait PAS** : lorsque le patient **dévie**, le **montant réel alternatif injecté** n'est pas capturé côté log de calcul. On sait *qu'il* a dévié, pas *de combien*.

D'où deux versions de la feature, de coût très différent :

| Version | Signal disponible | Prérequis | Ce qu'elle permet |
|---------|-------------------|-----------|-------------------|
| **Version « pauvre » (disponible maintenant)** | `wasDelivered = false` + **issue glycémique** consécutive | Aucun — données déjà présentes | Signal d'**adhérence** (suit / ne suit pas) + **impact** (l'écart a-t-il coïncidé avec un meilleur ou pire contrôle, au niveau tendanciel). |
| **Version « riche » (V3, prérequis captation)** | Comparaison **dose prescrite vs dose réellement délivrée** (montant) | **Prérequis de captation** : logger le montant délivré, **ou** apparier de façon fiable les injections `DiabetesEvent` / `PumpEvent` avec le contexte repas | Analyse fine : de combien le patient dévie, dans quel sens, avec quel effet — base d'un vrai profil quantitatif. |

La version riche exige donc un **travail de captation de données préalable** (soit un champ « dose délivrée » sur le log, soit un appariement robuste injection↔repas via `DiabetesEvent`/`PumpEvent`). Tant que ce prérequis n'est pas livré, seule la version pauvre est réaliste — et elle donne déjà un signal d'adhérence + impact exploitable.

### Branche de décision (cible V3)

1. **Doses ≈ config** → titration normale (moteur actuel).
2. **Déviation + issue positive** → le comportement effectif du patient est meilleur que sa config → **proposer d'aligner la config sur le comportement effectif** (un **nouveau type de proposition** : « votre pratique réelle donne de meilleurs résultats que votre réglage — aligner ? », toujours `pending`, gaté médecin, borné par les mêmes caps).
3. **Déviation + issue négative** → **flag / orientation** (« écarts fréquents au détriment du contrôle — à revoir en consultation »), jamais une dose auto.

L'**attribution d'impact reste au niveau motif/tendance** (agrégat de patterns), **jamais événement par événement** : les confondeurs (activité physique, repas mal estimé, stress, maladie) rendent toute causalité par-injection non fiable.

### Conformité

- Le mot **« profilage »** place la feature sous le régime **RGPD Art. 22** (décision automatisée / profilage) → **DPIA obligatoire** avant tout développement.
- Le profil **informe la décision de maturité du clinicien** (US-2657), il **ne fixe jamais automatiquement** le niveau d'autonomie du patient. Aucune bascule d'autonomie sans acte médecin.
- **Attribution d'impact au niveau pattern** (avec réserve explicite sur les confondeurs), pas de scoring causal par événement.
- Cohérent avec la philosophie du moteur : **le système conseille, il ne remplace pas le jugement clinique**.

### Marquage roadmap

- **Version : V3.**
- **Prérequis bloquant : captation de données** (dose délivrée loggée **ou** appariement injection↔repas fiable) pour la version riche.
- **Disponible sans prérequis** : version pauvre (adhérence via `wasDelivered` + impact tendanciel).
- **Gate conformité : DPIA profilage (Art. 22)** avant implémentation.
- **Consommateur** : niveau de maturité patient (US-2657) — en entrée informative, non décisionnelle.

---

*Les constantes/règles cliniques citées vivent dans `src/lib/clinical-bounds.ts` (source de vérité) et sont cataloguées dans `docs/clinical-logic/regles-et-constantes-diabete.md`. À l'implémentation : ajouter le paramètre `windowDays` et sa borne [2 ; 14] au catalogue, et la nouvelle règle de décision « génération à la demande fenêtrée » à `docs/clinical-logic/algorithme-propositions-ajustement.md`.*
