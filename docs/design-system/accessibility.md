# Accessibility -- Diabeo Design System

The Diabeo BackOffice manages insulin therapy for diabetic patients.
Accessibility failures in a medical application can directly impact patient safety.
WCAG 2.1 AA compliance is the minimum standard. AAA is targeted where feasible.

---

## Compliance Target

| Standard | Level | Status |
|----------|-------|--------|
| WCAG 2.1 | AA | **Required** |
| WCAG 2.1 | AAA | Targeted for clinical components |
| ARIA 1.2 | Full | Required for interactive elements |
| Section 508 | Full | Required (US healthcare) |
| EN 301 549 | v3.2.1 | Required (EU public procurement) |

---

## 1. Perceivable

### 1.1 Color and Contrast

**Rule: Never use color as the sole means of conveying information** (WCAG 1.4.1)

This is critical for glycemia displays where green/amber/red communicate clinical status.

Required measures:
- Every `GlycemiaValue` component must support `showZoneLabel` to display a text label alongside the color
- The `AlertBanner` uses both color AND an icon to indicate severity
- Charts must include pattern fills or labels in addition to color coding
- The `ClinicalBadge` includes text, not just a colored dot

**Minimum contrast ratios** (WCAG 1.4.3 / 1.4.6):

| Element | AA Minimum | AAA Target | Diabeo Default |
|---------|-----------|------------|----------------|
| Body text (14px) | 4.5:1 | 7:1 | 11.5:1 (#1F2937 on #FAFAFA) |
| Large text (>=18px) | 3:1 | 4.5:1 | Varies by color |
| UI components | 3:1 | -- | 3.9:1 (teal-600 on white) |
| Focus indicators | 3:1 | -- | Teal-600 outline |

**Known contrast issues to monitor:**
- Teal-600 (#0D9488) on white: 3.9:1 -- passes AA for large text only
- Green (#10B981) on white: 3.0:1 -- use on green-50 background instead
- Amber (#F59E0B) on white: 2.5:1 -- always pair with text label

### 1.2 Text Alternatives

- All icons have `aria-hidden="true"` when decorative
- All icons have descriptive `aria-label` when functional
- Chart components provide `aria-label` with data summary
- Images (if any) require `alt` text
- SVG donut charts have `<title>` elements on segments

### 1.3 Adaptable Content

- Semantic HTML: `<main>`, `<nav>`, `<header>`, `<section>`, `<article>`
- Heading hierarchy: one `<h1>` per page, sequential levels
- Tables use `<th scope="col">` and `<th scope="row">`
- Forms use `<fieldset>` and `<legend>` for grouping
- Use `<time datetime="...">` for dates and durations

---

## 2. Operable

### 2.1 Keyboard Navigation

**All functionality must be operable via keyboard.**

| Key | Action |
|-----|--------|
| Tab | Move to next interactive element |
| Shift+Tab | Move to previous interactive element |
| Enter/Space | Activate buttons and links |
| Escape | Close modals, dropdowns, dismiss alerts |
| Arrow keys | Navigate within menus, tabs, lists |

Required implementation:
- Every `PatientCard` with `onClick` receives `tabIndex={0}` automatically (rendered as `<button>`)
- Focus order follows visual layout (DOM order matches visual order)
- No keyboard traps -- Escape always returns focus to the trigger
- Skip navigation link as first element in the page

### 2.2 Focus Management

- Visible focus indicator on all interactive elements: 2px solid teal-600 outline with 2px offset
- Focus is moved to modal content when modal opens
- Focus returns to trigger when modal closes
- `AlertBanner` with `role="alert"` announces automatically without stealing focus

### 2.3 Timing

- Session timeout warning appears 5 minutes before expiration
- Users can extend the session without losing data
- No time limits on form completion
- The `animate-clinical-pulse` animation respects `prefers-reduced-motion`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .animate-clinical-pulse { animation: none; }
  }
  ```

---

## 3. Understandable

### 3.1 Language

- Page language: `<html lang="fr">`
- Clinical abbreviations (TIR, CGM, ISF, ICR, HbA1c) are standard in French diabetology and do not require translation
- Tooltips provide expanded definitions on hover for non-obvious terms

### 3.2 Predictable Behavior

- Navigation is consistent across all pages (sidebar does not change)
- Components that look alike behave alike
- No unexpected context changes on focus or input
- Form submission requires explicit action (button click)

### 3.3 Error Prevention (Medical Context)

For clinical actions that affect patient care:

1. **Bolus calculations**: Results are displayed as suggestions, never auto-applied
2. **Insulin config changes**: Require DOCTOR role validation before activation
3. **Patient deletion**: Soft delete only, with confirmation dialog
4. **Data export**: Confirmation with scope description before download

Error messages must:
- Identify which field has the error
- Describe the error in plain language
- Suggest how to correct it
- Be linked to the field via `aria-describedby`

---

## 4. Robust

### 4.1 Compatible

- Valid HTML5 (no duplicate IDs, proper nesting)
- ARIA roles, states, and properties used correctly
- Components tested with screen readers (VoiceOver, NVDA)
- No reliance on browser-specific features

### 4.2 Status Messages

- Use `role="status"` for non-urgent updates (sync complete, save success)
- Use `role="alert"` for urgent messages (hypo/hyper detected)
- Use `aria-live="polite"` for informational updates
- Use `aria-live="assertive"` for critical clinical alerts

---

## Component-Specific Accessibility

### GlycemiaValue

- `aria-label` includes both the numeric value and the clinical zone name
- Critical values (<54 or >400 mg/dL) use `role="alert"` for immediate announcement
- Color is paired with zone label when `showZoneLabel` is enabled

### TirDonut

- `role="img"` on SVG with descriptive `aria-label`
- `aria-description` lists all zone percentages
- Each SVG segment has a `<title>` element
- Legend provides text fallback for all data

### AlertBanner

- Critical and hypo severities use `role="alert"` + `aria-live="assertive"`
- Info severity uses `role="status"` + `aria-live="polite"`
- Dismiss button has explicit `aria-label="Fermer l'alerte"`
- Pulsing animation disabled under `prefers-reduced-motion`

### PatientCard

- Rendered as `<button>` when interactive (keyboard accessible)
- `aria-label` includes patient name, pathology, and latest glucose
- Focus ring visible with 2px teal outline
- Inactive patients show a visible "Inactif" label

### StatCard

- `role="group"` with `aria-label` summarizing the metric
- Trend direction is communicated via `aria-hidden` icon + visible text
- Tabular-nums ensure consistent column alignment

---

## Testing Checklist

Before each release, validate:

- [ ] Keyboard-only navigation through all workflows
- [ ] Screen reader testing (VoiceOver on macOS, NVDA on Windows)
- [ ] Contrast ratios verified with browser DevTools or axe-core
- [ ] `prefers-reduced-motion` disables all non-essential animations
- [ ] `prefers-color-scheme: dark` renders readable (when dark mode shipped)
- [ ] Zoom to 200% -- layout remains usable
- [ ] Zoom to 400% -- content remains accessible (reflows without horizontal scroll)
- [ ] axe-core automated scan: zero violations
- [ ] No `tabIndex` values greater than 0
- [ ] All images/icons have appropriate alt text or aria-hidden

---

## Tools

| Tool | Purpose |
|------|---------|
| axe-core / @axe-core/react | Automated accessibility testing |
| Lighthouse | Audit score |
| WAVE | Visual accessibility checker |
| Color Oracle | Color blindness simulator |
| NVDA + Firefox | Screen reader testing (Windows) |
| VoiceOver + Safari | Screen reader testing (macOS) |
