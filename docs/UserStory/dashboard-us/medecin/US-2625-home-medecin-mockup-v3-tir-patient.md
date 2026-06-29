# US-2625 — Home médecin « Ma journée » : alignement maquette Home v3 + TIR par patient

> 📌 **medecin** · Priorité **V1** · Série Navigation & Accès Backoffice · Affine `US-2602` (« Ma journée »)

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2625` |
| **Type** | Refonte visuelle + enrichissement clinique |
| **Priorité** | **V1** |
| **Story points** | **5** |
| **Persona** | DOCTOR (🖥️ Web ≥1024px), NURSE (carte Relances partagée) |
| **Dépendances** | US-2602 (Ma journée), US-2401 (urgences), US-2402 (RDV), US-2403 (patients à suivre), US-2404 (KPI), US-2409 (relances infirmier), US-2404/US-2406 (TIR cabinet) |
| **Affine** | US-2602 (worklist de tri médecin) |
| **Maquette** | `docs/mockups/home-roles-v3.html` §médecin |

---

## 📋 Contexte produit

La page `/medecin` (« Ma journée ») ne correspondait pas à la maquette de référence
`home-roles-v3.html` : ordre des cartes non « triage-first », cartes au rendu plat
(badge + nom + métrique), pas d'avatar/sous-ligne/pills/boutons d'action, sous-titre
de greeting sans compteurs de triage. Cette US réaligne la page sur la maquette **et**
ajoute le **temps dans la cible (TIR)** par patient sur la carte d'alertes — signal de
triage clé absent jusque-là.

Le périmètre patient, le scoping RBAC, l'audit HDS et le modèle de confidentialité
(prénom seul, pas de nom patient dans les messages) restent inchangés.

---

## 🎨 Composition (ordre triage-first)

```
┌─────────────────────────────────────┐
│ Alertes glycémiques (FULL, en tête) │  ← carte de triage, lignes riches
├──────────────────┬──────────────────┤
│ Propositions     │ Rendez-vous jour │
├──────────────────┼──────────────────┤
│ Relances         │ Messages non lus │
├─────────────────────────────────────┤
│ Patients à suivre (full)            │  ← conservé (US-2403)
├─────────────────────────────────────┤
│ KPI cabinet 14j (full)              │  ← conservé (US-2404)
└─────────────────────────────────────┘
```

- **3 primitives partagées** : `DashboardCardHeader` (pastille d'état + titre Fraunces
  + compteur monospace + lien « Tout voir »), `DashboardRow`/`DashboardAvatar`/
  `DashboardRowAction` (avatar teinté, sous-ligne, bouton d'action), `DashboardPill`/
  `PathologyPill` (pills sémantiques `feedback-*`/`pathology-*`, acronyme via `<Acronym>`).
- **Sous-titre greeting** enrichi : « {date} · N patients à trier · M alertes prioritaires »
  (compteur surligné en accent), via `triageSummaryQuery` (count-only, 1 audit).

> Décision produit : la maquette ne montre ni KPI ni « Patients à suivre » pour le médecin,
> mais ces features livrées (US-2403/US-2404) sont **conservées** sous la grille.

---

## ✅ Critères d'acceptation

### AC-1 — Ordre triage-first
```gherkin
Étant donné un médecin sur /medecin
Quand la page se charge
Alors la carte Alertes est en pleine largeur en tête, suivie d'une grille 2×2
  (Propositions, Rendez-vous, Relances, Messages), puis Patients à suivre et KPI
```

### AC-2 — TIR par patient pathology-aware
```gherkin
Étant donné un patient en alerte avec des mesures CGM sur 14 j
Quand la carte Alertes s'affiche
Alors son TIR est calculé sur sa cible (GD 63–140 mg/dL, sinon 70–180 mg/dL)
  et affiché en sous-ligne
```

### AC-3 — Bi-palier TIR
```gherkin
Étant donné un TIR patient calculé
Quand il est < 50 % → pill rouge « TIR bas »
  ; quand il est 50–70 % → pill ambre « sous-cible » ; quand ≥ 70 % → aucune pill
```

### AC-4 — Suffisance de données (fail-safe)
```gherkin
Étant donné un patient dont la capture CGM 14 j est < 30 %
Quand la carte Alertes s'affiche
Alors aucun TIR ni pill TIR n'est affiché (pas de valeur trompeuse)
```

### AC-5 — Confidentialité préservée
```gherkin
Étant donné la carte Messages non lus
Quand elle s'affiche
Alors aucun nom de patient n'est exposé (preview seul), conforme au modèle US-2602
```

### AC-6 — Actions vers routes réelles
```gherkin
Étant donné une ligne de carte (alerte, RDV, proposition, relance, message)
Quand le médecin active le bouton d'action
Alors il est dirigé vers la route existante (/patients/[id], /patients/[id]/review,
  /appointments, /messages, tel:/sms:)
```

### AC-7 — Accessibilité WCAG 2.1 AA
```gherkin
Étant donné les pills, boutons et pastilles
Quand on mesure le contraste
Alors texte ≥ 4.5:1 (tokens -fg), couleur jamais seul indicateur, focus visible,
  live regions urgences préservées
```

### AC-8 — i18n FR/EN/AR
```gherkin
Étant donné une locale active (fr, en, ar)
Quand la page se charge
Alors tous les libellés (pills, « Tout voir », sous-cible, bannière stale) sont traduits
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Bornes TIR par patient dérivées de `getCgmDefaults(pathology)` (source unique,
  cohérent avec `analytics`/`objectives.service`). Jamais de bornes adultes pour la GD.
- **RM-2** : Plancher de suffisance `cgmCaptureRate ≥ DASHBOARD_TIR.MIN_CAPTURE_RATE` (30 %),
  sinon `tirPercent = null` (fail-safe — pas de TIR fabriqué).
- **RM-3** : Paliers TIR centralisés dans `src/lib/clinical-bounds.ts` (`DASHBOARD_TIR` :
  TARGET 70 %, LOW 50 %, MIN_CAPTURE 30 %).
- **RM-4** : `triageSummaryQuery` est count-only (aucune lecture PHI ligne-à-ligne), scopée
  au portefeuille, audite **une** ligne récapitulative avec contexte réseau (IP/UA/requestId).
- **RM-5** : Marqueur d'audit `derived: ["tir14d"]` sur le pivot par patient (traçabilité
  de l'agrégat CGM restitué, sans valeur de santé).

> Règles transverses (audit, chiffrement, RGPD) : cf `docs/security/baseline.md`.

---

## 🔌 API (inchangée — réutilise l'existant)

```
GET /api/dashboard/medecin/urgencies          → UrgencyItem[] (+ tirPercent)
GET /api/dashboard/medecin/appointments        → AppointmentItem[]
GET /api/dashboard/medecin/pending-proposals    → PendingProposalItem[]
GET /api/dashboard/infirmier/recall-list        → RecallItem[]
GET /api/dashboard/medecin/unread-threads        → UnreadThreadItem[]
GET /api/dashboard/medecin/patients-at-risk      → PatientAtRiskItem[]
GET /api/dashboard/medecin/kpi                    → KpiCard[]
triageSummaryQuery (server, page conteneur)       → { patientsToTriage, priorityAlerts }
```

---

## 🧪 Tests prioritaires

- TIR : bornes GD vs adulte, plancher de suffisance (capture < 30 % → null), cas 0 %.
- `triageSummaryQuery` : portefeuille vide → {0,0}, scoping RBAC.
- a11y : contraste pills/boutons ≥ 4.5:1, parité design-tokens CSS ↔ TS.
- i18n : parité FR/EN/AR.

---

## 📦 DoD

- [x] Ordre triage-first conforme à la maquette
- [x] TIR pathology-aware + plancher de suffisance + bi-palier
- [x] Scoping RBAC + audit (contexte réseau + marqueur dérivé) préservés
- [x] Contraste WCAG AA (tokens -fg), couleur jamais seul indicateur
- [x] i18n FR/EN/AR (parité)
- [x] tsc / eslint / build verts, suite unitaire verte
- [x] Revue multi-agents (code, HDS, médical, a11y) : GO

> DoD générale : `docs/dod/baseline.md`.

---

## 🔗 Liens

- Maquette : `docs/mockups/home-roles-v3.html` §médecin
- US parente : US-2602 · satellites : US-2401/2402/2403/2404/2409
- Suivi : US-2626 (bug RDV `@db.Time`), US-2627 (unifier `MIN_CAPTURE_RATE`), US-2628 (borner dénominateur TIR)

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
