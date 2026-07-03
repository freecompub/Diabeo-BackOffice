# US-2642 — Unifier l'ouverture de la fiche patient : liste → page `/patients/[id]`

> 📌 Fiche patient · suite epic US-2630 · front · Taille **S/M** · fait suite à US-2640
> · issue GitHub #621

## Contexte

La fiche patient s'ouvrait de **deux manières** selon le point d'entrée :

| Origine | Transport | Route | Id en URL |
|---|---|---|---|
| **Liste patients** (`/patients`) | Drawer éphémère (`cTok`) | overlay, pas de navigation | ❌ non (`publicRef`) |
| **Home / dashboard médecin** | Page plein écran | `/patients/[id]` | ✅ oui |

Les deux rendaient le **même** `<PatientRecord>` (ADR 21), via deux transports.
**Objectif** : unifier — la liste ouvre la **page plein écran `/patients/[id]`**,
identique au dashboard.

## Décisions retenues

1. **Anti-énumération** — l'id passe en URL depuis la liste comme il l'est déjà
   depuis le dashboard. L'id est déjà présent dans le payload `GET /api/patients`
   (`PatientListItemDto.id`) ; la protection reste **serveur** (`canAccessPatient`
   dans `/patients/[id]/page.tsx`) + audit `surface=patient-detail-page`.
2. **Drawer client retiré** — la liste étant son unique déclencheur, le trio
   client (`ConsultationContext`, `PatientConsultationDrawer`, `useConsultationData`)
   et son montage dans `(dashboard)/layout.tsx` sont supprimés (dead code).
3. **Décommission serveur `cTok` différée** — `/api/consultation/open|close`,
   `/api/patients/record` et la branche `cTok` de `resolveConsultation`
   (`query-helpers.ts`) touchent l'**access-control santé partagé** (la branche
   `?patientId=` de la page utilise le même résolveur). Leur retrait est traité en
   **ticket de suivi** avec revue `healthcare-security-auditor` — hors périmètre de
   cette PR d'UX.

## Périmètre livré

- `src/app/(dashboard)/patients/page.tsx` : `open({publicRef,…})` (drawer) → **vrai
  lien** `<Link href="/patients/[id]">` « étiré » (`after:absolute after:inset-0`
  sur la `<tr>` en `relative`) dans la cellule nom → toute la ligne cliquable, avec
  prefetch + clic-milieu / « ouvrir dans un nouvel onglet » + sémantique lien.
  Suppression de `useConsultation`, `useRouter` et du champ mort `publicRef`.
  **A11y (revue)** : le **nom est le texte du lien** (accessible name = nom, pas
  d'`aria-label` verbeux répété) ; **focus visible porté par le lien** lui-même
  (`focus-visible:outline-*`, fiable sur `<a>` contrairement à un `focus-within`
  sur `<tr>`).
- `src/app/(dashboard)/patients/[id]/page.tsx` : ajout d'une ligne d'audit
  « surface » (`surface: "patient-detail-page"`) sur le chemin succès, en parité
  avec `/api/patients/record` (`surface: "api"`) — traçabilité CNIL/ANS.
- `messages/{fr,en,ar}.json` : clé `patients.openConsultation` **supprimée**
  (l'ancien libellé d'action du drawer). Aucune clé de remplacement — le nom du
  patient sert de texte de lien (accessible name).
- `src/app/(dashboard)/layout.tsx` : `ConsultationProvider` démonté.
- Suppression : `consultation/{ConsultationContext,PatientConsultationDrawer}.tsx`,
  `consultation/useConsultationData.ts`, `consultation/tabs/TabState.tsx`,
  `tests/components/consultation-drawer-toggle.test.tsx` (test du toggle US-2640, obsolète).

## Critères d'acceptation

- **AC-1** ✅ Clic (ou Entrée/Espace) sur une ligne de `/patients` → navigation
  `/patients/[id]` rendant `<PatientRecord variant="page">`.
- **AC-2** ✅ Parité liste ⇄ dashboard : même route, même composant, même gate
  d'accès, même ligne d'audit.
- **AC-3** ✅ Accès hors périmètre → `notFound()` (gate `canAccessPatient` inchangé).
- **AC-4** ✅ A11y : lien focusable au clavier avec focus visible (outline porté par
  le `<a>`), sémantique lien native (Entrée, clic-milieu/nouvel-onglet) ; nom = texte
  du lien (WCAG 1.3.1/2.4.7/4.1.2).
- **AC-5** ✅ Suppression du dead code **client** sans régression (typecheck, lint,
  tests serveur `cTok` + i18n-parity verts). Décommission serveur = ticket dédié.

## Tests

- `tests/e2e/patients-list-api.spec.ts` : clic ligne → `/patients/[id]` ; navigation
  clavier (Entrée) → `/patients/[id]`.
- Non-régression conservée : les 3 tests unitaires serveur `cTok`
  (`patients-record-route`, `resolve-patient-token`, `consultation.service`) restent
  verts (endpoints non touchés).

## Suivi

- **Ticket décommission serveur `cTok`** (revue `healthcare-security-auditor`) —
  retrait `/api/consultation/open|close`, `/api/patients/record`, nettoyage branche
  `cTok` de `resolveConsultation`, et des branches `variant="drawer"` de
  `<PatientRecord>` devenues inertes.
