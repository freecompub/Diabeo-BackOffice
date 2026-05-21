# Diabeo — Previews HTML statiques

3 pages HTML autonomes pour comparer visuellement les directions design,
sans avoir à lancer le serveur Next.js.

## Fichiers

| Fichier | Contenu |
|---------|---------|
| [`serenite-active.html`](serenite-active.html) | Style actuel **Sérénité Active** (production) — sidebar, KPIs colorés, cards teal/corail, glycemia palette |
| [`swiss-modernism.html`](swiss-modernism.html) | Prototype **Swiss Modernism 2.0** — grille 12 col, Inter, monochrome + accent, sections numérotées |
| [`compare.html`](compare.html) | Vue côte à côte (iframes) avec 4 layouts : side / stacked / A only / B only |

## Comment ouvrir

### Option 1 — Double-clic (le plus simple)

Ouvrir n'importe quel `.html` dans le navigateur via le file explorer.
Aucune install nécessaire — Tailwind est chargé via CDN, fonts via Google Fonts.

⚠️ La page `compare.html` charge les 2 autres dans des iframes : si tu ouvres
via `file://`, certains navigateurs (Chromium strict) peuvent bloquer.
Si problème : utiliser Option 2.

### Option 2 — Serveur local (recommandé pour `compare.html`)

```bash
cd docs/design/preview
python3 -m http.server 8000
# puis ouvrir http://localhost:8000/compare.html
```

Ou avec Node :
```bash
npx serve docs/design/preview
```

## Stack des previews

- **Tailwind CSS** via CDN (zéro build)
- **Inter** (Swiss) / **Figtree** (Sérénité Active) via Google Fonts
- **SVG icons inline** (pas d'emoji, lucide-style)
- **Mock data** inline — pas de fetch, pas de DB
- Aucune dépendance npm

## Ce que les previews montrent

### Sérénité Active (production actuelle)

- Sidebar 256px fixe gauche
- Header avec titre + actions (bell notifs, bouton primaire teal)
- 4 KPI cards équidistants (card blanc + ombre soft + icon coloré)
- Row Urgences + RDV (2 cards side-by-side, border gauche colorée par sévérité)
- Tableau patients à suivre (badges TIR colorés, hover gray-50)
- Footer minimal

### Swiss Modernism 2.0 (prototype)

- Pas de sidebar — focus contenu
- h1 64px font-light + meta asymmetric en haut à droite
- Sections numérotées 01/02/03/04 + rule line + description aside
- Asymétries 7/5 et 8/4 (vs 6/6 symétrique)
- Métriques en grand 56px font-light tabular-nums + barre verticale noire
- Tableaux grid-12 avec bordures fines (pas de cards), severity = border-left
- Palette glycemia clinique préservée (#991B1B/#F59E0B/#10B981) — patient safety
- Monochrome + 1 accent teal #0D9488 (brand Diabeo)

## Différences visuelles à observer

1. **Densité d'information** : Swiss tient ~15 patients/écran, Sérénité ~5
2. **Hiérarchie** : Swiss force le scan via numérotation et grands chiffres
3. **Émotion** : Sérénité est plus "warm" (couleurs, ombres), Swiss plus "rationnel"
4. **Print-friendly** : Swiss convertit nativement en PDF (rapports cabinet)
5. **Modernité** : Swiss = look 2025+ (Linear, Notion), Sérénité = look 2020-2023

## Quoi tester

- **Lisibilité chiffres** : compare la perception 312 mg/dL et 52 mg/dL
- **Scan rapide** : combien de temps pour trouver "patient critique" dans chaque ?
- **Densité** : combien de patients vois-tu sans scroller ?
- **Hiérarchie** : sans rien lire, quel est l'élément le plus important sur la page ?
- **Sensation globale** : quel style donne plus confiance pour un usage médical ?

## Si tu veux itérer

Les fichiers sont autonomes — modifier directement le HTML/CSS pour tester
des variantes (changer la palette, l'espacement, la typographie, etc.).
Aucun rebuild nécessaire, refresh navigateur suffit.

## Décision attendue

Après visualisation, 3 options :

1. **Garder Sérénité Active** sans changement — Swiss n'apporte rien
2. **Migrer 100% vers Swiss Modernism** — refonte design system complète (~5-8j dev)
3. **Hybride recommandé** — garder Sérénité comme système mais adopter patterns
   Swiss sur composants data-dense (tableaux, KPI, dashboards admin)

Voir `../swiss-modernism-prototype.md` pour les trade-offs détaillés.
