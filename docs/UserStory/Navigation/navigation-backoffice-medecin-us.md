# Série Navigation Backoffice — Médecin (révisée, **sans IA**)

> **Périmètre :** Diabeo BackOffice (clinique), persona **`DOCTOR`** prioritaire (RBAC pour les autres rôles) — **Format B léger**
> **Support visuel :** `docs/mockups/navigation.html` (maquette autoportante, 4 écrans)
>
> **Baselines référencées (non redéfinies) :**
> `BASELINE-RBAC` (scope serveur par route + relation) · `BASELINE-AUDIT` (`AuditLog` immuable) ·
> `BASELINE-DESIGN` (« Sérénité Active » : teal `#0D9488`, coral `#F97316`, statuts `#10B981/#F59E0B/#EF4444`, **tokens texte `-fg` foncés pour contraste AA**) ·
> `BASELINE-I18N` (FR/AR + RTL) · `BASELINE-CLINICAL-SAFETY` (**aucun calcul clinique côté frontend** ; seuils issus de la **source unique** `clinical-bounds.ts` / `glycemia-thresholds.ts`) · `BASELINE-ENCOUNTER` (modèle `Encounter`, addendum append-only).
>
> **Décisions actées (cette révision) :**
> - **D1** — La home du médecin est une **worklist de tri** (« Ma journée »), pas une simple liste de patients.
> - **D2** — **Palette de commande `Ctrl/Cmd-K`** dans le périmètre de la série (accès n°1 au patient).
> - **D3** — **Facturation & Administration hors sidebar clinique** (espace dédié), pas dans la nav médecin.
> - **D4 — ZÉRO IA sur ces fonctionnalités.** Tout est déterministe : l'ex-« résumé LLM » devient un **tableau de bord calculé serveur** ; l'ex-« compte rendu LLM » devient un **éditeur rédigé par le PS**. Aucune inférence (cloud ou auto-hébergée) dans cette série.
>
> **Modèle de navigation : 2 systèmes** (au lieu de 3) — *global* (sidebar maigre + `Ctrl-K` + worklist) et *patient* (barre de contexte + onglets + mode revue, qui partagent le contexte patient).

---

## US-NAV-BO-001 — Navigation globale (sidebar maigre + transitions)

### 👤 En tant que
PS authentifié (`DOCTOR` / `NURSE` / `VIEWER` / `ADMIN`).

### 🎯 Je veux / Afin de
Une barre latérale persistante et **épurée** pour atteindre les destinations principales sans bruit, et garder l'espace au contenu clinique.

### 📌 Description fonctionnelle
- Sidebar gauche persistante sur toutes les pages, **destinations seulement** : Ma journée · Patients · Agenda · Messagerie · Documents · Analytics · Paramètres.
- Items **filtrés par rôle (RBAC serveur)** — un item non autorisé **n'est pas rendu** (jamais masqué côté client).
- Élément actif mis en évidence (teal `#0D9488`) **+ icône + surbrillance** (jamais la couleur seule).
- Transitions **client-side** (Next.js 16 App Router / RSC) — pas de full reload.
- Sur écran étroit : repli automatique en **drawer** (focus-trap, `Esc` ferme, retour de focus au déclencheur).
- **RTL (AR)** : sidebar et drawer basculent à droite ; iconographie directionnelle (chevrons, retour) inversée.

### 🔒 Items & visibilité par rôle
| Section | DOCTOR | NURSE | VIEWER | ADMIN |
|---|---|---|---|---|
| Ma journée | ✅ | ✅ | ✅ (RO) | — |
| Patients | ✅ | ✅ | ✅ (RO) | selon affectation |
| Agenda | ✅ | ✅ | ✅ (RO) | — |
| Messagerie | ✅ | ✅ | ⚠️ RO | — |
| Documents | ✅ | ✅ | ✅ (RO) | — |
| Analytics | ✅ | ⚠️ restreint | ✅ (RO) | ✅ |
| Paramètres | ✅ | ✅ | ✅ | ✅ |

> **Facturation** et **Administration (utilisateurs, tenant)** ne sont **pas** dans la sidebar clinique (**D3**) — espace dédié, hors périmètre de cette série.

### ✔️ Critères d'acceptation
- Sidebar visible partout ; chaque destination autorisée atteinte en 1 clic.
- État actif distinct (couleur **+** icône **+** surbrillance) ; contenu mis à jour **sans full reload**.
- Item non autorisé absent du DOM (vérifié par rôle).
- Repli auto sous le breakpoint étroit ; drawer accessible clavier (ouverture, `Tab` piégé, `Esc`, retour focus).
- Libellés/icônes FR/AR ; rendu RTL correct (sens, côté, chevrons).
- Cibles : **≥ 24px (AA, desktop)** ; **≥ 44px** en contexte tactile (tablette).

### 🧩 Règles métier
- Le filtrage des items est **serveur** (jamais une simple classe `hidden`).
- La sidebar reste maigre : toute nouvelle entrée doit être une **destination**, pas une action.

---

## US-NAV-BO-002 — Palette de commande & recherche rapide (`Ctrl/Cmd-K`)

### 👤 En tant que
PS authentifié cherchant à atteindre un patient ou une section le plus vite possible.

### 🎯 Je veux / Afin de
Une palette ouvrable au clavier pour **sauter à un patient** (de mon périmètre) ou **à une section** en une action, sans parcourir la hiérarchie.

### 📌 Description fonctionnelle
- Ouverture par `Ctrl/Cmd-K` (et via le champ de recherche du top header).
- Deux familles de résultats : **Patients de mon périmètre** (recherche **scopée serveur**) et **Aller à** (sections autorisées).
- Navigation clavier complète (`↑`/`↓`, `↵` ouvrir, `Esc` fermer), focus géré (retour au déclencheur à la fermeture).
- Résultats patients = **métadonnées non-PII** d'identification (nom d'affichage, âge, pathologie, drapeau d'alerte) — pas de donnée de santé détaillée dans la liste.

### ✔️ Critères d'acceptation
- `Ctrl/Cmd-K` ouvre/ferme la palette partout ; entièrement utilisable au clavier (rôle dialog, focus piégé, `Esc`).
- La recherche patient ne retourne **que le périmètre** du PS (filtrage serveur, jamais client).
- Sélectionner un patient ouvre son dossier ; l'**accès au patient est journalisé** (`AuditLog`) à l'ouverture effective.
- « Aller à » ne propose que des sections autorisées par le rôle.
- FR/AR, RTL correct (alignement, sens de saisie).

### 🧩 Règles métier
- Recherche **scopée serveur** sur le périmètre (équipe / tenant).
- La liste de résultats n'expose **aucune PII de santé** (uniquement identité + drapeau) ; le détail n'est chargé qu'à l'ouverture du dossier (cf. US-005).
- `AuditLog` sur **ouverture de patient**, pas sur la frappe de recherche.

### ⚠️ Points ouverts
- Raccourcis secondaires de type « G puis J » (aller à Ma journée) : périmètre V1 ou V2 ?

---

## US-NAV-BO-003 — « Ma journée » (worklist de tri du médecin)

### 👤 En tant que
`DOCTOR` (déclinaison `NURSE` selon périmètre) au début ou au cours de sa journée.

### 🎯 Je veux / Afin de
Une **file de tri** qui me montre d'emblée qui a besoin de moi, pour prioriser sans ouvrir les dossiers un par un.

### 📌 Description fonctionnelle
Page d'accueil = sections de tri, chacune **calculée serveur, déterministe** :
1. **Alertes glycémiques** (hypo &lt;54 / hyper &gt;250 / TIR bas) — drapeaux issus de la **source unique de seuils**.
2. **Propositions d'ajustement en attente** (workflow `AdjustmentProposal`).
3. **Rendez-vous du jour**.
4. **Relances en attente** (silence saisie, RDV non confirmé, jamais synchronisé).
5. **Messages non lus** (périmètre HDS).
- Chaque ligne → ouverture du patient/contexte en 1 clic.
- Statuts via les **tokens feedback** (`-fg` foncés, contraste AA) ; jamais la couleur seule (chip + libellé).

### ✔️ Critères d'acceptation
- Home du médecin = worklist (pas une liste brute) ; chaque section affiche un compteur.
- Tous les drapeaux/seuils proviennent du **serveur** et de la **source unique** (`clinical-bounds.ts` / `glycemia-thresholds.ts`) — aucun calcul front.
- Chaque item ouvre le bon contexte (dossier / proposition / RDV / message) en 1 clic, avec audit d'accès si donnée de santé.
- Sections vides → état vide explicite (pas d'erreur).
- FR/AR + RTL ; contraste AA des statuts vérifié.

### 🧩 Règles métier
- Périmètre **serveur** uniquement (patients de l'équipe / tenant).
- **Aucune IA** : tri, drapeaux et compteurs sont déterministes.
- Les seuils d'alerte sont **versionnés** (traçabilité de la règle ayant produit le drapeau).

### ⚠️ Points ouverts
- Personnalisation de l'ordre des sections par PS : V1 (fixe) ou V2 (configurable) ?

---

## US-NAV-BO-004 — Barre de contexte patient & switcher

### 👤 En tant que
PS ayant ouvert un dossier patient.

### 🎯 Je veux / Afin de
Garder le **contexte patient** visible en permanence et **changer de patient** sans repasser par la liste, pour fluidifier les allers-retours.

### 📌 Description fonctionnelle
- Barre persistante en haut du contexte patient : **identité** (nom, âge, pathologie, drapeaux d'alerte), **fil d'Ariane**, **retour** (Ma journée / liste), **actions rapides** (Nouvelle consultation, Message).
- **Switcher patient** : récemment vus / épinglés (toujours **scopé serveur**).
- Partagée par le dossier (onglets) **et** le mode revue → évite un 3ᵉ système de nav.

### ✔️ Critères d'acceptation
- Le contexte patient (identité + drapeaux) reste visible sur tous les onglets et en mode revue.
- Le switcher ne propose que des patients du **périmètre** ; changer de patient journalise l'accès au nouveau patient.
- « Nouvelle consultation » ouvre/reprend un `Encounter` (cf. US-006).
- Drapeaux d'alerte cohérents avec « Ma journée » (même source serveur).
- FR/AR + RTL (ordre identité, sens du fil d'Ariane, position du switcher).

### 🧩 Règles métier
- Le switcher et le « récemment vus » sont **scopés serveur** ; aucune fuite hors périmètre.
- L'identité affichée est de la PII : déchiffrement **serveur**, accès **audité**.

---

## US-NAV-BO-005 — Navigation interne du dossier patient (onglets-routes)

### 👤 En tant que
PS consultant la fiche d'un patient de son périmètre.

### 🎯 Je veux / Afin de
Naviguer entre les sections du dossier via des **onglets** deep-linkables, pour atteindre vite la donnée pertinente et partager/retrouver une vue précise.

### 📌 Description fonctionnelle
Onglets : **Glycémie · Traitement · Dispositifs · Mode de vie · Documents · Historique · Messages**.
- Onglets **sticky** au scroll, **implémentés comme des routes** (segments d'URL) → deep-link + `back`/`forward` cohérents.
- Chargement **paresseux par onglet** via API sécurisée ; **déchiffrement PII serveur**.
- Skeletons au chargement ; état actif `aria-current="page"`.

### ✔️ Critères d'acceptation
- Onglets accessibles **au clavier** (`Tab`/`Entrée` primaire, `aria-current`, focus visible) ; le comportement `back`/`forward` = historique d'onglets (pas de conflit avec un modèle `tablist` à flèches).
- Onglet actif mis en évidence ; données chargées dynamiquement avec skeleton (`aria-busy`).
- Onglets restent visibles en scrollant.
- **Audit au niveau donnée** : l'`AuditLog` se déclenche à l'**accès à la PII déchiffrée côté API**, **pas** au simple rendu d'onglet → pas de double-log sur `back`/`forward`, pas de sur-audit.
- `VIEWER` : tous les onglets en **lecture seule**.
- FR/AR + RTL (ordre/sens des onglets, sticky).

### 🧩 Règles métier
- Données sensibles via API sécurisée ; **aucune statistique clinique calculée côté frontend** (TIR, moyennes, CV, GMI → projection serveur).
- **Préchargement = métadonnées non-PII uniquement** ; la PII reste **lazy + auditée** (respect de la minimisation).
- **Glycémie** : courbes + stats issues de CGM/relevés (pré-calculé serveur).
- **Documents** : pipeline upload/extraction PDF (MinIO) ; **Messages** : messagerie périmètre HDS.
- **Historique** : présentation **append-only** (addendum, jamais de modification du contenu finalisé).

### ⚠️ Points ouverts
- **Onglet Historique** — seuil de « changement cliniquement significatif » : ce qui crée une entrée d'historique vs une simple mise à jour (question d'historisation RGPD). À cadrer avec `medical-domain-validator`.

---

## US-NAV-BO-006 — Mode revue de consultation (**sans IA**)

### 👤 En tant que
`DOCTOR` en consultation (accès `NURSE` selon type d'entretien — à valider).

### 🎯 Je veux / Afin de
Un mode « revue » structuré en étapes pour analyser la situation et décider en sécurité — **entièrement déterministe**.

### 📌 Description fonctionnelle
Vue focalisée du dossier (réutilise la barre de contexte patient), menu d'étapes vertical :
1. **Résumé (données)** — **tableau de bord calculé serveur** : TIR, moyenne, CV, GMI, **points d'alerte** (seuils versionnés), derniers changements. *Aucune prose générée, aucune IA.*
2. **Analyse glycémie** · 3. **Analyse traitement** · 4. **Mode de vie** — vues des onglets existants.
5. **Décisions médicales** — **workflow `AdjustmentProposal` existant** (proposition d'ajustement bolus **calcul déterministe backend**, bornes de sécurité, aperçu d'audit, **validation PS**).
6. **Compte rendu** — **éditeur structuré rédigé par le médecin** (gabarits de champs ; valeurs déterministes **insérées** automatiquement, jamais générées), enregistré en **addendum immuable** référençant la **version des données**.

- Ouverture depuis la fiche patient ; retour fiche en 1 clic.
- **Navigation libre** entre étapes, ordre logique conservé ; « Décisions » et « Compte rendu » en **soft-gating** (accessibles, mais signalent de revoir les étapes amont).
- Données **préchargées** (projection, **métadonnées non-PII**) pour limiter la latence.

### ✔️ Critères d'acceptation
- Étape active mise en évidence (`aria-current="step"`) ; passage d'étape **sans rechargement**.
- L'ouverture du mode **crée ou reprend** un `Encounter` et journalise dans `AuditLog`.
- L'étape 1 n'affiche que des valeurs **calculées serveur** (vérifiable : aucune stat calculée front).
- L'étape 5 réutilise le workflow d'ajustement existant (proposition → bornes → validation/refus PS).
- Le compte rendu peut être **enregistré en addendum immuable** et **référence la version des données** sur laquelle il s'appuie.
- **Aucun appel d'inférence** (cloud ou auto-hébergé) dans tout le mode.
- FR/AR + RTL (sens du stepper, soft-gating).

### 🧩 Règles métier — sécurité clinique (critique)
- **Aucune IA dans cette série** (décision **D4**). Toute valeur clinique vient du **graphe d'orchestration déterministe** backend.
- Décisions médicales = workflow de **proposition d'ajustement bolus** existant (bornes `clinical-bounds.ts` + aperçu d'audit + acceptation explicite PS).
- Étapes navigables librement, mais « Décisions » et « Compte rendu » **consomment** les étapes amont (soft-gating, non bloquant).
- Le compte rendu finalisé est **append-only** (addendum) ; jamais de modification rétroactive.

### ⚠️ Points ouverts
1. **Frontière `Encounter`** — création (`encounterId` obligatoire) vs reprise d'un entretien ouvert (nullable) ; comportement en cas de **timeout de session HDS** au milieu d'une revue (brouillon persistant ?). Bloque l'historisation.
2. **Revue `NURSE`** — types autorisés (éducation/suivi) vs réservés `DOCTOR` (décision thérapeutique). → validation médecin.
3. **Gabarits de compte rendu** — jeu de gabarits V1 (générique) vs par type de consultation.

---

## 🔗 Dépendances transverses
Projections de lecture (constantes, stats glycémiques) · **source unique de seuils** (`clinical-bounds.ts` / `glycemia-thresholds.ts`) · modèle `Encounter` + addendum · workflow `AdjustmentProposal` · pipeline documents (MinIO) · messagerie HDS · composants nav existants (`Sidebar`, `NavigationShell`) · baselines listées en tête.

## 🧭 Synthèse des écarts vs la proposition initiale
- **3 systèmes de nav → 2** (l'« entretien » devient une vue partageant le contexte patient).
- **Ajout** : worklist « Ma journée » (US-003) + palette `Ctrl-K` (US-002) + barre de contexte/switcher (US-004).
- **Suppression de l'IA** : ex-étapes LLM (résumé, compte rendu) → déterministes.
- **Audit** déplacé au niveau **donnée** (API), pas au rendu d'onglet ; **préchargement** limité aux métadonnées non-PII.
- **Facturation/Administration** sorties de la nav clinique.

---

# Sous-série « Gestion cabinet » (accès administratif)

> **Modèle d'accès — 2 axes indépendants** (porté par le `User`, scopé organisation) :
> - **Q1 — Capacité clinique** (voir les **données de santé**, Art. 9 RGPD) : `DOCTOR`/`NURSE`/`VIEWER`. **Gated sur la qualité de PS vérifiée (RPPS/ADELI)** ; **jamais auto-octroyable** par un admin.
> - **Q2 — Capacité de gestion cabinet** (gérer **droits d'équipe + facturation/paiements**) : **grant administratif org-scopé**. **N'ouvre AUCUN accès aux données de santé.**
>
> Une personne cumule, ou non, les deux axes. Personas de référence :
> | Persona | Q1 (santé) | Q2 (gestion) |
> |---|---|---|
> | Médecin libéral (solo) | ✅ | ✅ |
> | Secrétaire médicale | ❌ | ✅ |
> | Médecin salarié | ✅ | ❌ |
> | Gestionnaire de cabinet (non-soignant) | ❌ | ✅ |
>
> **Classes de données** : la gestion donne accès à la **PII administrative** (identité, coordonnées, ligne de facturation) **sans** les **données de santé** (glycémie, traitement). La facturation FR étant per-patient, la secrétaire voit l'**identité** du patient pour facturer, jamais son dossier clinique.
>
> ⚠️ **Dépendance bloquante** : ces 2 US présupposent le **modèle de capacités Q1/Q2 org-scopé** (à spécifier dans une US d'accès dédiée — `US-ACCESS-xxx`) : grant administratif, scope (cabinet / équipe), gating RPPS, non-auto-élévation, audit des octrois. Sans lui, la nav de gestion n'a rien à filtrer.
>
> **Roadmap : Variante A (US-NAV-BO-007) en V1 · Variante B (US-NAV-BO-008) en V3.**

---

## US-NAV-BO-007 — Bloc « Gestion cabinet » dans la sidebar (**Variante A — V1**)

### 👤 En tant que
`User` ayant la **capacité de gestion cabinet** (Q2 = true) — médecin libéral, secrétaire médicale, gestionnaire non-soignant.

### 🎯 Je veux / Afin de
Retrouver les fonctions de gestion (équipe/droits, facturation, paiements, paramètres cabinet) dans **un bloc dédié de la sidebar**, séparé du soin, pour administrer mon cabinet sans me perdre.

### 📌 Description fonctionnelle
- La sidebar se compose de **deux blocs indépendants**, chacun affiché selon sa capacité :
  - **Bloc clinique** (si **Q1**) : Ma journée, Patients, Agenda, Messagerie, Documents, Analytics (cf. US-NAV-BO-001).
  - **Bloc gestion** (si **Q2**), sous un séparateur **« — GESTION — »** : Gestion de l'équipe & droits · Facturation · Paiements · Paramètres du cabinet.
- L'utilisateur voit **l'union de ses blocs autorisés** ; un bloc non autorisé **n'est pas rendu** (DOM, pas CSS).
- Cas mono-capacité gérés nativement : secrétaire (Q2 seul) ne voit **que** le bloc gestion ; médecin salarié (Q1 seul) ne voit **que** le bloc clinique.
- Bloc gestion **groupé et isolé** dès la V1 (prépare la bascule B sans refonte).
- FR/AR + RTL (séparateur, ordre, côté).

### 🔒 Items du bloc gestion par capacité
| Item | Q2 (gestion) | Donnée manipulée |
|---|---|---|
| Gestion de l'équipe & droits | ✅ | comptes/membres, grants (PII admin) |
| Facturation | ✅ | factures, identité patient (PII admin) — **pas** de donnée de santé |
| Paiements | ✅ | données financières |
| Paramètres du cabinet | ✅ | config établissement/service |

### ✔️ Critères d'acceptation
- Bloc gestion rendu **si et seulement si Q2 = true** (vérifié serveur ; absent du DOM sinon).
- Bloc clinique rendu **si et seulement si Q1 = true** — secrétaire (Q2 seul) : aucun item clinique, **aucun accès dossier patient**.
- Les items de gestion **n'exposent aucune donnée de santé** ; la facturation n'affiche que l'**identité** patient nécessaire.
- Séparateur « — GESTION — » visible quand le bloc est présent ; états actif/hover conformes design (couleur **+** icône **+** surbrillance).
- FR/AR + RTL corrects.
- Repli drawer (cf. US-001) couvre aussi le bloc gestion.

### 🧩 Règles métier
- **2 axes orthogonaux** : afficher le bloc gestion dépend **uniquement** de Q2, jamais du rôle clinique.
- Filtrage **serveur** (jamais `hidden` côté client).
- **Aucune élévation** : la présence du bloc gestion ne donne **jamais** accès aux données de santé ; l'accès clinique reste gated RPPS.
- **Audit** (BASELINE-AUDIT) : toute action de gestion sensible (octroi/révocation de droit, accès facture/paiement) est journalisée.
- Données **financières ≠ données de santé** : régime et écran distincts.

### ⚠️ Points ouverts
- Sous-périmètre des grants en gestion (qui peut octroyer quoi, à qui) → relève de l'US d'accès `US-ACCESS-xxx`.

---

## US-NAV-BO-008 — Bascule « Mode soin ⇄ Mode gestion » (**Variante B — V3**)

### 👤 En tant que
`User` **à double casquette** (Q1 **et** Q2 = true) — typiquement le **médecin libéral**.

### 🎯 Je veux / Afin de
Basculer entre un **espace Soin** et un **espace Gestion**, chacun avec sa navigation focalisée, pour séparer nettement mes deux casquettes et réduire la charge mentale.

### 📌 Description fonctionnelle
- **Bascule « Mode soin ⇄ Mode gestion »** (en tête de sidebar) :
  - **Affichée uniquement si Q1 ET Q2** (double casquette).
  - **Mono-capacité → pas de bascule** : entrée directe dans l'unique espace (secrétaire → Gestion ; salarié → Soin).
- Chaque mode = une **nav focalisée** (groupes de routes `(soin)` / `(gestion)`), séparation visuelle soin (clinique) / gestion (finance).
- **Mode courant mémorisé** ; **deep-link par espace** ; `back/forward` cohérents au sein d'un mode.
- Surcouche **non destructive** au-dessus de la Variante A (blocs déjà isolés en V1).
- FR/AR + RTL (position de la bascule, sens).

### ✔️ Critères d'acceptation
- La bascule n'apparaît **que** pour les profils double-casquette ; mono-capacité : aucun toggle, atterrissage direct dans le bon espace.
- Basculer change l'espace de nav **sans full reload** ; le mode est **persistant** (retour ultérieur dans le même mode) et **deep-linkable**.
- Le **Mode gestion n'expose aucune donnée de santé** ; le **Mode soin** garde le périmètre clinique (US-001 à 006).
- `back/forward` cohérents dans un mode ; RTL correct.
- Audit inchangé (les actions sensibles restent journalisées quel que soit le mode).

### 🧩 Règles métier
- **Mêmes 2 axes** que la Variante A ; B est une **surcouche de présentation**, pas un nouveau modèle de droits.
- Séparation visuelle **données de santé / données financières** matérialisée par les deux modes.
- A reste la base : si B est désactivé, l'app retombe sur A (blocs dans une sidebar unique).

### ⚠️ Points ouverts
- Persistance du mode : par session, par appareil, ou préférence serveur ?
- Comportement d'un **deep-link Soin** reçu alors que l'utilisateur était en mode Gestion (et inversement).

### 🗺️ Roadmap
- **V1** : Variante A (US-NAV-BO-007) — coût minimal, blocs isolés.
- **V3** : Variante B (US-NAV-BO-008) — bascule + routing par mode, par-dessus A.
