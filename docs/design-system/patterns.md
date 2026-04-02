# UI Patterns -- Diabeo Design System

Common UI patterns for the Diabeo BackOffice, designed for healthcare
professionals who need to monitor, analyze, and act on patient data efficiently.

---

## 1. Dashboard Layout

The main dashboard is organized into three zones:

```
+-------------------------------------------------------+
| Header (sticky)           [User] [Notifications] [?]  |
+----------+--------------------------------------------+
|          |                                             |
| Sidebar  |  Content Area                               |
| (nav)    |                                             |
|          |  +----------+ +----------+ +----------+     |
|          |  | StatCard | | StatCard | | StatCard |     |
|          |  +----------+ +----------+ +----------+     |
|          |                                             |
|          |  +-------------------+ +----------------+   |
|          |  | Patient List      | | TIR Donut      |   |
|          |  |                   | |                |   |
|          |  +-------------------+ +----------------+   |
|          |                                             |
+----------+--------------------------------------------+
```

### Grid System

- Use CSS Grid with `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
- StatCards fill 1 column each
- Wide widgets (charts, tables) span 2-3 columns with `col-span-2`
- Minimum card width: 280px
- Gap: `gap-4` (16px) between cards, `gap-6` (24px) between sections

---

## 2. Data Tables

Patient lists, audit logs, and CGM data are displayed in data tables.

### Structure

```tsx
<div className="rounded-xl border border-border bg-card shadow-diabeo-xs">
  {/* Header with filters */}
  <div className="flex items-center justify-between border-b border-border px-4 py-3">
    <h3 className="text-sm font-semibold">Mes patients</h3>
    <div className="flex items-center gap-2">
      {/* Search, filters, sort */}
    </div>
  </div>

  {/* Table */}
  <table className="w-full">
    <thead>
      <tr className="border-b border-border bg-muted/50">
        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
          Patient
        </th>
        {/* ... */}
      </tr>
    </thead>
    <tbody>
      {/* Rows */}
    </tbody>
  </table>

  {/* Pagination */}
  <div className="flex items-center justify-between border-t border-border px-4 py-3">
    {/* ... */}
  </div>
</div>
```

### Table Rules

- Sticky header on scroll (`sticky top-0 z-sticky`)
- Zebra striping: `even:bg-muted/30`
- Hover: `hover:bg-teal-50/50`
- Glucose columns use `GlycemiaValue` component
- Date columns use relative time ("Il y a 2h") with full date on hover
- Actions column: icon buttons with `aria-label`
- Never show more than 8 columns -- use expandable rows for detail

---

## 3. Forms

Medical forms require clear labeling, validation feedback, and logical grouping.

### Form Layout

```tsx
<form className="space-y-6">
  {/* Section */}
  <fieldset className="space-y-4">
    <legend className="text-lg font-semibold text-foreground">
      Configuration insuline
    </legend>

    {/* Field */}
    <div className="space-y-1.5">
      <label
        htmlFor="isf"
        className="text-sm font-medium text-foreground"
      >
        Facteur de sensibilite (ISF)
      </label>
      <input
        id="isf"
        type="number"
        className="..."
        aria-describedby="isf-help isf-error"
      />
      <p id="isf-help" className="text-xs text-muted-foreground">
        Bornes: 20-100 mg/dL/U
      </p>
      {/* Error state */}
      <p id="isf-error" className="text-xs text-feedback-error" role="alert">
        La valeur doit etre entre 20 et 100
      </p>
    </div>
  </fieldset>
</form>
```

### Form Rules

- Group related fields in `fieldset` with `legend`
- Every input has a visible `label` linked via `htmlFor`/`id`
- Help text below inputs via `aria-describedby`
- Error messages use `role="alert"` for screen reader announcement
- Clinical bounds displayed as help text (e.g., "Bornes: 20-100 mg/dL/U")
- Destructive actions require confirmation dialog
- Submit buttons are disabled during loading with `aria-busy="true"`

---

## 4. Charts and Visualizations

### CGM Time Series

- X-axis: time (24h or 7-day view)
- Y-axis: glucose mg/dL (or g/L)
- Background color bands for glycemia zones (green/amber/red)
- Target range highlighted with green band (70-180 mg/dL)
- Current reading emphasized with a pulsing dot
- Tooltip shows exact value + timestamp on hover

### TIR Display

- Use `TirDonut` component for single-patient view
- For patient lists, use a horizontal stacked bar (inline TIR)
- Show consensus targets in legend (>70% in range)
- Color zones must match `--diabeo-tir-*` tokens exactly

### Chart Accessibility

- Provide a text summary via `aria-label` or `aria-description`
- Include a data table alternative (screen reader fallback)
- Never rely on color alone -- use patterns or labels

---

## 5. Alerts and Notifications

### Alert Hierarchy

| Priority | Component | Behavior | z-index |
|----------|-----------|----------|---------|
| Critical | `AlertBanner` (severity=critical/hypo) | Pulsing, non-dismissible | `z-critical-alert` |
| Warning | `AlertBanner` (severity=warning/hyper) | Dismissible | `z-toast` |
| Info | `AlertBanner` (severity=info) | Dismissible | `z-toast` |
| Toast | Toast notification | Auto-dismiss 5s | `z-toast` |

### Placement

- Critical alerts: top of content area, full width, cannot scroll past
- Warning alerts: top of relevant section
- Toast notifications: bottom-right corner, stacked
- Never show more than 3 toasts simultaneously

---

## 6. Patient Detail Page

### Layout

```
+--------------------------------------------------------+
| < Back to patients    Marie Dupont    [DT1]    [Edit]  |
+--------------------------------------------------------+
|                                                         |
| +--AlertBanner (if hypo/hyper detected)---------------+ |
|                                                         |
| +-------+ +-------+ +-------+ +-------+                |
| |StatCard| |StatCard| |StatCard| |StatCard|            |
| |Glucose | |TIR    | |HbA1c  | |Bolus/j|              |
| +-------+ +-------+ +-------+ +-------+                |
|                                                         |
| +----------------------------+ +--------------------+   |
| | CGM Chart (7 days)         | | TIR Donut          |   |
| |                            | |                    |   |
| +----------------------------+ +--------------------+   |
|                                                         |
| +----------------------------+ +--------------------+   |
| | Insulin Config             | | Recent Events      |   |
| | ISF / ICR / Basal          | |                    |   |
| +----------------------------+ +--------------------+   |
+--------------------------------------------------------+
```

### Key Interactions

- Clicking a glucose value on the chart shows event context
- TIR donut period is selectable (7d, 14d, 30d, 90d)
- Insulin config shows read-only unless user is DOCTOR
- Events list is scrollable with infinite load

---

## 7. Empty States

When no data is available, show a clear empty state:

```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <svg className="h-12 w-12 text-muted-foreground/30 mb-4" ...>
    {/* Illustration icon */}
  </svg>
  <h3 className="text-sm font-semibold text-foreground">
    Aucune donnee CGM
  </h3>
  <p className="mt-1 text-sm text-muted-foreground max-w-sm">
    Les donnees apparaitront apres la premiere synchronisation
    du capteur de glycemie.
  </p>
</div>
```

---

## 8. Loading States

- Skeleton screens for initial page load (gray pulsing rectangles)
- Spinner for in-progress actions (teal color)
- Never block the entire page -- load sections independently
- Show stale data with a "mise a jour..." indicator rather than hiding content

---

## 9. Responsive Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Mobile | <768px | Single column, stacked cards |
| Tablet | 768-1024px | 2-column grid, collapsible sidebar |
| Desktop | 1024-1440px | 3-column grid, persistent sidebar |
| Wide | >1440px | 4-column grid, full sidebar |

The backoffice is primarily a desktop application, but must remain functional
on tablets for bedside consultation.
