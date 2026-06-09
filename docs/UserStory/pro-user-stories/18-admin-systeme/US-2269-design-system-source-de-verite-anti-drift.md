# US-2269 — Design system : source de vérité unique importable + garde anti-drift

> Garantir que le design system documenté dans `docs/design-system/` est
> **réellement appliqué partout** dans l'application, et le rendre **infalsifiable**
> dans le temps : une **source de tokens unique, typée, importée directement dans le
> code** (composants ET charts), d'où sont dérivés les variables CSS et la doc, plus
> un **gate CI anti-drift** qui interdit les couleurs en dur.

---

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2269` |
| **Domaine** | 18. Admin & Système (transverse — ingénierie front) |
| **Priorité** | **V1** |
| **Pays cible** | Universel |
| **Intégration externe** | Non |
| **Service / Standard** | Interne (Tailwind v4 `@theme`, W3C Design Tokens, ESLint) |
| **Statut** | 🆕 À démarrer |
| **Story points** | **5** (Fibonacci) — socle + gate ; migration des call-sites incrémentale |
| **Dépendances** | `docs/design-system/*` (tokens/colors/typography/components/patterns/accessibility), `src/app/globals.css` (`@theme`), pattern anti-drift existant `tests/unit/clinical-bounds.test.ts` |
| **Sprint cible** | À définir |
| **Owner** | — |

---

## 📋 Contexte métier

### Le problème : un design system documenté mais contourné

Le design system « Sérénité Active » est documenté (`docs/design-system/` : `tokens.md`,
`colors.md`, `typography.md`, `components.md`, `patterns.md`, `accessibility.md`) et
**partiellement tokenisé en code** (`src/app/globals.css`, Tailwind v4 `@theme`) :
la marque est aliasée (`--color-teal-*` → `--diabeo-primary-*`, `--color-coral-*` →
`--diabeo-secondary-*`) et les états glycémiques existent (`--color-glycemia-very-low…
very-high` + `*-bg`).

**Mais l'application contourne largement ces tokens** (audit `src/app` + `src/components/diabeo`) :

| Drift | Mesure (occurrences) | Exemple | Problème |
|---|---|---|---|
| **Couleurs hex en dur** | ~**80** | `#0D9488` (×19), `#10B981`, `#EF4444`, `#F59E0B`, `#6B7280` | surtout dans les **SVG/charts** (Recharts) — dupliquent la valeur des tokens : si la palette change, les graphes ne suivent pas |
| **Classes couleur Tailwind brutes** | ~**487** | `text-gray-900`, `text-red-600`, `bg-amber-50`, `text-emerald-600` | court-circuitent les tokens sémantiques (`text-foreground`, `text-muted-foreground`, `text-glycemia-critical`, `text-glycemia-high`) |

> Nuance : `bg-teal-600` / `text-teal-700` sont **acceptables** (teal/coral sont aliasés
> sur les tokens de marque). Le drift concerne les **hex bruts** et les **familles
> neutres/sémantiques non-token** (`gray/red/amber/emerald/orange/green/slate/zinc`).

### Conséquences
- **Incohérence visuelle** (nuances de gris/rouge divergentes selon les écrans).
- **Doc ≠ code** : aucune garantie que `docs/design-system/colors.md` corresponde aux
  valeurs réellement rendues → la doc devient mensongère (problème de conformité pour une
  app médicale, cf. exigence « documentation audit-ready »).
- **Changements de thème impossibles à propager** (re-branding, dark mode, contraste AA
  renforcé) : il faudrait éditer ~570 endroits à la main.
- **Accessibilité non garantie** : les paires couleur/fond ad-hoc ne sont pas validées
  contraste (WCAG 1.4.3).

### La réponse demandée : « un modèle designSystem importé directement dans le code »

Oui — c'est le bon réflexe anti-drift. On crée **une source de tokens unique** dont
**tout** dérive :

```
        src/design-system/tokens.ts   ← SOURCE DE VÉRITÉ UNIQUE (typée)
        (ou design-tokens.json, format W3C Design Tokens)
                 │
     ┌───────────┼───────────────────────────┐
     ▼           ▼                           ▼
 @theme CSS   export const tokens         docs/design-system/*
 (globals.css)  {brand, glycemia,         (colors.md, tokens.md)
  généré/        neutral, …}              généré / vérifié
  vérifié)       importé par les
                 composants & CHARTS
                 (Recharts lit du JS,
                  pas des classes CSS →
                  tue les hex en dur)
```

- Les **composants** continuent d'utiliser les classes Tailwind sémantiques
  (`text-foreground`, `bg-card`, `text-glycemia-critical`…) — ces classes pointent sur
  les variables `@theme` générées depuis la source.
- Les **charts/SVG** (qui ont besoin de valeurs JS, pas de classes) **importent** `tokens`
  (`tokens.glycemia.critical` au lieu de `#EF4444`).
- La **doc** est générée (ou vérifiée par test) depuis la source → ne peut plus diverger.

C'est le même esprit que `clinical-bounds.ts` (source unique + `tests/unit/clinical-bounds.test.ts`
qui empêche la dérive doc↔code) — on applique ce pattern, éprouvé, au design system.

---

## ✅ Critères d'acceptation

### AC-1 — Source de tokens unique, typée, importable

```gherkin
Scenario: une source canonique existe et est importable
  Given le module "src/design-system/tokens.ts" (ou design-tokens.json)
  Then il définit brand (primary/secondary), glycemia (very-low…very-high + bg),
       neutral/foreground/background, états (success/warning/danger), radii,
       typographie (familles, échelles), espacements
  And il exporte un objet "tokens" typé importable côté composant
  And il est l'UNIQUE endroit où ces valeurs sont écrites en dur
```

### AC-2 — Les variables CSS `@theme` dérivent de (ou sont vérifiées contre) la source

```gherkin
Scenario: globals.css ne diverge pas de la source
  Given la source de tokens et le bloc @theme de globals.css
  When la CI s'exécute
  Then un test assert que chaque token de la source = la variable CSS correspondante
  And toute divergence fait échouer la CI (gate anti-drift, comme clinical-bounds)
```

### AC-3 — Les charts/SVG importent les tokens (0 hex en dur dans les graphes)

```gherkin
Scenario: les couleurs des graphes proviennent des tokens
  Given les composants de charts (AGP, TIR, hypos, KPI…)
  Then ils importent "tokens" et utilisent tokens.glycemia.* / tokens.brand.*
  And aucune couleur hexadécimale littérale ne subsiste dans ces composants
```

### AC-4 — Gate de lint anti-drift (la dérive ne peut plus réapparaître)

```gherkin
Scenario: une couleur en dur fait échouer le lint
  Given une règle ESLint design-system
  When un développeur écrit un hex (#RRGGBB) dans un .tsx applicatif
       OU une classe couleur brute hors allowlist (ex. text-red-600)
  Then le lint échoue avec un message pointant vers le token à utiliser
  # Allowlist : tokens sémantiques + alias de marque (teal/coral). components/ui/ exclu.
```

### AC-5 — La doc design-system reflète la source (zéro drift doc↔code)

```gherkin
Scenario: la doc est synchronisée
  Given docs/design-system/colors.md (et tokens.md)
  Then ses valeurs sont générées depuis la source OU vérifiées par un test de parité
  And éditer une couleur dans la doc sans toucher la source (ou l'inverse) casse la CI
```

### AC-6 — Audit + plan de migration des call-sites

```gherkin
Scenario: l'écart est inventorié et résorbable par lots
  Given l'audit du drift (~80 hex + ~487 classes brutes)
  Then un rapport catégorise OK (marque) vs à corriger (neutres/sémantiques/hex)
  And la migration est planifiée par lots (par dossier/écran), gate activé en "warn"
       puis "error" une fois le socle migré
```

---

## 🛠️ Mécanique technique

- **Source** : `src/design-system/tokens.ts` exportant `tokens` (typé) **+** option
  `design-tokens.json` au format **W3C Design Tokens** (interopérable Figma/Style Dictionary).
- **Génération `@theme`** : un script `scripts/gen-theme.ts` (ou Style Dictionary) émet le
  bloc `@theme` de `globals.css` depuis la source ; en CI, `tests/unit/design-tokens.test.ts`
  assert source == `@theme` == valeurs `docs/design-system/colors.md` (parité, pattern
  `clinical-bounds`).
- **Charts** : remplacer les hex Recharts par `tokens.*` (helper `chartColors` dérivé des tokens).
- **Lint** : règle ESLint (custom `no-raw-colors`, ou `no-restricted-syntax` + plugin
  Tailwind) interdisant `#RRGGBB` et les familles couleur non-allowlistées dans `src/**` ;
  **exclut `src/components/ui/`** (shadcn auto-généré, déjà sur `var(--…)`, NE PAS modifier — CLAUDE.md).
- **Accessibilité** : la source encode des **paires validées contraste** (foreground/bg) ;
  un test peut calculer le ratio WCAG AA des paires de tokens (réf. `docs/design-system/accessibility.md`).

## 🔭 Hors périmètre (incrémental)
- Migration **exhaustive** des ~487 classes brutes en une PR : non — par lots (gate en
  `warn` d'abord). Le socle (source + `@theme` généré + charts + gate) est le MVP.
- `src/components/ui/` (shadcn) : exclu (auto-généré, interdit de modifier).
- Dark mode / re-theming : débloqué par cette US mais hors périmètre direct.

## 📈 Plan d'incréments
| Inc. | Contenu |
|---|---|
| **MVP** | `tokens.ts` source unique + génération/vérif `@theme` + test de parité doc↔code + migration des **charts** (0 hex) + règle ESLint en `warn`. |
| **V1.1** | Migration des call-sites par lots (neutres/sémantiques → tokens), passage du gate en `error`. |
| **V1.2** | Export `design-tokens.json` W3C + page de référence (Storybook/MDX) générée depuis la source ; check contraste WCAG AA automatisé. |
