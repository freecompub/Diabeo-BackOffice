# Typography -- Diabeo Design System

Typography in a medical application must prioritize readability, data clarity,
and information density. Healthcare professionals scan dashboards quickly --
type hierarchy must guide their eyes without ambiguity.

---

## Font Families

> **Editorial direction (adopted — code migration pending).** The "Home v3"
> mockups (`docs/mockups/home-roles-v3.html`, `home-patient-v2.html`) adopt an
> editorial type system: a serif for display, a humanist sans for UI, and a
> mono for numerics. This is the target direction. **The shipped app still runs
> Geist Sans / Geist Mono** (`src/app/layout.tsx`); the swap is gated on a
> webfont-performance check (three families is heavier than Geist's two — subset
> and self-host before shipping). Until then, treat Geist as the running
> fallback and the trio below as the design intent.

### Fraunces (Display / Headings)

A variable optical-size serif used for page titles, card titles (H2/H3), KPI
values, and the greeting. Fraunces gives the product a warmer, more human voice
than a pure UI sans while staying highly legible. Use weight **600** for
headings (700 reads too heavy at display sizes).

```
font-family: var(--diabeo-font-display);   /* "Fraunces", serif */
Tailwind:    font-display
```

### Hanken Grotesk (Primary / UI)

The default font for all UI text — body, labels, navigation, buttons. A humanist
grotesque with excellent readability at the 14px base size and a professional,
calm feel appropriate for a clinical tool.

```
font-family: var(--diabeo-font-sans);
Tailwind:    font-sans
```

### Spline Sans Mono (Numeric Data)

Used for glucose values, dosages, timestamps, percentages (TIR), and any tabular
numeric data. Monospaced tabular numerals prevent layout shifts when values
change and improve scanability in data-dense contexts.

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
| Display | 36px / 2.25rem | 600 | 1.25 | `font-display text-4xl font-semibold` | Dashboard hero KPIs |
| H1 | 30px / 1.875rem | 600 | 1.25 | `font-display text-3xl font-semibold` | Page titles |
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

- Headings and KPI values render in **Fraunces** (`font-display`) at weight
  **600** — not the UI sans. This is the one place the serif appears.
- Page titles use H1 (`text-3xl`, Fraunces 600). One per page.
- Section headings use H2 (`text-2xl`, Fraunces 600).
- Card and widget titles use H3 (`text-xl`, Fraunces 600).
- Never skip heading levels (H1 -> H3 without H2).

### Body Text

- Default body text is 14px. This is intentional for desktop dashboards.
- Use `font-medium` (500) for labels, navigation items, and form labels.
- Use `font-semibold` (600) for emphasized inline text.
- Never use `font-bold` (700) for body text.
- Headings, page titles and dashboard KPI values render in the **Fraunces
  display face** (`font-display`) at **600** (`font-semibold`) — the serif is
  loaded only at weight 600, so `font-bold`/700 would fall back. `font-bold`
  (700) stays reserved for inline numeric data in the mono face (below).

### Numeric Data

- **KPI / display values** (MetricCard, hero numbers) render in the Fraunces
  display face at `font-semibold` (600) — not 700 (serif is 600-only). The
  `MetricCard` value also carries `tabular-nums` (best-effort: the static
  Fraunces 600 cut may not expose `tnum`, so treat it as decorative there).
- Glucose values (inline, mono): `font-mono tabular-nums font-bold` -- Spline
  Sans Mono has genuine tabular figures; bold is available on the mono face.
- Dosages (insulin units): `font-mono tabular-nums font-semibold`.
- Percentages (TIR) inline: `font-mono tabular-nums font-bold` (mono). In a KPI
  card, the percentage follows the KPI rule above (Fraunces 600).
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
