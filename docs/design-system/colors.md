# Color Palette -- Diabeo Design System

Palette name: **Serenite Active**

The color system is purpose-built for a medical-grade healthcare application.
Every color choice prioritizes clarity, accessibility, and clinical accuracy.

---

## Design Principles

1. **Clinical accuracy first**: Glycemia colors (green/amber/red) follow international diabetes consensus. Never repurpose them for non-clinical meanings.
2. **High contrast**: All text/background combinations meet WCAG 2.1 AA minimum (4.5:1 for body text, 3:1 for large text).
3. **Semantic consistency**: The same color always means the same thing across the entire application.
4. **Restraint**: The palette is intentionally limited. Most of the UI is neutral gray. Color is reserved for meaning.

---

## Brand Colors

### Primary -- Teal (#0D9488)

Used for: primary buttons, active links, selected states, headings, navigation accents.

The teal conveys trust, calm, and professionalism -- appropriate for a medical application without being as cold as a pure blue.

| Shade | Hex | Contrast on White | Contrast on #1F2937 | Usage |
|-------|-----|-------------------|---------------------|-------|
| 50 | `#F0FDFA` | -- | -- | Subtle hover bg |
| 100 | `#CCFBF1` | -- | -- | Avatar bg, highlights |
| 200 | `#99F6E4` | -- | -- | Light accents |
| 300 | `#5EEAD4` | 1.8:1 | -- | Decorative only |
| 400 | `#2DD4BF` | 2.2:1 | -- | Decorative only |
| 500 | `#14B8A6` | 2.8:1 | -- | Icons on dark bg |
| **600** | **#0D9488** | **3.9:1** | -- | **Primary -- large text, icons** |
| 700 | `#0F766E` | 5.3:1 | -- | Primary hover, body text OK |
| 800 | `#115E59` | 7.5:1 | -- | High contrast text |
| 900 | `#134E4A` | 9.3:1 | -- | Very dark text |
| 950 | `#042F2E` | 14.7:1 | -- | Near-black |

**Note**: Teal-600 (#0D9488) has a 3.9:1 contrast ratio against white. This passes WCAG AA for large text (>=18px or >=14px bold) but NOT for small body text. For body text on white backgrounds, use teal-700 or darker.

### Secondary -- Coral (#F97316)

Used for: secondary action buttons, attention-drawing elements, non-clinical warnings.

| Shade | Hex | Contrast on White | Usage |
|-------|-----|-------------------|-------|
| 500 | `#F97316` | 2.8:1 | Large icons/text only |
| 600 | `#EA580C` | 3.5:1 | Large text, icons |
| 700 | `#C2410C` | 4.9:1 | Body text OK |

**Note**: Coral is used sparingly. It must never be confused with clinical red (glycemia alerts).

---

## Clinical Colors -- Glycemia

These colors have fixed, universal meaning throughout the application. They MUST NOT be used for non-glycemia purposes.

| Zone | Color | Hex | Contrast | Clinical Meaning |
|------|-------|-----|----------|-----------------|
| Very Low | Dark Red | `#991B1B` | 9.0:1 | <54 mg/dL -- severe hypoglycemia, immediate action |
| Low | Red | `#EF4444` | 3.9:1 | 54-69 mg/dL -- hypoglycemia, attention needed |
| Normal | Green | `#10B981` | 3.0:1 | 70-180 mg/dL -- in range, target zone |
| High | Amber | `#F59E0B` | 2.5:1 | 181-250 mg/dL -- hyperglycemia, monitoring |
| Very High | Red | `#EF4444` | 3.9:1 | >250 mg/dL -- severe hyperglycemia |
| Critical | Red | `#DC2626` | 4.6:1 | <40 or >400 mg/dL -- life-threatening |

### Contrast Considerations

Some glycemia colors (especially green #10B981 and amber #F59E0B) have low contrast against white. To ensure accessibility:

- Use them as colored text on their matching light background (e.g., green text on `#ECFDF5`)
- Always pair with a text label -- never use color alone to convey meaning
- The `GlycemiaValue` component handles this automatically with `showZoneLabel`

---

## Pathology Badge Colors

| Pathology | Color | Hex | Background |
|-----------|-------|-----|------------|
| DT1 (Type 1) | Violet | `#7C3AED` | `#F5F3FF` |
| DT2 (Type 2) | Blue | `#2563EB` | `#EFF6FF` |
| GD (Gestational) | Pink | `#EC4899` | `#FDF2F8` |

These are used exclusively in the `ClinicalBadge` component for pathology identification.

---

## Neutral Palette

The neutral palette (gray) is used for text, borders, backgrounds, and structural elements.

| Shade | Hex | Usage |
|-------|-----|-------|
| 50 | `#FAFAFA` | Page background |
| 100 | `#F3F4F6` | Card secondary bg, muted elements |
| 200 | `#E5E7EB` | Borders, dividers, input borders |
| 300 | `#D1D5DB` | Disabled borders |
| 400 | `#9CA3AF` | Placeholder text |
| 500 | `#6B7280` | Secondary text, labels |
| 600 | `#4B5563` | Tertiary headings |
| 700 | `#374151` | Secondary headings |
| 800 | `#1F2937` | **Primary text** |
| 900 | `#111827` | Strongest text |

---

## Warm Surfaces (Editorial direction)

> **Adopted — code migration pending** (same status as the typography switch).
> The "Home v3" mockups replace the cool neutral *surfaces and ink* with a warm,
> paper-toned set. This affects **only** backgrounds, ink, and structural lines.
> Clinical glycemia colors, pathology badges, feedback colors, and the teal/coral
> brand are **unchanged** — they keep their exact meaning and values.

| Token | Hex | Replaces | Usage |
|-------|-----|----------|-------|
| `--diabeo-paper` | `#FAFAF7` | neutral-50 `#FAFAFA` | Page background |
| `--diabeo-paper-2` | `#F4F2EC` | neutral-100 `#F3F4F6` | Card secondary bg, muted fills |
| `--diabeo-surface` | `#FFFFFF` | white | Cards, panels |
| `--diabeo-ink` | `#1A2A2E` | neutral-800 `#1F2937` | Primary text |
| `--diabeo-ink-soft` | `#586A6B` | neutral-500 `#6B7280` | Secondary text |
| `--diabeo-ink-faint` | `#9AA8A6` | neutral-400 `#9CA3AF` | Hints, placeholders |
| `--diabeo-line` | `#E7E4DB` | neutral-200 `#E5E7EB` | Borders, dividers |
| `--diabeo-line-soft` | `#EFEDE6` | — | Subtle inner dividers |

These warm-paper/ink values are the **single source of truth** shared by both
mockups (`home-roles-v3.html` and `home-patient-v2.html`). The earlier patient
mockup used a browner variant (`#FAF8F4` / `#22201C`); it was reconciled to the
values above so the editorial language is identical across roles.

---

## Role Accent Colors

The Home dashboards differentiate user spaces with a per-role accent. The accent
drives **only** chrome that carries no clinical meaning: active nav state, the
greeting highlight, avatar tint, primary buttons, and section focus rings.

> **Rule — accents never override meaning.** A role accent must never be used
> for glycemia zones, pathology badges, or feedback (success/warn/error). Those
> keep their fixed semantic colors regardless of the active role. Color reserved
> for meaning still wins (WCAG 1.4.1 + clinical-accuracy principle above).

| Role | `--accent` (text) | `--accent-brand` (fill) | `--accent-soft` (bg) | `--accent-line` |
|------|------|------|------|------|
| DOCTOR (`medecin`) | `#0F766E` | `#0D9488` | `#F0FDFA` | `#CCFBF1` |
| NURSE (`nurse`) | `#2E4C84` | `#3E63A8` | `#EEF3FB` | `#D5E0F2` |
| ADMIN (`admin`) | `#2B3B41` | `#33474E` | `#EEF1F2` | `#D7DEDF` |
| PATIENT (`patient`) | `#0F766E` | `#0D9488` | `#F0FDFA` | `#CCFBF1` |

### Collision fixes (vs the v2 mockup)

- **NURSE** was `#1D6F8B` in v2 — that **is** the `--info` color, and it sat
  close to DT2 pathology blue (`#2563EB`). Moved to a muted indigo (`#3E63A8`)
  that is distinct from both info-teal and DT2 royal-blue.
- **PATIENT** was coral-dominant in v2. Coral is the non-clinical secondary and
  must never read as a clinical signal, so the patient space is now
  **teal-dominant** and coral is demoted to alert/accent only.
- DOCTOR and PATIENT intentionally share teal — they are different spaces (staff
  vs self-service), never shown side by side.

> ⚠️ **Validation pending before code adoption (2b).** The NURSE indigo
> (`#3E63A8` on warm paper, `#2E4C84` for text) must be checked for WCAG AA
> contrast and validated under protanopia/deuteranopia simulators — it sits in a
> hue range near several other blues in the palette.

---

## Usage Rules

1. **Never use color as the sole indicator**: Always pair with an icon, label, or pattern. (WCAG 1.4.1)
2. **Never mix clinical and non-clinical color meanings**: Green means "in range," not "success." Amber means "elevated," not "warning."
3. **Critical alerts use pulsing animation**: The `animate-clinical-pulse` class draws attention without relying on color alone.
4. **Dark mode**: Currently uses generic shadcn/ui dark theme. Clinical colors must be re-validated for dark mode contrast before production deployment.
5. **Test with color blindness simulators**: The green/amber/red clinical scale must be validated with protanopia and deuteranopia filters.
