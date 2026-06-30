# US-2632 — Composant présentational `<PatientRecord>` + contrat de données

> 📌 Fiche patient · epic US-2630 · front · Taille **M** · dépend de : —

## Contexte
Socle de la fusion : extraire le rendu des onglets de `PatientDetailClient` vers un **composant « dumb »** piloté par un **DTO normalisé**, agnostique de la source de données (page RSC ou drawer `cTok`). Aucun changement fonctionnel/visuel à cette étape.

## Périmètre
- `<PatientRecord>` présentational : en-tête + onglets (Vue d'ensemble · Glycémie · AGP · Tendances de repas · Traitements · Documents), rendu à partir d'un DTO unique.
- Contrat de props normalisé, futur-proof pour : période, vue, `dataSource` CGM/BGM, mode page/drawer.
- Page `/patients/[id]` câblée sur `<PatientRecord>` (parité visuelle stricte).

## Critères d'acceptation
- **AC-1** Aucune régression visuelle/fonctionnelle de la page existante.
- **AC-2** Le composant **ne construit aucune URL contenant un id patient numérique** (préparation drawer) — les liens (ex. téléchargement document) passent par le contrat, pas par `?patientId=` en dur.
- **AC-3** Zéro calcul clinique côté composant (rend des valeurs déjà projetées).
- **AC-4** Design system : tokens uniquement (migration des hex/Tailwind brut de la maquette).

## Risques
Bien isoler le contrat (il porte toute l'évolutivité : drawer, BGM, période, vue). Couvre archi US-A.

---

## ✅ Implémentation (livrée — PR #607)

- **`src/components/diabeo/patient/PatientRecord.tsx`** — composant présentational (en-tête + onglets Vue d'ensemble · Glycémie · Traitements · Documents, état actuel), piloté par le DTO `PatientRecordData`. Props `PatientRecordProps` : `{ data, sharingDisabled?, documentHref }`. Les onglets AGP / Tendances de repas seront ajoutés en US-2635 / US-2637.
- **`src/components/diabeo/patient/patient-record-views.ts`** (nouveau) — module **neutre** portant les **types de vue** (`GlycemiaView`, `TreatmentView`, `SlotCoverage`, `DocumentItem`…). Les builders serveur co-localisés à la route (`glycemia-view` / `treatment-view` / `document-view`) les **ré-exportent** : sens de dépendance `app/ → components/`, composant autoportant (suite revue — finding M1).
- **`PatientDetailClient.tsx`** — adaptateur **page** mince : câble `<PatientRecord>` + fournit `documentHref` (`?patientId=`). Re-exporte `PatientDetailData` (= `PatientRecordData`) → `page.tsx` inchangé.
- **Contrat de liens** : le composant ne fabrique **aucune URL portant l'id patient** ; le téléchargement passe par `documentHref` (drawer = jeton `cTok` en US-2633). ⚠️ `PatientContextBar` (rendu par `PatientRecord`) construit encore en interne `/patients/[id]/review` et `/messages?patientId=` → leur passage à un contrat opaque relève d'**US-2633** (documenté dans l'en-tête du composant).

### Revue
Revue multi-agents (code-reviewer + healthcare-security-auditor) : **GO**, refactor à comportement constant, anti-énumération préparé. Findings M1 (couplage `components→app` → module de types neutre), M2 (commentaire surstaté → nuancé), L1 (`?? ""` documenté), L3 (test renommé `patient-record.test.tsx`) corrigés.

### Reste à venir (US suivantes)
- Onglets **AGP** (US-2635) / **Tendances de repas** (US-2637), **migration tokens** des nouvelles viz (AC-4 s'applique à ce moment-là — le code extrait était déjà tokenisé).
- **Onglet actif contrôlable** (URL-driven) + extensibilité de la liste d'onglets : à introduire avec US-2634 (période/vue).

### Vérifications
`tsc` ✓ · `eslint` ✓ · `pnpm build` ✓ · suite verte (parité + contrat `documentHref` testé).
