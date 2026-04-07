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

---

## Phase 11 — Foundation Library

Phase 11 introduced a comprehensive component library divided into **Atoms**, **Molecules**, **Organisms**, and **Feature Components**.

### Atoms

Minimal, single-responsibility components that form the building blocks.

| Component | Purpose | Key Props |
|-----------|---------|-----------|
| **DiabeoText** | Typography with design tokens | `variant` (displayLarge/displaySmall/headingLarge/headingMedium/headingSmall/bodyLarge/bodyMedium/bodySmall/labelLarge/labelMedium/captionSmall/chartAxis), `color` (primary/secondary/muted/error/success/warning), `as` (override HTML tag) |
| **DiabeoIcon** | Lucide icon wrapper with size variants | `name` (lucide icon), `size` (sm/md/lg/xl), `color` (optional) |
| **GlucoseBadge** | Color-coded glucose badge | `value` (number), `unit` (mg/dL/g/L/mmol/L), `variant` (filled/outlined) |
| **TrendIndicator** | Glucose trend arrow with label | `trend` (rising_fast/rising/stable/falling/falling_fast/unknown), `changePercent` (optional) |
| **MetricLabel** | Metric display label with optional value | `label` (string), `value` (string/number), `unit` (optional) |

### Molecules

Composed of atoms; handle single interaction patterns.

| Component | Purpose | Key Props |
|-----------|---------|-----------|
| **DiabeoButton** | Interactive button with variants | `variant` (diabeoPrimary/diabeoSecondary/diabeoTertiary/diabeoDestructive/diabeoGhost), `size` (sm/default/lg/icon), `loading` (boolean), `icon` (ReactNode), `fullWidth` (boolean) |
| **DiabeoTextField** | Text input with label, error, password toggle | `label` (string), `error` (string), `type` (default: text), `showPasswordToggle` (boolean), `disabled` (boolean) |
| **DiabeoToggle** | Switch component with label | `label` (string), `subtitle` (optional), `checked` (boolean), `onChange` (function) |
| **DiabeoFormSection** | Fieldset grouping with legend | `title` (string), `description` (optional), `children` (ReactNode) |
| **DiabeoReadonlyField** | Read-only display field | `label` (string), `value` (string), `icon` (optional) |

### Organisms

Complex, multi-component compositions for major sections.

| Component | Purpose | Key Props |
|-----------|---------|-----------|
| **DiabeoCard** | Base card with elevation variants | `variant` (elevated/filled/outlined), `children` (ReactNode), `className` (optional) |
| **GlucoseCard** | Glucose reading with trend + timestamp | `value` (number in mg/dL), `unit` (mg/dL/g/L/mmol/L), `trend` (glucose trend), `timestamp` (Date), `source` (device label) |
| **MetricCard** | Health metric with trend + status badge | `label` (string), `value` (string/number), `unit` (optional), `trend` (up/down/stable), `status` (normal/warning/critical) |
| **DiabeoEmptyState** | Full-screen empty state | `type` (noData/noSearchResults/error/insufficientData), `title` (string), `description` (optional), `action` (optional ReactNode) |
| **DiabeoFAB** | Floating action button | `icon` (ReactNode), `label` (string), `onClick` (function), `variant` (default/danger/success) |

### Feature Components

Purpose-specific components for clinical workflows.

| Component | Purpose | Key Props |
|-----------|---------|-----------|
| **PeriodSelector** | Time period picker (1W/2W/1M/3M) | `selectedPeriod` (TimePeriod enum), `onPeriodSelected` (function), `className` (optional) |
| **NavigationShell** | App layout with sidebar, header, breadcrumbs | `children` (ReactNode), `pageTitle` (string), `pageSubtitle` (optional), `breadcrumbs` (array), `userRole` (RBAC), `userName` (optional), `onRefresh` (optional) |
| **CgmChart** | Glucose line chart with insulin bars + event markers | `cgmData` (CGM entries), `events` (optional), `displayOptions` (show/hide glucose values/insulin), `timeRange` (date range) |
| **ChartSummary** | Aggregate CGM statistics display | `data` (stats object), `metric` (avg/min/max/std-dev) |
| **HypoglycemiaCounter** | Hypo event count widget with severity | `count` (number), `severity` (normal/elevated/critical) |
| **InsulinSummary** | Total daily insulin display | `basal` (number), `bolus` (number), `unit` (U) |
| **TimeInRangeChart** | TIR percentage visualization | `data` (TirData), `target` (number) |
| **DataSummaryGrid** | 3x2 responsive grid of metric widgets | `metrics` (array of MetricCard props), `educationalPopovers` (optional) |

---

## Accessibility & Internationalization

All Phase 11 components:

- Use semantic HTML (`<h1>`–`<h4>` for headings, `<p>` for text, etc.)
- Include ARIA labels on interactive elements
- Support keyboard navigation (Tab, Enter, Space)
- Announce state changes to screen readers (`aria-selected`, `aria-busy`, `role="alert"`)
- Support RTL layouts via CSS logical properties (Flexbox, margin-inline, etc.)
- Use `next-intl` for translations with `useTranslations("namespace")`

---

## Component Guidelines

### Creating New Components

1. Place the file in `src/components/diabeo/`
2. Use `"use client"` directive (components use browser APIs for accessibility)
3. Import `cn` from `@/lib/utils` for class merging
4. Accept a `className` prop for composition
5. Add `aria-label` on all interactive elements
6. Export from `index.ts` barrel file
7. Document in this file (update component inventory and add usage example)

### Prohibited Patterns

- Never store decrypted patient data in `useState` or global state
- Never render patient identifiers (NIR, INS) without masking
- Never use `console.log` with patient data
- Never modify files in `src/components/ui/` (shadcn auto-generated)

### Translation Keys

All user-facing text must use `useTranslations()` from next-intl. Common namespaces:

- `"common"` — generic labels (Save, Cancel, Loading, etc.)
- `"period"` — PeriodSelector options (oneWeek, twoWeeks, oneMonth, threeMonths)
- `"nav"` — NavigationShell items (dashboard, patients, medications, analytics, documents, users)
- `"clinical"` — clinical terminology (hypo, hyperglycemia, TIR, etc.)
- `"errors"` — error messages and descriptions
- `"validation"` — form field validation messages
