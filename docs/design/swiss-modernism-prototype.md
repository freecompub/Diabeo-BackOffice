# Prototype Swiss Modernism 2.0 — Dashboard médecin

> Statut : **prototype design**, pas du code de production.
> Date : 2026-05-21
> Route preview : `/preview/medecin-swiss`
> Référence production : `/medecin` (style actuel Sérénité Active).

## Objectif

Comparer visuellement deux directions design sur la même page (dashboard
médecin) sans toucher au design system production. Ce prototype matérialise
l'**Alternative 2** des recommandations ui-ux-pro-max (cf. réponse 2026-05-17).

## Comment comparer

1. Démarrer le serveur dev : `pnpm dev`
2. Se connecter normalement (le prototype est hors middleware auth pour
   accessibilité directe en démo design)
3. Ouvrir dans 2 onglets côte à côte :
   - `http://localhost:3000/medecin` — production (Sérénité Active)
   - `http://localhost:3000/preview/medecin-swiss` — prototype Swiss

## Principes Swiss Modernism appliqués

| Principe | Implémentation |
|----------|----------------|
| Grille 12 col stricte | `grid-cols-12` partout, asymétries 7/5 ou 8/4 |
| Spacing mathématique 8px | gap-4 (16), gap-6 (24), gap-8 (32) — multiples |
| Typographie hiérarchique | Inter weight 300 (hero), 400 (body), 500 (sections) |
| Mathematical rationality | Sections numérotées (01, 02, 03, 04) |
| Monochrome + 1 accent | Noir #000 sur blanc #FFF, accent teal #0D9488 unique |
| No decorative shadows | Bordures fines 1px black/10 uniquement |
| High contrast WCAG AAA | Text #000 / #525252 sur #FFF |
| Glycemia clinical colors | **Préservés** (#991B1B/#F59E0B/#10B981) — patient safety |
| Tabular numbers | `tabular-nums` sur tous les chiffres alignés |
| Asymetric balance | 7/5 grids volontaires (vs 6/6 symétrique attendu) |

## Différences visuelles clés vs production

| Élément | Sérénité Active (prod) | Swiss Modernism (prototype) |
|---------|------------------------|------------------------------|
| Cards | Background coloré, ombres, padding 24 | Bordures fines, pas de bg, padding 32 |
| Titres | text-2xl semibold | text-[64px] font-light tracking-tight |
| Sections | Stacked vertical, équidistant | Numérotées 01/02/03, asymétrie 7/5 |
| Couleurs | Teal + corail + 9 grays | Noir + 1 accent + glycemia palette |
| Spacing | mix-and-match | Strict multiples de 8 (gap-4/6/8) |
| Métriques | Card colorée + icon | Number 56px font-light + barre verticale |
| Tableaux | shadcn `<Table>` complet | Grid 12 col avec bordures fines |

## Composants réutilisables créés

`src/components/diabeo/preview-swiss/swiss-layout.tsx` :

- `<SwissPage>` — container `max-w-[1440px]` + Inter font
- `<SwissHeader>` — h1 64px + meta aside asymétrique
- `<SwissSection>` — numéro 01/02 + titre + description + rule line
- `<SwissMetric>` — gros chiffre 56px font-light + delta tone
- `<SwissDataRow>` — ligne tabulaire 12 col avec severity border

## Trade-offs identifiés en construisant le prototype

### Avantages observés

- **Hiérarchie info renforcée** : numérotation sections + gros chiffres = scan
  rapide médecin (latence cognitive réduite).
- **Densité tabulaire** : les patients à suivre tiennent en 1 écran sans
  cards individuelles.
- **Print-friendly** : layout convertible PDF natif (utile rapports cabinet).
- **Lisibilité chiffres** : `tabular-nums` + font-light 56px = aucune confusion
  glucose 152 vs 132 (alignement vertical parfait).

### Inconvénients observés

- **Visuellement moins "doux"** : risque perception "froid administratif" par
  les patients (si même style utilisé sur app patient).
- **Demande discipline rigoureuse** : un padding cassé visible immédiatement.
- **Mobile <768px** : la grille 12 cols collapse en col-span-12 → perd
  l'asymétrie. Acceptable car backoffice = desktop-first.
- **Refonte coût** : ~5-8 jours pour adapter tout le backoffice
  (Sidebar, layout dashboard, patients list, patient detail × 4 tabs, charts).

## Recommandation post-prototype

**Option recommandée — Hybride** :

1. **Conserver** Sérénité Active comme design system (palette teal + glycemia
   clinique). Patient safety + brand reconnaissable.
2. **Adopter** sélectivement les principes Swiss sur composants data-dense :
   - Tableaux patients (`SwissDataRow` pattern → mode "compact" toggle)
   - Métriques KPI (`SwissMetric` pattern → grands chiffres tabular-nums)
   - Sections numérotées dans dashboards (lisibilité)
3. **Garder** les cards Sérénité Active sur :
   - Alertes urgences (visibilité émotionnelle nécessaire)
   - Patient detail header (info personnelle = card warm)

## Prochaines étapes proposées

- [ ] Faire valider le prototype en review équipe (médecins + design)
- [ ] Si validé : prototyper une 2e page (patient list ou patient detail)
- [ ] Si validé : extraire les patterns Swiss dans `src/components/diabeo/`
  comme primitives optionnelles (`<DataRow>`, `<NumberMetric>`)
- [ ] Si non retenu : supprimer `src/app/preview/medecin-swiss/` et
  `src/components/diabeo/preview-swiss/` + ce fichier

## Suppression du prototype

Si le prototype est rejeté ou intégré ailleurs :

```bash
rm -rf src/app/preview/medecin-swiss/
rm -rf src/components/diabeo/preview-swiss/
rm docs/design/swiss-modernism-prototype.md
```

Aucune autre dépendance — le prototype est entièrement isolé.
