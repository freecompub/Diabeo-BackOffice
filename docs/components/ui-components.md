# Composants UI — Documentation

## Design System : Serenite Active

### Palette de couleurs

| Couleur | Hex | Usage |
|---------|-----|-------|
| Primaire (teal) | #0D9488 | Actions principales, liens, titres |
| Secondaire (corail) | #F97316 | Alertes, actions secondaires |
| Fond principal | #FAFAFA | Background pages |
| Fond secondaire | #F3F4F6 | Background cards |
| Texte principal | #1F2937 | Texte body |
| Texte secondaire | #6B7280 | Labels, descriptions |
| Glycemie normale | #10B981 | Vert emeraude — TIR in range |
| Glycemie haute | #F59E0B | Orange ambre — elevated |
| Glycemie critique | #EF4444 | Rouge — hypo/hyper severe |

### Architecture composants

```
src/components/
├── ui/              # shadcn/ui — NE PAS MODIFIER
│   └── button.tsx   # Composant shadcn genere
└── diabeo/          # Composants metier Diabeo (Phase 8)
```

### Regles d'accessibilite (WCAG 2.1)

- ARIA labels obligatoires sur tous les elements interactifs
- Contraste minimum 4.5:1 pour le texte normal
- Contraste minimum 3:1 pour le texte large
- Navigation clavier complete
- Messages d'erreur lies aux champs via `aria-describedby`

### Composants critiques (Phase 8 — a implementer)

| Composant | Usage | Exigences securite |
|-----------|-------|-------------------|
| GlycemiaChart | Graphique CGM temps reel | Pas de donnees patient dans le DOM |
| BolusCalculator | Formulaire calcul bolus | Validation clinique, warnings visibles |
| PatientCard | Carte resume patient | Donnees dechiffrees a la volee, pas de cache |
| AlertBanner | Alertes hypo/hyper | Interruption level critical pour iOS |
| AuditLogViewer | Consultation audit (admin) | Filtrage role, pas de PII dans les logs |
| LoginForm | Authentification | Rate limiting visible, MFA support |
| SessionTimeout | Deconnexion automatique | Timer visible, warning avant expiration |
| DataExportButton | Export RGPD | Confirmation, telechargement securise |

### Comportements en cas de donnees sensibles

- Les valeurs dechiffrees ne doivent JAMAIS etre stockees dans le state global
- Les composants affichant des PII doivent implementer un `useEffect` cleanup
- Les captures d'ecran et copier-coller doivent etre decourages (pas de `select-all`)
- Les champs NIR/INS sont masques par defaut (toggle pour afficher)
