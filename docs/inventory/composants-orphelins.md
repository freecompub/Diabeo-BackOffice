# Inventaire — Composants & pages UI orphelins

> **Objet** : recenser le code UI **exporté mais jamais monté** (composants) et les
> **pages/routes existantes mais sans lien entrant** (accessibles seulement en tapant
> l'URL). Sert de base pour décider : *câbler*, *mettre en conformité*, ou *supprimer*.
>
> **Généré le** : 2026-07-04 · **Méthode** : scan statique (`grep` des noms d'export /
> des chemins de route dans `src/`, hors fichier définissant, barrels `index.ts`, tests
> et backend `api/`). ⚠️ Un composant chargé dynamiquement (`next/dynamic`, string) ou
> une route liée par un `href` **construit** (template `/admin/${slug}`) peut être un
> faux positif — vérifier avant suppression.

---

## 1. Composants orphelins (exportés, jamais montés)

La plupart sont réexportés par le barrel `@/components/diabeo` (API publique de composants)
mais **aucune page/composant ne les importe**. Origine fréquente : socle **Phase 11 —
Web App Patient** (`8da436e`), livré avant les écrans qui devaient les consommer.

| Composant | Fichier | Descriptif | Route / contexte d'usage **prévu** | Barrel |
|---|---|---|---|---|
| `InsulinSummary` | `charts/InsulinSummary.tsx` | Donut **basal vs bolus** + carte total « X.X U » + légende %. Props = agrégats déjà calculés (`InsulinSummaryData`). | Vue **insulinothérapie côté patient** (`/patient/dashboard` ou futur `/patient/insulin*`) — **inexistante à ce jour**. | ✅ |
| `GlucoseCard` | `GlucoseCard.tsx` | Carte spécialisée pour **une** mesure de glycémie (valeur + zone colorée). | Dashboards (patient/pro) affichant la dernière glycémie. | ✅ |
| `GlucoseBadge` | `GlucoseBadge.tsx` | Badge compact d'une valeur glycémique, coloré par zone (`getGlycemiaZone`). | Listes / cartes où une glycémie doit tenir en un badge (ex. liste patients, carnet). | ✅ |
| `PatientCard` | `PatientCard.tsx` | Carte de résumé patient (nom déchiffré + méta). | Grille/liste patients (`/patients`), sélecteurs, dashboards équipe. | ✅ |
| `MetricLabel` | `MetricLabel.tsx` | Métrique compacte (libellé au-dessus, valeur en dessous) « lisible d'un coup d'œil ». | Widgets de dashboard, stat cards, panneaux de synthèse clinique. | ✅ |
| `DiabeoText` | `DiabeoText.tsx` | Composant **typographie** à variants (tokens « Sérénité Active »), enrobe les éléments sémantiques HTML. | Transverse — partout où l'on veut une typo tokenisée plutôt que des classes brutes. | ✅ |
| `ChartLoader` | `loaders/ChartLoader.tsx` | Skeleton de **chargement de graphe** (variants `line`/`agp`/`bars`/`donut`). | Fallback `Suspense`/état loading des charts (dashboards, `/patients/[id]`, `/analytics`). | à vérifier |
| `UploadLoader` | `loaders/UploadLoader.tsx` | Loader de **progression d'upload** (états `pending→uploading→scanning→encrypting→done→error`). | Flux d'upload de documents (`/documents`, `MedicalDocument` + ClamAV). | à vérifier |
| `PageLoader` / `InlinePageLoader` | `loaders/PageLoader.tsx` | Skeletons de page **Server-Only** (`async` + `getTranslations`) — ⚠️ ne peuvent PAS être enfants d'un Client Component. | `loading.tsx` de route / fallback `Suspense` serveur. | à vérifier |

**Note conformité design-system** : plusieurs de ces composants (au moins `InsulinSummary`)
sont **antérieurs au durcissement US-2269** et utilisent des classes brutes
(`text-gray-900/500`, `bg-gray-900`, `var(--color-teal-500)` en fill Recharts) — ils font
probablement partie des **267 violations** de la baseline anti-drift. À mettre en conformité
(tokens sémantiques / `@/design-system/tokens`) **avant** toute remise en service.

---

## 2. Pages / routes sans lien UI entrant

Ces routes **existent** (`page.tsx` présent) et ont, pour la plupart, un **backend API
fonctionnel**, mais **aucun `href` / `router.push` / `redirect` ni entrée de navigation**
ne pointe vers elles : elles ne sont atteignables qu'en tapant l'URL. À **câbler** (nav /
bouton) ou à statuer comme abandonnées.

| Route (UI) | Ce qu'elle fait (présumé) | Backend API | Statut |
|---|---|---|---|
| `/adjustment-proposals` | Liste des **propositions d'ajustement** de dose (accept/reject DOCTOR). | ✅ `api/adjustment-proposals/*` (GET, accept, reject, summary) | Page + API OK, **0 lien UI**. Sans doute destinée à devenir un onglet/section du dossier patient. |
| `/analytics/radar` | Vue **radar** analytique (sous-page de `/analytics`). | — | **0 lien UI** — pas d'onglet depuis `/analytics`. |
| `/events/new` | Création d'un **événement diabète** (`DiabetesEvent`). | — | **0 lien UI** — aucun bouton « nouvel événement » ne l'ouvre. |
| `/devices/pair` | **Appairage** d'un appareil patient (`PatientDevice`). | — | **0 lien UI** depuis `/devices`. |
| `/admin/system-health` | Tableau de bord **santé système** (ADMIN). | ✅ `api/admin/system-health` | **0 lien UI** — pas d'entrée dans la nav admin. |
| `/admin/tax-rules` | Gestion des **règles de TVA** (ADMIN, facturation). | — | **0 lien UI**. |
| `/admin/backups` | Gestion des **backups PostgreSQL** (ADMIN). | ✅ `api/admin/backups` (GET, POST) | **0 lien UI** — pas d'entrée dans la nav admin. |

> ⚠️ Les sous-pages **admin** sont souvent liées via un index qui construit ses liens à
> partir d'un tableau (`/admin/${section}`) — vérifier `src/app/(dashboard)/admin/**` et la
> sidebar admin avant de conclure à l'abandon.

---

## 3. Cas particulier — défini dans la nav mais non affiché

- **`/insulin-therapy`** (`navigation-items.tsx:76`, `labelKey: insulinTherapy`,
  `minRole: NURSE`) : l'entrée existe dans `navItems` **mais est absente de `SIDEBAR_ORDER`**
  (commentaire `:89` : ces items « rejoindront les onglets du dossier patient (US-2604) »).
  → La page pro `/insulin-therapy` n'est donc **pas surfacée** dans la sidebar ; l'insuline
  pro vit désormais dans l'onglet **Traitements** de `/patients/[id]` (câblé, réel).

---

## 4. Recommandations

1. **Trancher par lot** : pour chaque orphelin → *câbler* (le brancher à sa route cible),
   *conserver* (composant de socle réutilisable, ex. `DiabeoText`/loaders), ou *supprimer*
   (dette morte sans destinataire).
2. **Vue insuline patient** : `InsulinSummary` + `charts/*` Phase 11 sont le socle d'un
   écran insulinothérapie **patient** jamais construit — décider s'il est au backlog (US
   dédiée) ou à retirer. Voir la vue **pro** existante (`/patients/[id]` onglet Traitements).
3. **Conformité design-system** obligatoire avant toute remise en service (cf. §1).
4. **Ne rien supprimer sans confirmation** (règle projet) : ce fichier est un **inventaire**,
   pas une autorisation de suppression.

---

*Réviser cet inventaire après chaque nettoyage (câblage ou suppression). Méthode de scan
reproductible : voir le commit qui a introduit ce fichier.*
