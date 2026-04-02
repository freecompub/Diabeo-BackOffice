# Design Tokens -- Diabeo Design System

This document describes all design tokens used in the Diabeo BackOffice.
Tokens are defined as CSS custom properties in `src/styles/tokens.css` and
exposed to Tailwind CSS via the `@theme inline` directive in `globals.css`.

---

## Token Architecture

```
tokens.css (CSS custom properties)
    |
    v
globals.css (@theme inline { ... })
    |
    v
Tailwind utility classes (e.g., bg-teal-600, text-glycemia-normal)
    |
    v
React components (cn() utility for composition)
```

Tokens follow a three-tier naming convention:

1. **Raw tokens** (`--diabeo-primary-600`): Defined in `tokens.css`. Never use directly in components.
2. **Semantic tokens** (`--color-teal-600`): Mapped in `globals.css` `@theme inline`. Available as Tailwind classes.
3. **Component tokens**: Shadcn/ui variables (`--primary`, `--destructive`) that map to Diabeo colors.

---

## 1. Color Tokens

### Brand Colors

| Token | Value | Tailwind Class | Usage |
|-------|-------|----------------|-------|
| `--diabeo-primary-50` | `#F0FDFA` | `bg-teal-50` | Hover backgrounds |
| `--diabeo-primary-100` | `#CCFBF1` | `bg-teal-100` | Avatar backgrounds |
| `--diabeo-primary-200` | `#99F6E4` | `bg-teal-200` | Light accents |
| `--diabeo-primary-300` | `#5EEAD4` | `bg-teal-300` | Hover borders |
| `--diabeo-primary-400` | `#2DD4BF` | `bg-teal-400` | Decorative elements |
| `--diabeo-primary-500` | `#14B8A6` | `bg-teal-500` | Secondary actions |
| `--diabeo-primary-600` | `#0D9488` | `bg-teal-600` | **Primary actions, links, headings** |
| `--diabeo-primary-700` | `#0F766E` | `bg-teal-700` | Hover state for primary |
| `--diabeo-primary-800` | `#115E59` | `bg-teal-800` | Active state |
| `--diabeo-primary-900` | `#134E4A` | `bg-teal-900` | Dark backgrounds |
| `--diabeo-primary-950` | `#042F2E` | `bg-teal-950` | Darkest teal |

| Token | Value | Tailwind Class | Usage |
|-------|-------|----------------|-------|
| `--diabeo-secondary-500` | `#F97316` | `bg-coral-500` | **Secondary actions, alerts** |
| `--diabeo-secondary-600` | `#EA580C` | `bg-coral-600` | Hover state for secondary |
| (full scale 50-950) | | `bg-coral-*` | Various treatments |

### Clinical Colors -- Glycemia

| Token | Value | Tailwind Class | Clinical Meaning |
|-------|-------|----------------|------------------|
| `--diabeo-glycemia-very-low` | `#991B1B` | `text-glycemia-very-low` | <54 mg/dL (severe hypo) |
| `--diabeo-glycemia-low` | `#EF4444` | `text-glycemia-low` | 54-69 mg/dL (hypo) |
| `--diabeo-glycemia-normal` | `#10B981` | `text-glycemia-normal` | 70-180 mg/dL (in range) |
| `--diabeo-glycemia-high` | `#F59E0B` | `text-glycemia-high` | 181-250 mg/dL (hyper) |
| `--diabeo-glycemia-very-high` | `#EF4444` | `text-glycemia-very-high` | >250 mg/dL (severe hyper) |
| `--diabeo-glycemia-critical` | `#DC2626` | `text-glycemia-critical` | <40 or >400 mg/dL (danger) |

Each glycemia color has matching `-bg` and `-border` variants for backgrounds and borders.

### TIR Zone Colors

| Token | Value | Tailwind Class | Zone |
|-------|-------|----------------|------|
| `--diabeo-tir-very-low` | `#991B1B` | `bg-tir-very-low` | <54 mg/dL |
| `--diabeo-tir-low` | `#EF4444` | `bg-tir-low` | 54-69 mg/dL |
| `--diabeo-tir-in-range` | `#10B981` | `bg-tir-in-range` | 70-180 mg/dL |
| `--diabeo-tir-high` | `#F59E0B` | `bg-tir-high` | 181-250 mg/dL |
| `--diabeo-tir-very-high` | `#F97316` | `bg-tir-very-high` | >250 mg/dL |

### Pathology Colors

| Token | Value | Tailwind Class | Pathology |
|-------|-------|----------------|-----------|
| `--diabeo-dt1` | `#7C3AED` | `text-pathology-dt1` | Diabetes Type 1 |
| `--diabeo-dt2` | `#2563EB` | `text-pathology-dt2` | Diabetes Type 2 |
| `--diabeo-gd` | `#EC4899` | `text-pathology-gd` | Gestational Diabetes |

### Semantic Feedback

| Token | Value | Tailwind Class | Usage |
|-------|-------|----------------|-------|
| `--diabeo-success` | `#10B981` | `text-feedback-success` | Positive feedback |
| `--diabeo-warning` | `#F59E0B` | `text-feedback-warning` | Warnings |
| `--diabeo-error` | `#EF4444` | `text-feedback-error` | Errors |
| `--diabeo-info` | `#3B82F6` | `text-feedback-info` | Information |

---

## 2. Typography Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--diabeo-text-xs` | `0.75rem` (12px) | Labels, timestamps |
| `--diabeo-text-sm` | `0.8125rem` (13px) | Secondary text |
| `--diabeo-text-base` | `0.875rem` (14px) | **Default body text** |
| `--diabeo-text-md` | `1rem` (16px) | Emphasized body |
| `--diabeo-text-lg` | `1.125rem` (18px) | Subheadings |
| `--diabeo-text-xl` | `1.25rem` (20px) | Section titles |
| `--diabeo-text-2xl` | `1.5rem` (24px) | Page titles |
| `--diabeo-text-3xl` | `1.875rem` (30px) | Hero metrics |
| `--diabeo-text-4xl` | `2.25rem` (36px) | Dashboard KPIs |

Fonts: Geist Sans (body) and Geist Mono (code, numeric data).

---

## 3. Spacing Tokens

Based on a 4px base unit. All values in `rem`.

| Token | Value | Pixels |
|-------|-------|--------|
| `--diabeo-space-1` | `0.25rem` | 4px |
| `--diabeo-space-2` | `0.5rem` | 8px |
| `--diabeo-space-3` | `0.75rem` | 12px |
| `--diabeo-space-4` | `1rem` | 16px |
| `--diabeo-space-6` | `1.5rem` | 24px |
| `--diabeo-space-8` | `2rem` | 32px |
| `--diabeo-space-12` | `3rem` | 48px |
| `--diabeo-space-16` | `4rem` | 64px |

---

## 4. Border Radius Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--diabeo-radius-sm` | `0.25rem` | Small controls |
| `--diabeo-radius-md` | `0.5rem` | Buttons, inputs |
| `--diabeo-radius-lg` | `0.625rem` | Cards |
| `--diabeo-radius-xl` | `0.75rem` | Modals |
| `--diabeo-radius-2xl` | `1rem` | Large containers |
| `--diabeo-radius-full` | `9999px` | Pills, avatars |

---

## 5. Shadow Tokens

| Tailwind Class | Usage |
|----------------|-------|
| `shadow-diabeo-xs` | Default card elevation |
| `shadow-diabeo-sm` | Hover state elevation |
| `shadow-diabeo-md` | Elevated elements |
| `shadow-diabeo-lg` | Modals |
| `shadow-diabeo-xl` | Drawers |
| `shadow-diabeo-critical` | Critical alert glow |
| `shadow-diabeo-warning` | Warning alert glow |

---

## 6. Transition Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--diabeo-duration-fast` | `100ms` | Hover color changes |
| `--diabeo-duration-normal` | `200ms` | Standard transitions |
| `--diabeo-duration-slow` | `300ms` | Panel open/close |
| `--diabeo-duration-slower` | `500ms` | Page transitions |

---

## 7. Z-Index Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--diabeo-z-dropdown` | `10` | Dropdown menus |
| `--diabeo-z-sticky` | `20` | Sticky table headers |
| `--diabeo-z-header` | `30` | Main navigation header |
| `--diabeo-z-overlay` | `40` | Backdrop overlays |
| `--diabeo-z-modal` | `50` | Modal dialogs |
| `--diabeo-z-toast` | `70` | Toast notifications |
| `--diabeo-z-critical-alert` | `100` | Clinical alerts (always on top) |

---

## Adding New Tokens

1. Define the raw CSS property in `src/styles/tokens.css` with prefix `--diabeo-`
2. Map it to a Tailwind-consumable `--color-*` / `--shadow-*` property in `globals.css` `@theme inline`
3. Document it in this file
4. Use via Tailwind classes in components — never reference CSS vars directly
