# Components -- Diabeo Design System

All Diabeo-specific components live in `src/components/diabeo/`.
They are built on top of shadcn/ui primitives and follow the "Serenite Active" palette.

Import all components from the barrel export:
```typescript
import { GlycemiaValue, PatientCard, AlertBanner } from "@/components/diabeo"
```

---

## Component Inventory

| Component | File | Purpose |
|-----------|------|---------|
| GlycemiaValue | `GlycemiaValue.tsx` | Displays glucose reading with clinical color coding |
| TirDonut | `TirDonut.tsx` | Time In Range donut chart (5 zones) |
| AlertBanner | `AlertBanner.tsx` | Medical alert banner (hypo/hyper/critical) |
| PatientCard | `PatientCard.tsx` | Patient summary card with key metrics |
| StatCard | `StatCard.tsx` | Dashboard metric card with trend indicator |
| ClinicalBadge | `ClinicalBadge.tsx` | Badge for pathology, quality, or status |

---

## GlycemiaValue

Displays a glucose value with automatic clinical color coding based on
international consensus thresholds.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` | required | Glucose value in mg/dL |
| `unit` | `"mg/dL" \| "g/L" \| "mmol/L"` | `"mg/dL"` | Display unit |
| `thresholds` | `GlycemiaThresholds` | consensus defaults | Custom patient thresholds |
| `size` | `"sm" \| "md" \| "lg" \| "xl"` | `"md"` | Text size variant |
| `showUnit` | `boolean` | `true` | Show unit label |
| `showZoneLabel` | `boolean` | `false` | Show zone name (e.g., "Normal") |
| `showBackground` | `boolean` | `false` | Show colored background pill |

### Usage

```tsx
// Basic usage
<GlycemiaValue value={120} />

// With patient-specific thresholds (gestational diabetes)
<GlycemiaValue
  value={95}
  thresholds={{ low: 60, high: 140, veryHigh: 200 }}
  showZoneLabel
/>

// Large display for dashboard hero
<GlycemiaValue value={185} size="xl" showBackground />

// Different unit
<GlycemiaValue value={120} unit="g/L" />
```

### Color Zones

| Zone | Range (mg/dL) | Color | Behavior |
|------|---------------|-------|----------|
| very-low | <54 | Dark Red | `role="alert"`, pulsing |
| low | 54-69 | Red | -- |
| normal | 70-180 | Green | -- |
| high | 181-250 | Amber | -- |
| very-high | >250 | Red | -- |
| critical | >400 | Red | `role="alert"`, pulsing |

### Exported Utility

```typescript
import { getGlycemiaZone } from "@/components/diabeo"

const zone = getGlycemiaZone(185) // returns "high"
const zone = getGlycemiaZone(45)  // returns "very-low"
```

---

## TirDonut

SVG donut chart showing Time In Range distribution across 5 clinical zones.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `TirData` | required | Percentages for 5 zones (must sum to 100) |
| `size` | `number` | `160` | Diameter in pixels |
| `strokeWidth` | `number` | `20` | Ring thickness |
| `showCenterLabel` | `boolean` | `true` | Show "X% dans la cible" in center |
| `showLegend` | `boolean` | `true` | Show zone legend below |

### Usage

```tsx
<TirDonut
  data={{
    veryLow: 1,
    low: 3,
    inRange: 72,
    high: 19,
    veryHigh: 5,
  }}
/>
```

### TIR Data Interface

```typescript
interface TirData {
  veryLow: number   // % <54 mg/dL — target: <1%
  low: number        // % 54-69 — target: <4%
  inRange: number    // % 70-180 — target: >70%
  high: number       // % 181-250 — target: <25%
  veryHigh: number   // % >250 — target: <5%
}
```

---

## AlertBanner

Medical-grade alert banner designed to be impossible to miss for critical situations.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `severity` | `"info" \| "warning" \| "critical" \| "hypo" \| "hyper"` | required | Alert severity |
| `title` | `string` | required | Alert heading |
| `description` | `string` | -- | Detail text |
| `glucoseValue` | `number` | -- | Optional glucose value to display |
| `glucoseUnit` | `string` | `"mg/dL"` | Unit label |
| `dismissible` | `boolean` | `false` | Show dismiss button |
| `onDismiss` | `() => void` | -- | Dismiss callback |

### Usage

```tsx
// Critical hypoglycemia alert
<AlertBanner
  severity="hypo"
  title="Hypoglycemie detectee"
  glucoseValue={52}
  description="Valeur inferieure au seuil critique. Verifier le patient."
/>

// Informational
<AlertBanner
  severity="info"
  title="Synchronisation terminee"
  description="Les donnees CGM des 7 derniers jours sont a jour."
  dismissible
  onDismiss={() => setVisible(false)}
/>
```

### Severity Behavior

| Severity | Color | ARIA Role | Announcement | Animation |
|----------|-------|-----------|-------------|-----------|
| info | Blue | status | polite | none |
| warning | Amber | alert | assertive | none |
| critical | Red | alert | assertive | pulsing + shadow |
| hypo | Red | alert | assertive | pulsing + shadow |
| hyper | Amber | alert | assertive | none |

---

## PatientCard

Compact patient summary card for dashboard and list views.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `string` | required | Patient name (pre-decrypted) |
| `pathology` | `Pathology` | required | DT1, DT2, or GD |
| `age` | `number` | -- | Patient age |
| `latestGlucose` | `number` | -- | Latest reading in mg/dL |
| `glucoseUnit` | `string` | `"mg/dL"` | Display unit |
| `tirPercentage` | `number` | -- | TIR percentage (0-100) |
| `lastSync` | `Date` | -- | Last device sync |
| `isActive` | `boolean` | `true` | Active status |
| `onClick` | `() => void` | -- | Navigation handler |

### Usage

```tsx
<PatientCard
  name="Marie Dupont"
  pathology="DT1"
  age={34}
  latestGlucose={142}
  tirPercentage={74}
  lastSync={new Date("2026-04-01T10:30:00")}
  onClick={() => router.push(`/patients/${id}`)}
/>
```

### Security Note

This component receives already-decrypted data. The parent component is responsible for:
1. Decrypting patient data via the `patient.service`
2. Passing plain text values as props
3. Not caching decrypted data in global state

---

## StatCard

Dashboard metric card with optional trend indicator.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | required | Metric label |
| `value` | `string \| number` | required | Display value |
| `unit` | `string` | -- | Unit suffix |
| `trend` | `"up" \| "down" \| "stable"` | -- | Trend direction |
| `trendValue` | `string` | -- | Trend description |
| `trendIsPositive` | `boolean` | -- | Whether trend is good |
| `variant` | `"default" \| "teal" \| "success" \| "warning" \| "critical"` | `"default"` | Border accent |
| `icon` | `ReactNode` | -- | Icon element |

### Usage

```tsx
<StatCard
  label="TIR moyen"
  value={72}
  unit="%"
  trend="up"
  trendValue="+3% vs semaine derniere"
  trendIsPositive={true}
  variant="success"
/>

<StatCard
  label="HbA1c estimee"
  value="7.2"
  unit="%"
  trend="down"
  trendValue="-0.3 sur 3 mois"
  trendIsPositive={true}
  variant="teal"
/>
```

---

## ClinicalBadge

Non-interactive badge for clinical classifications.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `"pathology" \| "quality" \| "status"` | required | Badge category |
| `value` | `string` | required | Badge value |

### Usage

```tsx
// Pathology badges
<ClinicalBadge type="pathology" value="DT1" />  // Violet "Type 1"
<ClinicalBadge type="pathology" value="DT2" />  // Blue "Type 2"
<ClinicalBadge type="pathology" value="GD" />   // Pink "Gestationnel"

// Quality badges (based on TIR)
<ClinicalBadge type="quality" value="excellent" />  // Green dot
<ClinicalBadge type="quality" value="poor" />       // Red dot

// Generic status
<ClinicalBadge type="status" value="En attente" />
```

---

## Component Guidelines

### Creating New Components

1. Place the file in `src/components/diabeo/`
2. Use `"use client"` directive (components use browser APIs for accessibility)
3. Import `cn` from `@/lib/utils` for class merging
4. Accept a `className` prop for composition
5. Add `aria-label` on all interactive elements
6. Export from `index.ts` barrel file
7. Document in this file

### Prohibited Patterns

- Never store decrypted patient data in `useState` or global state
- Never render patient identifiers (NIR, INS) without masking
- Never use `console.log` with patient data
- Never modify files in `src/components/ui/` (shadcn auto-generated)
