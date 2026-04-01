# Typography -- Diabeo Design System

Typography in a medical application must prioritize readability, data clarity,
and information density. Healthcare professionals scan dashboards quickly --
type hierarchy must guide their eyes without ambiguity.

---

## Font Families

### Geist Sans (Primary)

The default font for all UI text. Geist is a clean, modern sans-serif designed
for user interfaces. It has excellent readability at small sizes and a
professional, clinical feel.

```
font-family: var(--diabeo-font-sans);
Tailwind:    font-sans
```

### Geist Mono (Numeric Data)

Used for glucose values, dosages, timestamps, and any tabular numeric data.
Monospaced numerals prevent layout shifts when values change and improve
scanability in data-dense contexts.

```
font-family: var(--diabeo-font-mono);
Tailwind:    font-mono
```

---

## Type Scale

The scale uses 14px as the base body size. This is smaller than the typical
16px web default, optimized for data-dense desktop dashboards where
healthcare professionals need to see more information simultaneously.

| Level | Size | Weight | Line Height | Tailwind | Usage |
|-------|------|--------|-------------|----------|-------|
| Display | 36px / 2.25rem | 700 | 1.25 | `text-4xl font-bold` | Dashboard hero KPIs |
| H1 | 30px / 1.875rem | 700 | 1.25 | `text-3xl font-bold` | Page titles |
| H2 | 24px / 1.5rem | 600 | 1.25 | `text-2xl font-semibold` | Section headings |
| H3 | 20px / 1.25rem | 600 | 1.375 | `text-xl font-semibold` | Card titles |
| H4 | 18px / 1.125rem | 600 | 1.375 | `text-lg font-semibold` | Subsection headings |
| Body | 14px / 0.875rem | 400 | 1.5 | `text-sm` | **Default body text** |
| Body Emphasized | 14px / 0.875rem | 500 | 1.5 | `text-sm font-medium` | Labels, navigation |
| Caption | 13px / 0.8125rem | 400 | 1.5 | `text-[0.8125rem]` | Descriptions |
| Small | 12px / 0.75rem | 400 | 1.5 | `text-xs` | Timestamps, hints |
| Micro | 11px / 0.6875rem | 500 | 1.25 | `text-[0.6875rem]` | Badges, pills |

---

## Usage Rules

### Headings

- Page titles use H1 (`text-3xl font-bold`). One per page.
- Section headings use H2 (`text-2xl font-semibold`).
- Card and widget titles use H3 (`text-xl font-semibold`).
- Never skip heading levels (H1 -> H3 without H2).

### Body Text

- Default body text is 14px. This is intentional for desktop dashboards.
- Use `font-medium` (500) for labels, navigation items, and form labels.
- Use `font-semibold` (600) for emphasized inline text.
- Never use `font-bold` (700) for body text -- reserve for headings and KPIs.

### Numeric Data

- Glucose values: `tabular-nums font-bold` -- always monospaced with bold weight.
- Dosages (insulin units): `tabular-nums font-semibold`.
- Percentages (TIR): `tabular-nums font-bold`.
- Timestamps: `text-xs text-muted-foreground`.
- Always use `tabular-nums` (or `font-mono`) for numbers that may update or appear in columns -- this prevents layout shifts.

### Clinical Text

- Alert titles: `text-sm font-semibold` with appropriate clinical color.
- Alert descriptions: `text-sm` with `text-foreground/80` for reduced emphasis.
- Clinical labels ("Hypo", "Hyper"): `text-xs font-medium` with clinical color.

---

## Line Heights

| Context | Line Height | Token |
|---------|-------------|-------|
| Headings | 1.25 | `--diabeo-leading-tight` |
| Subheadings | 1.375 | `--diabeo-leading-snug` |
| Body text | 1.5 | `--diabeo-leading-normal` |
| Long-form text | 1.625 | `--diabeo-leading-relaxed` |

Body text uses 1.5 line height minimum for readability, which exceeds the
WCAG 1.4.12 requirement of 1.5x the font size.

---

## Letter Spacing

| Context | Spacing | Token |
|---------|---------|-------|
| Display/H1 | -0.025em | `--diabeo-tracking-tight` |
| Body text | 0 | `--diabeo-tracking-normal` |
| Small caps, badges | 0.025em | `--diabeo-tracking-wide` |

---

## Accessibility Requirements

1. **Minimum size**: Never use text smaller than 11px (micro) in the application.
2. **Color contrast**: All text must meet WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text >=18px or >=14px bold).
3. **Resizability**: The application must remain usable when browser text is zoomed to 200%.
4. **Line length**: Body text should not exceed 80 characters per line for readability.
5. **Language**: Use `lang="fr"` on the HTML element. Clinical terms may use English abbreviations (TIR, CGM, ISF) that are standard in the medical field.
