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

### Composants implémentés (Phase 8)

| Composant | Fichier | Usage | Exigences securite |
|-----------|---------|-------|-------------------|
| Sidebar | `Sidebar.tsx` | Navigation (Dashboard, Patients, Users, Audit, Logout) | Active route highlight, disabled hover sur logout |
| DashboardHeader | `DashboardHeader.tsx` | Page title + notifications + settings | aria-label sur icones, read-only title |
| CgmChart | `CgmChart.tsx` | Graphique CGM recharts (line chart + target range) | Pas de donnees dans le DOM, sr-only data table |
| GlycemiaValue | `GlycemiaValue.tsx` | Affichage glycémie (valeur + couleur dynamique) | Couleur accessible: contraste 4.5:1 |
| TirDonut | `TirDonut.tsx` | Donut chart TIR (%) en range/hypo/hyper | Légende accessible, sr-only pourcentages |
| ClinicalBadge | `ClinicalBadge.tsx` | Badge alerte (hypo, hyper, info) | aria-label sur variantes alerte |
| PatientRow | `PatientRow.tsx` | Ligne table patients (glycemia color-coded) | Pathology icon accessible (aria-label) |
| LoginForm | `/login/page.tsx` | Authentification (email/password) | Rate limiting visible, password toggle |
| SessionTimeout | (future Phase 9) | Deconnexion automatique | Timer visible, warning avant expiration |
| BolusCalculator | (future Phase 3) | Formulaire calcul bolus | Validation clinique, warnings visibles |
| AlertBanner | (future Phase 3) | Alertes hypo/hyper | Interruption level critical |
| AuditLogViewer | (future Phase 3+) | Consultation audit (admin) | Filtrage role, pas de PII |
| DataExportButton | (future Phase 1+) | Export RGPD | Confirmation, telechargement securise |

### Comportements en cas de donnees sensibles

- Les valeurs dechiffrees ne doivent JAMAIS etre stockees dans le state global
- Les composants affichant des PII doivent implementer un `useEffect` cleanup
- Les captures d'ecran et copier-coller doivent etre decourages (pas de `select-all`)
- Les champs NIR/INS sont masques par defaut (toggle pour afficher)

---

## Hooks (Phase 8)

### `useAuth()` — Gestion authentification

```typescript
// src/hooks/useAuth.ts
// Retourne { user, login, logout, isLoading, isAuthenticated, error }

const { user, login, logout, isLoading } = useAuth()

// login(email, password) -> { success: bool, error?: string }
// logout() -> Promise<void>
// isAuthenticated: boolean
// user: { id, email, role, ... } | null
```

**Comportement:**
- Token JWT stocké en httpOnly cookie (sécurisé XSS)
- Refresh automatique si token expirant (via POST /api/auth/refresh)
- Redirect `/login` si token révoqué ou session expired
- Pas de sessionStorage/localStorage

**Usage dans pages:**
```tsx
'use client'
export default function DashboardPage() {
  const { user, isAuthenticated } = useAuth()
  if (!isAuthenticated) return null // Middleware prevents access
  return <Dashboard user={user} />
}
```

---

## Composants — Détails (Phase 8)

### Sidebar

```typescript
// src/components/diabeo/Sidebar.tsx
// Navigation principale avec logout

interface SidebarProps {
  currentPath?: string
  onLogout?: () => void
}
```

**Items de navigation:**
1. Dashboard (icon: home)
2. Patients (icon: users)
3. Users (icon: people, admin-only en Phase 3)
4. Audit (icon: log, admin-only en Phase 3)
5. Logout (icon: exit)

**Accessibilité:**
- `aria-current="page"` sur active link
- `aria-label` sur icones
- Navigation clavier complète (Tab, Enter)

### DashboardHeader

```typescript
// src/components/diabeo/DashboardHeader.tsx
// En-tête page avec titre et actions

interface DashboardHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  showNotifications?: boolean
}
```

**Contient:**
- Titre de page (h1)
- Subtitle optionnel (description)
- Notification bell (badge count en Phase 3)
- Settings icon dropdown (Phase 9)

### CgmChart

```typescript
// src/components/diabeo/CgmChart.tsx
// Graphique temps reel CGM avec target range

interface CgmChartProps {
  data: Array<{ timestamp: Date, value: number }>
  targetMin?: number  // mg/dL, default 70
  targetMax?: number  // mg/dL, default 180
  height?: number     // default 300
  loading?: boolean
}
```

**Fonctionnalités:**
- Line chart recharts (responsive)
- Zone verte (target range 70-180 mg/dL)
- Points rouges (hypo < 70 ou hyper > 250)
- sr-only data table pour screen readers
- Pas de donnees patients stockees dans le DOM

**Thresholds de couleur:**
- Vert: 70-180 mg/dL (TIR)
- Orange: 180-250 mg/dL (elevation)
- Rouge: < 70 ou > 250 mg/dL (critique)

### GlycemiaValue

```typescript
// src/components/diabeo/GlycemiaValue.tsx
// Affichage glycemie avec couleur dynamique

interface GlycemiaValueProps {
  value: number           // mg/dL
  unit?: 'mgdl' | 'gpl'   // default mg/dL
  size?: 'sm' | 'md' | 'lg' // text size
  showUnit?: boolean      // default true
  ariaLabel?: string
}
```

**Couleurs:**
- Vert (#10B981): 70-180 mg/dL
- Orange (#F59E0B): 180-250 mg/dL
- Rouge (#EF4444): < 70 ou > 250 mg/dL

### TirDonut

```typescript
// src/components/diabeo/TirDonut.tsx
// Donut chart pourcentages TIR

interface TirDonut {
  inRange: number        // % 70-180
  low: number           // % < 70
  high: number          // % > 250
  total: number         // 100
  showLegend?: boolean
}
```

**Segments:**
- Vert: TIR (in range)
- Orange: Elevation (180-250)
- Rouge: Critique (hypo < 70 + hyper > 250)

### ClinicalBadge

```typescript
// src/components/diabeo/ClinicalBadge.tsx
// Badge alerte clinique

type AlertLevel = 'hypo' | 'hyper' | 'critical' | 'info' | 'warning'

interface ClinicalBadgeProps {
  level: AlertLevel
  text: string
  ariaLabel?: string
}
```

**Variantes et couleurs:**
- `hypo` (red): Hypoglycémie < 70 mg/dL
- `hyper` (orange): Hyperglycémie > 250 mg/dL
- `critical` (red, bold): Alerte critique (intervention urgente)
- `info` (teal): Information (glycémie stable)
- `warning` (orange): Warning (tendance préoccupante)
