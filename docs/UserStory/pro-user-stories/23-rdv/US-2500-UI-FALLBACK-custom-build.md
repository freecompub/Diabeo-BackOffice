# US-2500-UI-FALLBACK — Migration custom build calendrier RDV

> 📌 **23. Gestion RDV** · Priorité **CONTINGENCY** · Pays **Universel**
>
> 🔗 **Issue GitHub** : (à créer si déclenchée)
>
> 🆕 **Créé 2026-05-23** — US préventive de contingence si Schedule-X
> (choix retenu pour US-2500-UI) présente des bloqueurs en recette/QA.
>
> ⚠️ **Cette US ne se déclenche QUE si des problèmes bloquants sont
> identifiés sur Schedule-X.** Sinon, elle reste en backlog dormant.

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2500-UI-FALLBACK` |
| **Référence parente** | `US-2500-UI` (issue #428 — implémentation initiale Schedule-X) |
| **Domaine** | 23. Gestion RDV |
| **Priorité** | **CONTINGENCY** (déclenchée uniquement si Schedule-X foire) |
| **Pays cible** | Universel |
| **Intégration externe** | Non |
| **Service / Standard** | Interne (custom build remplace `@schedule-x/react`) |
| **Modèle économique** | Interne |
| **Coût estimé** | — |
| **Statut** | 💤 Dormant (réveil conditionnel) |
| **Story points** | **18-21** (Fibonacci — surcoût vs +5-8 SP au lieu des 13 SP Schedule-X) |
| **Owner** | À assigner si déclenchée |

---

## 🎯 Contexte

L'US-2500-UI a démarré avec **Schedule-X** (`@schedule-x/react`) — voir
[#428](https://github.com/freecompub/Diabeo-BackOffice/issues/428) et
spec `US-2500-UI-calendrier-rdv-pro.md`.

Schedule-X a été choisi pour :
- License MIT (vs FullCalendar commercial ~480$/an)
- Bundle léger (~60 KB)
- Design moderne 2024
- TypeScript first-class
- React 19 compatible (peer deps généreuses)

**Risques identifiés** sur Schedule-X au moment du choix (2026-05-23) :
1. **Community plus petite** (2k★ vs 19k★ FullCalendar / 8k★ react-big-calendar)
2. **Battle-test healthcare insuffisant** — pas d'antécédent EHR connu
3. **Documentation moins riche** que les concurrents matures
4. **Drag & drop** via plugin séparé `@schedule-x/drag-and-drop` — pas testé Diabeo
5. **RTL arabe** — fonctionnement à valider sur les vues mois/semaine
6. **Accessibilité WCAG 2.1 AA** — pas d'audit a11y officiel publié
7. **Edge cases DST** (changement heure été/hiver) — comportement à valider

Cette US contingency anticipe le **switch vers une implémentation custom**
si un ou plusieurs de ces risques se matérialisent en bloquant pendant
la recette/QA.

---

## 🚨 Critères de déclenchement

Cette US est **activée** (passée de 💤 dormant à 🆕 à démarrer) si **AU
MOINS UN** des critères ci-dessous est constaté en recette :

### Bloqueurs techniques

- [ ] Drag & drop instable sur vues semaine/jour (events qui sautent, doubles renderings, fuites mémoire React 19)
- [ ] Performance dégradée > 200 ms sur affichage 50+ events / mois (cible UX = 60fps soutenu)
- [ ] Bug critique non résolu côté Schedule-X depuis > 30 jours (issue GitHub upstream bloquante)
- [ ] Incompatibilité React 19.2+ découverte en production (warning React, hydration mismatch)

### Bloqueurs accessibilité

- [ ] Audit WCAG 2.1 AA échoue sur > 3 critères critiques (Tab order, focus visible, ARIA live, etc.)
- [ ] Lecteur d'écran NVDA/VoiceOver ne parvient pas à naviguer entre slots
- [ ] Contraste palette Sérénité Active < 4.5:1 sur Schedule-X (impossibilité de surcharger)

### Bloqueurs i18n/RTL

- [ ] RTL arabe casse la grid mois (chevrons inversés, week start, alignement events)
- [ ] Formats date FR/EN/AR non-cohérents avec `@/lib/intl/formatters` (US-2115)

### Bloqueurs business

- [ ] Cabinet client (recette) refuse l'UI pour ergonomie sub-standard
- [ ] License Schedule-X passe commercial-only sans alternative MIT (très improbable mais à surveiller)

### Bloqueurs maintenance

- [ ] Upstream Schedule-X archive ou ralentit drastiquement (> 6 mois sans release)
- [ ] CVE critique non patché par upstream sous 14 jours

---

## 👤 User story

> **En tant qu'équipe Diabeo**, je veux **un plan de migration custom-build
> calendrier RDV documenté et estimé**, **afin de pouvoir remplacer
> Schedule-X rapidement et proprement** si l'évaluation en recette
> identifie des bloqueurs non-contournables.

---

## ✅ Critères d'acceptation (si déclenchée)

### 1. Audit pré-migration

- [ ] Document `docs/runbook/calendar-fallback-decision.md` (ou similaire) listant :
  - Bloqueurs constatés (avec captures, traces, dates)
  - Tentatives de contournement (workarounds Schedule-X testés)
  - Decision rationale (pourquoi switch vs continuer)
  - Validation décideur (PO + tech lead)
- [ ] Inventaire des composants à refactor (cf. §4 ci-dessous)
- [ ] Estimation actualisée (initial = +5-8 SP, à confirmer)

### 2. Implémentation custom

- [ ] Modules utilities autonomes :
  - `src/lib/calendar/grid.ts` — calcul grilles mois/semaine/jour
  - `src/lib/calendar/dst.ts` — handling DST (changement heure)
  - `src/lib/calendar/iso-week.ts` — semaines ISO
  - `src/lib/calendar/overlap.ts` — détection conflits / chevauchements
- [ ] Composants UI :
  - `<CalendarGrid>` (mois) — `role="grid"` + `role="gridcell"` natifs
  - `<CalendarTimeline>` (semaine/jour) — colonnes jours × heures, lignes 30 min
  - `<CalendarEvent>` — bubble event avec couleur par statut
  - `<CalendarToolbar>` — switch vue + nav mois + filtres
- [ ] Drag & drop via `@base-ui/react` interaction primitives (ou HTML5 native DnD)
- [ ] Tests : 35-50 unit (grid math + DST + overlap) + 12-15 E2E
- [ ] Bundle target : < 30 KB gzipped (vs Schedule-X 60 KB)

### 3. Réutilisation des composants Schedule-X

- [ ] **Préserver** au max les composants downstream de Schedule-X :
  - Modal détail RDV (`AppointmentDetailDialog`)
  - Modal create/edit (`AppointmentFormDialog`)
  - Workflow alternatives (`AlternativeBanner`)
  - Hooks data (`useAppointments`, `useMemberAvailability`)
  - i18n keys (clés `appointments.*` déjà ajoutées en fr/en/ar)
- [ ] Wrapper d'abstraction `<CalendarShell>` qui isole la lib calendrier
  derrière une API stable — change uniquement le **moteur de rendu**,
  pas l'écosystème autour

### 4. Migration data layer

- [ ] `mapAppointmentToEvent(appt)` → adapter pour nouveau composant
- [ ] Validation : drag&drop renvoie le bon `(newStart, newEnd, memberId)`
- [ ] Optimistic UI : rollback localement si PUT API fail (déjà implémenté en US-2500-UI initial)

### 5. Tests de non-régression

- [ ] Tous les tests E2E US-2500-UI Schedule-X passent encore avec custom
- [ ] Visual regression : screenshots Sérénité Active conservés
- [ ] Performance : 60fps soutenu sur 100+ events/mois
- [ ] A11y : audit `axe-playwright` 0 violations critiques

### 6. Documentation

- [ ] Update `docs/UserStory/pro-user-stories/23-rdv/US-2500-UI-calendrier-rdv-pro.md`
  pour refléter le nouveau choix tech
- [ ] Update `package.json` (remove `@schedule-x/*`)
- [ ] Update `docs/reference/features-by-role.md` si nécessaire
- [ ] Update `CLAUDE.md` ADR (nouveau ADR : "Custom calendar build vs Schedule-X")
- [ ] Update `docs/ROADMAP.md` (marquer US-2500-UI-FALLBACK livré)

---

## 🔗 Dépendances

| Dépendance | État |
|---|---|
| US-2500-UI initiale (Schedule-X) | En cours / Livré |
| `@base-ui/react` (déjà installé) | ✅ DONE |
| `@/lib/intl/formatters` US-2115 | ✅ DONE |
| Design system Sérénité Active | ✅ DONE |

---

## 🏗️ Spécifications techniques (si déclenchée)

### Architecture custom

```
src/
├── lib/calendar/                    ← logique pure (testable isolément)
│   ├── grid.ts                      ← getMonthGrid, getWeekGrid, getDayGrid
│   ├── dst.ts                       ← handleDstTransition
│   ├── iso-week.ts                  ← getIsoWeekNumber, getWeekStart
│   └── overlap.ts                   ← detectOverlap, sortByStart
├── components/diabeo/calendar/      ← composants UI
│   ├── CalendarShell.tsx            ← wrapper d'abstraction (API stable)
│   ├── CalendarGrid.tsx             ← vue mois
│   ├── CalendarTimeline.tsx         ← vue semaine/jour
│   ├── CalendarEvent.tsx            ← bubble event
│   └── CalendarToolbar.tsx          ← nav + filtres
└── app/(dashboard)/appointments/
    └── page.tsx                     ← page top-level (réutilisée)
```

### Patterns clés

- **Headless approach** : la lib utilities ne fait que du calcul pur,
  les composants UI gèrent uniquement le rendu (testable séparément)
- **Stable wrapper** : `<CalendarShell>` accepte les mêmes props que
  la version Schedule-X — minimise le diff côté `page.tsx`
- **Touch + keyboard** : pas de dépendance souris-only
- **Time zones** : `Intl.DateTimeFormat` natif (cf. US-2115 formatters)
  + tests DST (transition mars/octobre)

### Risques de la migration

- **Drag & drop natif HTML5** = expérience inférieure à React DnD libs
  (FullCalendar/react-big-calendar utilisent React DnD). Mitigation :
  utiliser `pointer events` + state machine custom (complexité +2 SP).
- **Recurring events** non implémentés en V1 (mentionné hors scope dans
  US-2500-UI) — pas un blocker.
- **Mobile** (< 768px) reste single-day timeline collapsible (responsive
  existant US-2500-UI conservé).

---

## 🚫 Hors scope

- Téléconsultation visio intégrée (US-2067 V4)
- Export ICS / iCal
- Sync Google Calendar / Outlook
- Récurrence RDV
- Recherche full-text RDV

(Identique à US-2500-UI initial — pas de changement scope produit.)

---

## ⏱️ Estimation détaillée (si déclenchée)

**18-21 SP** (~5-7 jours dev senior + 1 jour review + 1 jour QA + 0.5 jour doc) :

| Tâche | SP |
|---|---:|
| Audit pré-migration + decision document | 1 |
| Modules utilities `lib/calendar/*` + tests unit | 4 |
| Composants UI `<CalendarGrid/Timeline/Event/Toolbar>` | 5 |
| Drag & drop custom (state machine + pointer events) | 3 |
| Wrapper `<CalendarShell>` (compat API) + intégration | 2 |
| Réutilisation modals / hooks / i18n (déjà US-2500-UI) | 0 (reused) |
| Tests E2E non-régression + visual + a11y | 2 |
| Documentation (ADR + spec update) | 1 |
| Cleanup Schedule-X (uninstall + remove imports) | 1 |
| **Total** | **19** |

---

## 📊 Comparaison surcoût vs initial Schedule-X

| Métrique | Schedule-X (initial) | Custom (fallback) | Delta |
|---|:---:|:---:|:---:|
| Story points | 13 | 19 | **+6 SP** |
| Bundle size | ~60 KB | ~25 KB | -35 KB ✅ |
| Maintenance | Externe (community 2k★) | Interne (équipe Diabeo) | Plus de contrôle, plus de charge |
| Time to ship initial | Plus rapide | Plus lent | +3-4 jours dev |
| Risque upstream (CVE, abandon) | Existe | Aucun | ✅ |
| Customization Sérénité | Bonne | Maximale | ✅ |
| WCAG AA garanti | À valider | Sous contrôle | ✅ |

**Note pragmatique** : le surcoût +6 SP de Custom couvre **uniquement** la
réimplémentation du moteur de rendu. **Tous les autres composants** (modals,
hooks, i18n keys, audit, scope cabinet, filtres) **restent intacts** — d'où
le wrapping via `<CalendarShell>` pour isoler le diff.

---

## 📁 Référence backend (rappel, inchangé vs US-2500-UI)

| Élément | Path |
|---|---|
| Schéma Prisma | `prisma/schema.prisma` → models `Appointment` + `MemberUnavailability` |
| Service | `src/lib/services/appointment.service.ts` |
| Routes API | `src/app/api/appointments/**/route.ts` |
| Inventaire API | `docs/reference/features-by-role.md` §3.11 |

---

## 🎯 Priorité & déclenchement

**CONTINGENCY** — Ne pas démarrer le dev sur cette US tant que :
1. L'US-2500-UI initial (Schedule-X) n'a pas atteint la phase recette/QA
2. Au moins un critère de déclenchement §🚨 n'est constaté et documenté
3. Décision tech-lead + PO de switcher est formalisée (document
   `docs/runbook/calendar-fallback-decision.md`)

Si aucun bloqueur n'est identifié pendant la recette → cette US reste
en `💤 Dormant` et peut être close en `wontfix` après go-live prod.

---

## 🔄 Lifecycle

```
💤 Dormant
   │
   │ (Schedule-X présente bloqueurs en recette)
   │
   ├──→ 🆕 À démarrer (issue GH créée, owner assigné)
   │
   │ (dev terminé)
   │
   └──→ ✅ DONE (Schedule-X désinstallé, custom déployé)

OU

💤 Dormant
   │
   │ (go-live prod sans bloqueur Schedule-X)
   │
   └──→ 🗑️ wontfix (close issue, archive spec)
```
