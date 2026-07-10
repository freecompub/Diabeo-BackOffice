# US-2656 — La fenêtre d'édition « tous les créneaux » (modale groupe)

> 📌 Sous-US de [US-2654](US-2654-EPIC-edition-creneaux-autonomie-graduee.md) · **front** (composant + interactions) · Taille **L**
> · **Version : V1**
>
> **Statut** : 🟡 spécifiée — **aucun code avant validation.**
> **Dépend de** : US-2655 (endpoint serveur de remplacement groupé), US-2657 (attribut maturité patient — capacité reçue en entrée).
> **Portée** : interface de la modale uniquement — pas l'endpoint (US-2655), pas la maturité (US-2657), pas la génération (US-2658).

---

## 1. Intention (voix produit)

**Côté médecin**
> « Aujourd'hui je peux corriger la *valeur* d'un créneau, mais je ne peux ni décaler ses *horaires*, ni ajouter un créneau, ni restructurer la journée. Je veux une vue unique où je vois **toute la grille horaire** d'un paramètre (facteur de sensibilité, ratio glucides/insuline…), où je réorganise librement les tranches, et où le système **m'empêche d'enregistrer une journée incohérente** (trou ou chevauchement). Je valide, c'est appliqué immédiatement. »

**Côté patient**
> « Je veux revoir mes réglages sur une seule fenêtre, changer une valeur — et si mon profil le permet, décaler mes tranches horaires — sans risquer de créer un moment de la journée "non couvert". Quand je valide, ma soignante reçoit une **proposition** qu'elle relira ; je vois clairement que c'est une proposition et non un changement immédiat. »

**Le fil rouge** : une seule fenêtre montre l'intégralité des créneaux d'un paramètre, garantit qu'ils **couvrent 24 h sans trou ni chevauchement**, et adapte ce qui est modifiable selon le rôle et la maturité de l'utilisateur. La cohérence n'est pas un contrôle *a posteriori* : elle **conditionne le bouton Valider**.

---

## 2. Décisions UX actées

| # | Décision | Justification |
|---|----------|---------------|
| D1 | **Une modale unique** affiche *tous* les créneaux d'un paramètre (facteur de sensibilité / ratio glucides-insuline, plus tard basale pompe). | Impossible de restructurer une journée en éditant les lignes une par une. |
| D2 | Actions offertes : **modifier valeur**, **modifier tranche horaire** (heure de début / de fin), **ajouter une ligne**, **supprimer une ligne**. | Couvre la restructuration complète. |
| D3 | Deux boutons : **Annuler** et **Valider**. | Modèle transactionnel : rien n'est écrit tant que Valider n'est pas actionné. |
| D4 | **Valider est désactivé tant que l'ensemble n'est pas cohérent** (aucun trou, aucun chevauchement sur 24 h). | Fail-closed : un trou de couverture rend le calcul de bolus impossible sur cette heure. |
| D5 | Les lignes **en conflit** (trou / chevauchement) sont **mises en évidence** ; le trou est **nommé** (« trou 10 h–12 h »). | L'utilisateur doit savoir *où* et *pourquoi* corriger, pas seulement que « c'est faux ». |
| D6 | Cohérence calculée **au front** (feedback instantané) mais **re-validée serveur** (autorité). La modale gère un **rejet serveur** proprement. | Le front est une commodité UX, jamais la source de vérité clinique. |
| D7 | L'enregistrement est un **remplacement groupé** (tous les créneaux d'un coup), pas ligne par ligne. | Cohérence atomique : la grille ne transite jamais par un état intermédiaire incohérent en base. |
| D8 | Capacités **conditionnées au rôle + maturité** : DOCTEUR = édition directe immédiate ; INFIRMIÈRE / PATIENT = **proposition**. Patient débutant = valeurs seulement (horaires / ajout / suppression désactivés) ; intermédiaire et + = restructuration complète. | Sécurité patient graduée. |
| D9 | Si une **proposition est déjà en cours** pour ce patient : ouverture / soumission bloquées avec « une proposition est déjà en cours ». | Une seule proposition ouverte à la fois évite les révisions concurrentes contradictoires. |
| D10 | Couverture 24 h **matérialisée visuellement** (bandeau / frise de 0 h à 24 h). | Rend le trou/chevauchement immédiatement lisible, au-delà du tableau. |
| D11 | 100 % design system « Sérénité Active » : classes sémantiques (`bg-primary`, `text-destructive`, `border-border`…) et `tokens.*` pour toute frise SVG. Aucun hex, aucun Tailwind brut. | Règle non négociable du dépôt. |

---

## 3. Anatomie de la fenêtre

### Structure (en mots)

- **Conteneur** : `Dialog` shadcn/ui (`role="dialog"`, `aria-modal="true"`), largeur confortable desktop (`max-w-2xl`), fond `bg-card`, bordure `border-border`, ombre `shadow-diabeo-lg`, `rounded-xl`.
- **En-tête (`DialogHeader`)** : titre nommant le paramètre — ex. « Modifier tous les créneaux — Facteur de sensibilité (ISF) » (acronyme via `<Acronym code="ISF" />`, jamais nu). Sous-titre discret `text-muted-foreground` rappelant le contexte (patient, mode direct ou proposition).
- **Bandeau de rôle/mode** (conditionnel) : pour un profil « proposition », `Alert` en `bg-feedback-info-bg` / `text-feedback-info` : « Vos modifications créeront une proposition à valider par un soignant. »
- **Frise de couverture 24 h** (D10) : bande horizontale de 0 h à 24 h, chaque créneau = un segment coloré `bg-primary/15` bordé `border-primary/40`. Les zones **non couvertes** apparaissent en `bg-destructive/15` hachurées ; les **chevauchements** en `bg-secondary/20` (corail) avec liseré `border-secondary`. Rendu SVG → couleurs via `tokens.brand.primary[…]`, `tokens.*` corail, jamais de hex. La frise n'est **pas le seul signal** (cf. accessibilité).
- **Tableau des créneaux** : une ligne par créneau, colonnes :
  - **Tranche horaire** : deux champs heure (début / fin), format `HH:MM`. Passage minuit autorisé (ex. 22 h → 06 h).
  - **Valeur** : champ numérique + unité affichée (`text-muted-foreground`), ex. `g/L par U` ou `g/U`.
  - **Supprimer** : bouton icône `variant="ghost"`, `aria-label="Supprimer le créneau HH:MM–HH:MM"`.
  - Une ligne en conflit reçoit `bg-destructive/10 border-l-4 border-destructive` (trou attenant) ou `bg-secondary/10 border-l-4 border-secondary` (chevauchement) + une icône `AlertTriangle` + texte associé.
- **Affordance « Ajouter une ligne »** : bouton `variant="outline"` pleine largeur sous le tableau, icône `Plus`, libellé « Ajouter un créneau ». Désactivé si la maturité l'interdit (avec tooltip explicatif).
- **Bandeau de cohérence inline** (statut vivant) : sous le tableau, une zone `role="status"` qui reflète l'état :
  - Cohérent → `bg-feedback-success-bg text-feedback-success` : « Couverture complète sur 24 h. »
  - Trou → `bg-destructive/10 text-destructive` : « Trou de couverture 10 h–12 h : aucune valeur ne s'applique. »
  - Chevauchement → `bg-secondary/10 text-secondary` (corail) : « Chevauchement 08 h–09 h entre deux créneaux. »
- **Pied (`DialogFooter`)** : à droite **Annuler** (`variant="outline"`) et **Valider** (`variant="default"`, `bg-primary`). Valider porte `aria-disabled` + `disabled` tant que l'ensemble est incohérent, hors bornes, ou qu'une proposition est déjà en cours.

### Wireframe ASCII

```
┌───────────────────────────────────────────────────────────────┐
│  Modifier tous les créneaux — Facteur de sensibilité (ISF)  [x]│
│  Patient : Mme D.  ·  Mode : proposition (relue par un soignant)│
├───────────────────────────────────────────────────────────────┤
│  ⓘ Vos modifications créeront une proposition à valider.       │  ← bandeau mode (si proposition)
├───────────────────────────────────────────────────────────────┤
│  Couverture 24 h                                               │
│  0h        6h        12h       18h        24h                  │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░▒▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                   │
│  ▓ couvert   ░ trou 10h–12h   ▒ chevauchement                  │
├───────────────────────────────────────────────────────────────┤
│  Tranche horaire     │ Valeur (g/L par U) │            │       │
│  ─────────────────── │ ────────────────── │ ────────── │       │
│  [00:00]–[06:00]     │ [ 0,45 ]           │   [🗑]      │       │
│  [06:00]–[10:00]     │ [ 0,30 ]           │   [🗑]      │       │
│ ⚠[12:00]–[18:00]     │ [ 0,35 ]           │   [🗑]      │ ← trou 10h–12h avant cette ligne
│  [18:00]–[24:00]     │ [ 0,50 ]           │   [🗑]      │       │
│                                                               │
│  [ +  Ajouter un créneau ]                                    │
├───────────────────────────────────────────────────────────────┤
│  ⚠ Trou de couverture 10 h–12 h : aucune valeur ne s'applique.│  ← bandeau cohérence (role=status)
├───────────────────────────────────────────────────────────────┤
│                                   [ Annuler ]  [ Valider ⛔ ]  │  ← Valider désactivé (trou)
└───────────────────────────────────────────────────────────────┘
```

---

## 4. États & feedback

| État | Ce que voit l'utilisateur | Frise / bandeau | Valider |
|------|---------------------------|-----------------|:------:|
| **Cohérent** | Tableau normal, aucune ligne surlignée. Bandeau succès « Couverture complète sur 24 h ». | Frise 100 % `bg-primary/15`. | **Activé** |
| **Trou** (ex. « trou 10 h–12 h ») | Segment non couvert nommé ; les deux lignes bordant le trou reçoivent `border-l-4 border-destructive` + icône. Bandeau `text-destructive`. | Zone `bg-destructive/15` hachurée. | **Désactivé** (raison annoncée) |
| **Chevauchement** (ex. « 08 h–09 h ») | Les lignes qui se recouvrent surlignées `bg-secondary/10 border-l-4 border-secondary` + icône ; bandeau corail nommant la fenêtre. | Zone `bg-secondary/20`. | **Désactivé** (raison annoncée) |
| **Valeur hors bornes cliniques** | Le champ concerné passe en `border-destructive`, message inline associé (`aria-describedby`) : « Valeur hors bornes : ISF entre 0,10 et 1,00 g/L par U. » (bornes = source `clinical-bounds.ts`). | Frise inchangée (couverture ok), bandeau valeur en erreur. | **Désactivé** |
| **Proposition déjà en cours** | À l'ouverture : `Alert` `bg-feedback-warning-bg text-feedback-warning` « Une proposition est déjà en cours pour ce patient. » Champs en lecture seule ou modale en mode consultation. | — | **Désactivé** (masqué / bloqué) |
| **Rejet serveur après soumission** | Après clic sur Valider : la modale **reste ouverte**, réaffiche l'état saisi, et montre un `Alert` `bg-destructive/10 text-destructive` : « Le serveur a refusé l'enregistrement : {raison}. Corrigez et réessayez. » Les lignes/champs mis en cause (si le serveur les précise) sont re-surlignés. Aucune donnée locale perdue. | Selon la raison renvoyée. | **Réactivé** une fois corrigé |
| **Enregistrement en cours** | Valider affiche un spinner + libellé « Enregistrement… », champs et Annuler désactivés, `aria-busy="true"` sur le dialog. | Gelée. | **Désactivé** (occupé) |
| **Succès (mode direct)** | Toast succès `bg-feedback-success` « Créneaux mis à jour. » Modale se ferme, grille rafraîchie. | — | — |
| **Succès (mode proposition)** | Toast `bg-feedback-info` « Proposition envoyée, en attente de validation. » Modale se ferme ; la grille sous-jacente **n'est pas** modifiée (proposition en attente). | — | — |

> **Règle transversale** : `Valider` n'est activé que si **(couverture 24 h complète) ET (aucun chevauchement) ET (toutes valeurs dans les bornes) ET (aucune proposition déjà en cours) ET (au moins une modification)**.

---

## 5. Capacités par rôle & maturité

| Profil | Modifier valeur | Modifier horaires | Ajouter | Supprimer | Effet du Valider | Alerte « proposition en cours » |
|--------|:---:|:---:|:---:|:---:|------------------|--------------------------------|
| **DOCTEUR** | ✅ | ✅ | ✅ | ✅ | **Immédiat** (remplacement groupé appliqué) | S'applique aussi : bloque si une proposition patient est ouverte (le médecin la traite via le flux de revue, pas via cette modale) |
| **INFIRMIÈRE** | ✅ | ✅ | ✅ | ✅ | **Proposition** (statut *pending*) | Oui |
| **PATIENT — débutant (junior)** | ✅ | ❌ (désactivé + tooltip) | ❌ | ❌ | **Proposition** | Oui |
| **PATIENT — intermédiaire** | ✅ | ✅ | ✅ | ✅ | **Proposition** | Oui |
| **PATIENT — expert** | ✅ | ✅ | ✅ | ✅ | **Proposition** (auto-application retirée — US-2657, cf. ADR #28) | Oui |

**Détails d'affichage**
- **Champs désactivés (junior)** : heures et bouton supprimer en `disabled` + `text-muted-foreground` ; « Ajouter un créneau » `disabled` avec `Tooltip` : « La modification des horaires nécessite un niveau d'autonomie supérieur. Contactez votre soignant. »
- **Bandeau de mode** : visible pour tout profil « proposition » (en-tête, `bg-feedback-info-bg`), absent pour le DOCTEUR (mode direct).
- **Alerte « proposition en cours »** : rendue **en tête de modale** dès l'ouverture (bloque l'édition), **et** re-vérifiée à la soumission (le serveur reste l'autorité — cf. D6/D9). Si elle apparaît à la soumission alors que l'ouverture était permise (course), on retombe sur l'état « rejet serveur » avec le message dédié.
- La **détermination du rôle/maturité** est fournie en entrée du composant (attribut maturité = US-2657) ; la modale ne décide pas de la maturité, elle **réagit** à la capacité reçue.

---

## 6. Accessibilité (WCAG 2.1 AA / ARIA)

- **Piège de focus** : `Dialog` shadcn/ui gère le focus trap ; focus initial sur le premier champ éditable (ou sur l'alerte bloquante si proposition en cours). `Échap` = Annuler (avec garde si modifications non enregistrées : confirmation). Fermeture rend le focus au bouton déclencheur.
- **Navigation clavier complète** : `Tab`/`Maj+Tab` parcourent champs → supprimer → ajouter → Annuler → Valider dans l'ordre visuel. Ajouter/supprimer une ligne est actionnable au clavier ; après suppression, le focus se déplace vers la ligne suivante (ou « Ajouter » si dernière).
- **Valider désactivé annoncé avec sa raison** : le bouton porte `aria-describedby` pointant vers le bandeau de cohérence (`id="coherence-status"`, `role="status"`, `aria-live="polite"`). Ainsi un lecteur d'écran énonce « Valider, indisponible — Trou de couverture 10 h–12 h ». Ne **pas** rendre le bouton non focalisable : utiliser `aria-disabled="true"` + gestion du clic inopérant, afin que la raison reste lisible au clavier.
- **Association des erreurs** : chaque champ hors bornes → `aria-invalid="true"` + `aria-describedby` vers son message inline. Le message nomme la borne clinique concernée.
- **Couleur jamais seul signal** : tout conflit combine **couleur + icône** (`AlertTriangle`) + **texte** (« trou 10 h–12 h », « chevauchement 08 h–09 h ») + `border-l-4`. La frise 24 h ajoute un **motif** (hachures) aux zones en trou/chevauchement, pas seulement une teinte. Contrastes texte ≥ 4.5:1 (tokens `text-destructive`, `text-feedback-*` validés design system).
- **Statut vivant** : les changements d'état de cohérence sont annoncés via `aria-live="polite"` ; l'état « enregistrement » via `aria-busy="true"` sur le dialog ; le succès/échec via toast `role="status"`/`role="alert"`.
- **Cibles tactiles** : boutons supprimer/ajouter ≥ 44×44 px.
- **Reduced motion** : `@media (prefers-reduced-motion: reduce)` → suppression des transitions d'ouverture/fermeture et des animations de surlignage ; le feedback reste porté par la couleur, l'icône et le texte (jamais par la seule animation).
- **Libellés d'entête de tableau** liés aux champs (`<th scope="col">`), et chaque bouton supprimer nommé par sa tranche horaire.

---

## 7. Critères d'acceptation (Gherkin FR)

```gherkin
Fonctionnalité: Fenêtre d'édition « tous les créneaux » (modale groupe)

  Contexte:
    Étant donné une modale ouverte affichant tous les créneaux d'un
      paramètre d'insulinothérapie (facteur de sensibilité (ISF))
    Et une grille initiale cohérente couvrant 0 h à 24 h sans trou ni chevauchement

  Scénario: Valider désactivé en présence d'un trou de couverture
    Étant donné que je supprime le créneau couvrant 10 h–12 h
    Quand la grille ne couvre plus la tranche 10 h–12 h
    Alors le bandeau de cohérence affiche « Trou de couverture 10 h–12 h »
    Et le bouton Valider est désactivé
    Et la raison est associée au bouton Valider pour les lecteurs d'écran

  Scénario: Valider désactivé en présence d'un chevauchement
    Étant donné deux créneaux dont les tranches se recouvrent sur 08 h–09 h
    Quand la grille contient ce chevauchement
    Alors le bandeau affiche « Chevauchement 08 h–09 h »
    Et le bouton Valider est désactivé

  Scénario: Mise en évidence des lignes en conflit
    Étant donné un trou entre deux créneaux
    Quand la modale détecte l'incohérence
    Alors les lignes bordant le trou sont surlignées avec une icône d'alerte
    Et la frise 24 h montre la zone non couverte de façon distincte de la couleur seule

  Scénario: Ajouter une ligne rétablit la cohérence
    Étant donné un trou de couverture 10 h–12 h
    Quand j'ajoute un créneau 10 h–12 h avec une valeur valide
    Alors la grille couvre à nouveau 24 h sans trou ni chevauchement
    Et le bouton Valider devient activé

  Scénario: Supprimer une ligne recalcule la cohérence
    Étant donné une grille cohérente
    Quand je supprime un créneau interne
    Alors un trou apparaît et est nommé dans le bandeau de cohérence
    Et le bouton Valider est désactivé

  Scénario: Valeur hors bornes cliniques
    Étant donné un créneau de facteur de sensibilité (ISF)
    Quand je saisis une valeur en dehors des bornes cliniques autorisées
    Alors le champ est marqué en erreur avec un message nommant la borne
    Et le bouton Valider est désactivé même si la couverture 24 h est complète

  Scénario: Médecin — enregistrement direct immédiat
    Étant donné que je suis connecté en tant que DOCTEUR
    Et une grille cohérente et modifiée
    Quand je clique sur Valider
    Alors le remplacement groupé est appliqué immédiatement
    Et un message de succès confirme la mise à jour des créneaux

  Scénario: Patient — création d'une proposition
    Étant donné que je suis un patient de maturité intermédiaire
    Et une grille cohérente et modifiée
    Quand je clique sur Valider
    Alors une proposition en attente de validation est créée
    Et un message indique qu'elle sera relue par un soignant
    Et la grille affichée n'est pas modifiée dans l'immédiat

  Scénario: Patient débutant — horaires non modifiables
    Étant donné que je suis un patient de maturité débutante
    Quand la modale s'ouvre
    Alors je peux modifier les valeurs
    Mais les champs d'horaires, l'ajout et la suppression sont désactivés
    Et une infobulle explique le niveau d'autonomie requis

  Scénario: Blocage si une proposition est déjà en cours
    Étant donné qu'une proposition est déjà en cours pour ce patient
    Quand j'ouvre la modale ou tente de valider
    Alors le message « une proposition est déjà en cours » est affiché
    Et le bouton Valider est indisponible
    Et aucune seconde proposition ne peut être créée

  Scénario: Rejet serveur après soumission
    Étant donné une grille jugée cohérente au front
    Quand je clique sur Valider et que le serveur refuse l'enregistrement
    Alors la modale reste ouverte sans perdre ma saisie
    Et un message d'erreur explique la raison du refus
    Et les éléments mis en cause par le serveur sont re-signalés

  Scénario: Édition entièrement au clavier
    Étant donné que je navigue sans souris
    Quand j'ouvre la modale, ajoute un créneau, saisis ses horaires et sa valeur, puis valide
    Alors chaque action est atteignable et déclenchable au clavier
    Et le focus reste piégé dans la modale jusqu'à sa fermeture
    Et à la fermeture le focus revient sur l'élément déclencheur

  Scénario: Annulation sans effet
    Étant donné des modifications non enregistrées
    Quand je clique sur Annuler (ou appuie sur Échap et confirme)
    Alors aucune modification n'est envoyée au serveur
    Et la grille sous-jacente reste inchangée
```

---

## 8. Hors périmètre

US-2656 couvre **uniquement l'interface de la modale et ses interactions front**. Ne sont **pas** traités ici :

- **L'endpoint de remplacement groupé serveur** (contrat API, re-validation faisant autorité, transaction, audit) → **US-2655**. La présente story consomme cet endpoint et gère son acceptation / rejet, mais ne le spécifie ni ne l'implémente.
- **L'attribut de maturité du patient** (définition, stockage, calcul du niveau débutant/intermédiaire/expert) → **US-2657**. La modale **reçoit** la capacité en entrée et y réagit ; elle ne décide pas de la maturité.
- **La génération de créneaux à la demande** → **US-2658**.
- **La logique de revue des propositions côté soignant** (écran d'acceptation / rejet d'une proposition patient) — flux existant, hors de cette modale.
- **La basale pompe** : mentionnée comme paramètre futur compatible avec la même modale, mais **son intégration effective n'est pas livrée** dans cette story (ISF / ICR d'abord).
- **Les bornes cliniques elles-mêmes** : la modale les **consomme** depuis `src/lib/clinical-bounds.ts` (source de vérité) ; leur définition/valeurs ne sont pas modifiées ici.

---

*Story UI — à compléter par les specs techniques d'US-2655 (serveur) et US-2657 (maturité). Toute constante ou règle clinique référencée ici doit rester alignée sur `docs/clinical-logic/regles-et-constantes-diabete.md`.*
