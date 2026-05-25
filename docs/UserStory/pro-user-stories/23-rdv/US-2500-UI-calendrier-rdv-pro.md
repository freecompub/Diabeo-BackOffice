# US-2500-UI — Calendrier RDV pro (UI dédiée)

> 📌 **23. Gestion RDV** · Priorité **V1.5** · Pays **Universel**
>
> 🔗 **Issue GitHub** : [#428](https://github.com/freecompub/Diabeo-BackOffice/issues/428)
>
> 🆕 **Créé 2026-05-23** — découvert lors de la session dev quand un médecin
> a constaté l'absence de calendrier complet (`/medecin` ne montre qu'un
> widget 3 RDV du jour max). Backend déjà livré PR #392, UI manquante.

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2500-UI` |
| **Référence parente** | `US-2500` (backend, ✅ DONE PR #392) |
| **Domaine** | 23. Gestion RDV |
| **Priorité** | **V1.5** (post-merge backend, pré-prod patients réels) |
| **Pays cible** | Universel |
| **Intégration externe** | Non |
| **Service / Standard** | Interne (consume `/api/appointments/*`) |
| **Modèle économique** | Interne |
| **Coût estimé** | — |
| **Statut** | 🆕 À démarrer |
| **Story points** | **13** (Fibonacci) |
| **Issue GH** | [#428](https://github.com/freecompub/Diabeo-BackOffice/issues/428) |
| **Owner** | À assigner |

---

## 🎯 Contexte

Le backend RDV est livré et déployé en prod depuis **PR #392** (Groupe 8 RDV — US-2500 à US-2506). 6 routes API opérationnelles :

| Route | Verbe | Notes |
|-------|-------|-------|
| `/api/appointments` | GET/POST | list + range query scope obligatoire (NURSE+) |
| `/api/appointments/[id]` | GET/PUT/DELETE | détail/edit/cancel |
| `/api/appointments/[id]/confirm` | POST | confirmation DOCTOR+ |
| `/api/appointments/[id]/cancel` | POST | annulation (state machine, TTL 7j alternative) |
| `/api/appointments/[id]/propose-alternative` | POST | contre-proposition |
| `/api/appointments/[id]/accept-alternative` | POST | accept alternative |

**Backend features déjà disponibles** :
- Note/motif/cancelReason chiffrés AES-256-GCM
- Cross-midnight overlap handling
- EXCLUDE GiST anti-double-booking
- Soft-delete filter
- Plages indisponibilités médecin (`MemberUnavailability` US-2504)
- Config booking auto vs validation manuelle (`HealthcareMember.bookingMode` US-2505)

**UI pro actuelle** : uniquement le widget `AppointmentCard` sur `/medecin` (3 RDV du jour max). Pas de calendrier complet, pas de page dédiée pour gérer un planning. Identifié dans `docs/reference/features-by-role.md` §11.d et PR #426 (audit RBAC).

---

## 👤 User story

> **En tant que médecin/infirmier**, je veux **accéder à un calendrier complet de mes RDV** (vues mois/semaine/jour), **pouvoir créer/déplacer/annuler un RDV directement depuis le calendrier**, et **voir les plages indisponibles + les proposals d'alternatives en attente**, **afin de gérer mon planning sans passer par l'API curl ou la console**.

---

## ✅ Critères d'acceptation

### Navigation

- [ ] Item sidebar **"Calendrier"** ou **"Rendez-vous"** avec icône (`CalendarDays` lucide-react), gated `minRole: NURSE`
- [ ] Route `/appointments` (page server-component, layout dashboard standard)
- [ ] Lien depuis le widget `AppointmentCard` du dashboard médecin ("Voir tous les RDV →")

### Vue calendrier

- [ ] **3 vues** : mois (grid 7×6), semaine (grid 7 jours × heures), jour (timeline verticale)
- [ ] Switch vue via tabs ou boutons (mois/semaine/jour) avec persistance localStorage
- [ ] Navigation mois précédent/suivant (chevrons + bouton "Aujourd'hui")
- [ ] Affichage RDV : couleur par statut (scheduled / pending_validation / confirmed / cancelled / completed / no_show)
- [ ] Affichage plages indisponibles (`MemberUnavailability`) en gris hachuré
- [x] Drag & drop pour déplacer un RDV (vue semaine + jour) ✅ iter 7 — plugin `@schedule-x/drag-and-drop`, snap 15min, `onBeforeEventUpdateAsync` rollback Schedule-X si API refuse, `_options.disableDND` sur statuts terminaux (cancelled/completed/no_show) + hour=null
- [x] Clic sur un RDV → modal détail (note/motif déchiffrés à l'ouverture, audit READ ciblé) ✅ iter 5

### Filtres et scope

- [x] **Filtre par membre cabinet** ✅ (iter 4 — PR `feat/us-2500-ui-member-filter`)
  - Endpoint `/api/account/me-memberships` (auth, NURSE+ ont des memberships)
  - Hook `useMyMemberships` + composant `<MemberFilter>` shadcn Select
  - Auto-résolution si 1 seul membership (cas dominant DOCTOR/NURSE)
  - Label statique si 1 membership · dropdown si ≥ 2 (cas multi-cabinets)
  - Empty state distinct si 0 membership (ADMIN sans HealthcareMember)
- [x] Filtre par statut multi-select via chips toggle (defaults : scheduled + confirmed + pending_validation) ✅ iter 8 — `<StatusFilter>` aria-pressed, filtre client-side
- [x] Filtre par patient (search-select via `<PatientFilter>` réutilisant `<PatientCombobox>`) ✅ iter 8 — filtre server-side via `useAppointments(patientId)`
- [x] Range query optimisée (`/api/appointments?from=X&to=Y&memberId=Z`) ✅ iter 2

### Création / édition

- [x] Bouton **"+ Nouveau RDV"** en haut à droite ✅ iter 6
- [x] Modal formulaire ✅ iter 6 :
  - patient (combobox autocomplete via `<datalist>` + `usePatientList`)
  - date+heure (input date + time natifs, min=aujourd'hui)
  - durée (15-240 min, select avec presets 15/30/45/60/90/120)
  - location (in_person / video / phone, select)
  - type (diabeto / ide / hdj / other)
  - motif (textarea max 200c, chiffré AES-256-GCM côté backend)
  - member auto-résolu via `effectiveMemberId` du parent (iter 4)
- [ ] Validation client : pas de double-booking sur le même slot membre (visuel + API enforce EXCLUDE GiST) — V1.5 (backend déjà enforce 409)
- [ ] Si `bookingMode = "manual_validation"` → RDV créé en status `pending_validation`, badge orange jusqu'à `/confirm` DOCTOR+ — V1.5 (champ HealthcareService.bookingMode à ajouter au schema)

### Workflow annulation / alternative

- [x] Bouton "Annuler" dans modal détail → form `cancelReason` (chiffré) ✅ iter 5
- [x] Bouton "Proposer une alternative" → form date+heure inline (DOCTOR+ uniquement) ✅ iter 5
- [x] Bandeau "Alternatives en attente" ✅ iter 9 — `<AlternativesBanner>` auto-affiché si RDV cancelled + proposedAlternativeAt non expiré (TTL 7j), bouton "Voir" filtre calendar sur cancelled
- [x] Bouton "Accepter alternative" → `/accept-alternative` ✅ iter 9 — dans `<AppointmentDetailModal>` view mode, visible si status=cancelled + proposedAlternativeAt set

### Accessibilité

- [ ] ARIA roles : `role="grid"` sur le calendrier mois, `role="gridcell"` sur chaque jour
- [ ] Navigation clavier : flèches pour naviguer entre slots, Enter pour ouvrir détail
- [ ] Focus rings 3-4px (cohérent design system Sérénité Active)
- [ ] `aria-live="polite"` sur les changements de statut RDV (announce screen reader)
- [ ] Touch targets ≥ 44px sur les boutons de navigation mois

### Performance

- [ ] Pagination ou fetch incremental : 1 mois en cache, fetch month-by-month en arrière-plan
- [ ] Polling 60s pour détecter nouveaux RDV (cohérent avec le pattern `/dashboard/medecin/appointments`)
- [ ] Skeleton screen pendant chargement initial (pas spinner générique)
- [ ] Animations 150-300ms (vue switch, modal open)

### i18n

- [ ] Tous les libellés via `useTranslations("appointments")` — clés `fr` / `en` / `ar` à ajouter
- [ ] Dates formatées via `@/lib/intl/formatters` (US-2115) — pas de `new Date().toString()`
- [ ] RTL support : navigation chevrons inversés en arabe

### Audit & sécurité

- [ ] Audit `READ` sur `/api/appointments` déjà fait côté backend — vérifier que la pagination ne fait pas exploser `audit_logs`
- [ ] Pas d'affichage de note/motif chiffré en clair dans la grille (uniquement dans modal détail = audit READ ciblé)
- [ ] Headers `Cache-Control: no-store` sur la page (PHI)

---

## 🔗 Dépendances

| Dépendance | État |
|---|---|
| Backend RDV (US-2500/2501/2503/2504/2505) | ✅ DONE PR #392 |
| Backend reminders RDV (US-2502/2506 mock SMS) | ✅ DONE PR #418 |
| NavigationShell + helper `role-home` | ✅ DONE PR #426 |
| Design system Sérénité Active + i18n FR/EN/AR (US-2112/2115) | ✅ DONE PR #351 |
| Librairie calendrier (à décider) | ⚠️ à scoper |

---

## 🏗️ Spécifications techniques proposées

- **Layout** : single-page `/appointments` avec sidebar `NavigationShell` standard
- **Stack UI** : shadcn/ui (`Sheet` pour mobile responsive, `Dialog` pour modals, `DropdownMenu` pour filtres) + lib calendrier
- **Librairie calendrier candidate** : `react-big-calendar` (mature, accessible) ou `@fullcalendar/react` (riche, drag&drop natif) ou implémentation maison (contrôle total mais coûteuse)
- **State management** : SWR pattern (déjà utilisé sur `/dashboard`) ou TanStack Query
- **Fetch initial** : month-range avec `useEffect + refetch on month change`
- **Polling** : 60s sur le range courant uniquement (pas tous les mois en cache)
- **Optimistic UI** : drag & drop applique localement avant PUT API, rollback si fail
- **Tests** : 25-40 tests unit (composants calendrier, drag handler, modal) + 8-12 E2E Playwright (création/annulation/alternative workflow)

---

## 🚫 Hors scope (reporté V2 ou autre US)

- Téléconsultation visio intégrée (US-2067 V4)
- Export ICS / iCal
- Sync Google Calendar / Outlook (bidirectionnel)
- Récurrence RDV (every Monday, etc.)
- Recherche full-text RDV par mots-clés du motif

---

## ⏱️ Estimation détaillée

**13 SP** (~3-4 jours dev senior + 1 jour review + 0.5 jour QA) :

| Tâche | SP |
|---|---:|
| Setup lib calendrier + intégration shadcn | 2 |
| Vue mois/semaine/jour + filtres | 5 |
| Modal détail + create/edit/cancel | 3 |
| Alternatives workflow | 1 |
| Polish + i18n + a11y | 1 |
| Tests | 1 |
| **Total** | **13** |

---

## 📁 Référence backend (rappel)

| Élément | Path |
|---|---|
| Schéma Prisma | `prisma/schema.prisma` → models `Appointment` + `MemberUnavailability` |
| Service | `src/lib/services/appointment.service.ts` |
| Routes API | `src/app/api/appointments/**/route.ts` |
| Inventaire API | `docs/reference/features-by-role.md` §3.11 |

---

## 🎯 Priorité

V1.5 — pré-requis 100% UI scope médecin/infirmier. Sans cette page, les pros ne peuvent gérer leurs RDV qu'en curl/console = inutilisable en pratique.
