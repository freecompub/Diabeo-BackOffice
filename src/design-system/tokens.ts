/**
 * Diabeo Design System — Design tokens (miroir TypeScript de `src/styles/tokens.css`).
 *
 * US-2269 — SOURCE DE VÉRITÉ unique côté JS. Les composants utilisent les
 * classes Tailwind sémantiques (`text-foreground`, `text-glycemia-critical`…)
 * qui pointent sur les variables `@theme` ; mais les **charts/SVG** (Recharts)
 * ont besoin de valeurs JS — ils importent `tokens` au lieu d'écrire des hex en
 * dur (anti-drift).
 *
 * ⚠️ NE PAS DIVERGER de `src/styles/tokens.css` : `tests/unit/design-tokens.test.ts`
 * vérifie que chaque entrée de {@link COLOR_TOKEN_CSS} égale la variable
 * `--diabeo-*` correspondante du CSS (gate CI). Toute modif d'une couleur DOIT
 * se faire dans les deux (ou la CI échoue).
 *
 * @see src/styles/tokens.css — source CSS consommée par Tailwind @theme
 * @see docs/design-system/colors.md — documentation
 */

/**
 * Map plat `<nom-sans-prefixe-diabeo> → hex`. UNIQUE endroit où les hex sont
 * écrits côté JS ; validé contre `tokens.css` par le gate de parité.
 */
export const COLOR_TOKEN_CSS = {
  // Brand — Primary (teal)
  "primary-50": "#F0FDFA",
  "primary-100": "#CCFBF1",
  "primary-200": "#99F6E4",
  "primary-300": "#5EEAD4",
  "primary-400": "#2DD4BF",
  "primary-500": "#14B8A6",
  "primary-600": "#0D9488",
  "primary-700": "#0F766E",
  "primary-800": "#115E59",
  "primary-900": "#134E4A",
  "primary-950": "#042F2E",
  // Brand — Secondary (coral)
  "secondary-50": "#FFF7ED",
  "secondary-100": "#FFEDD5",
  "secondary-200": "#FED7AA",
  "secondary-300": "#FDBA74",
  "secondary-400": "#FB923C",
  "secondary-500": "#F97316",
  "secondary-600": "#EA580C",
  "secondary-700": "#C2410C",
  "secondary-800": "#9A3412",
  "secondary-900": "#7C2D12",
  "secondary-950": "#431407",
  // Neutral (gray)
  "neutral-50": "#FAFAFA",
  "neutral-100": "#F3F4F6",
  "neutral-200": "#E5E7EB",
  "neutral-300": "#D1D5DB",
  "neutral-400": "#9CA3AF",
  "neutral-500": "#6B7280",
  "neutral-600": "#4B5563",
  "neutral-700": "#374151",
  "neutral-800": "#1F2937",
  "neutral-900": "#111827",
  "neutral-950": "#030712",
  // Glycemia (clinical)
  "glycemia-very-low": "#991B1B",
  "glycemia-very-low-bg": "#FEF2F2",
  "glycemia-very-low-border": "#FECACA",
  "glycemia-low": "#EF4444",
  "glycemia-low-bg": "#FEF2F2",
  "glycemia-low-border": "#FCA5A5",
  "glycemia-normal": "#10B981",
  "glycemia-normal-bg": "#ECFDF5",
  "glycemia-normal-border": "#A7F3D0",
  "glycemia-high": "#F59E0B",
  "glycemia-high-bg": "#FFFBEB",
  "glycemia-high-border": "#FDE68A",
  "glycemia-very-high": "#EF4444",
  "glycemia-very-high-bg": "#FEF2F2",
  "glycemia-very-high-border": "#FECACA",
  "glycemia-critical": "#DC2626",
  "glycemia-critical-bg": "#FEE2E2",
  "glycemia-critical-border": "#F87171",
  // TIR zones (5-zone)
  "tir-very-low": "#991B1B",
  "tir-low": "#EF4444",
  "tir-in-range": "#10B981",
  "tir-high": "#F59E0B",
  "tir-very-high": "#F97316",
  // Semantic
  "success": "#10B981",
  "success-bg": "#ECFDF5",
  "success-border": "#A7F3D0",
  "warning": "#F59E0B",
  "warning-bg": "#FFFBEB",
  "warning-border": "#FDE68A",
  "error": "#EF4444",
  "error-bg": "#FEF2F2",
  "error-border": "#FCA5A5",
  "info": "#3B82F6",
  "info-bg": "#EFF6FF",
  "info-border": "#BFDBFE",
  // Pathology badges
  "dt1": "#7C3AED",
  "dt1-bg": "#F5F3FF",
  "dt2": "#2563EB",
  "dt2-bg": "#EFF6FF",
  "gd": "#EC4899",
  "gd-bg": "#FDF2F8",
} as const

export type ColorTokenName = keyof typeof COLOR_TOKEN_CSS

/** Récupère la valeur hex d'un token de couleur (helper typé). */
export function color(name: ColorTokenName): string {
  return COLOR_TOKEN_CSS[name]
}

const C = COLOR_TOKEN_CSS

/**
 * Vue ergonomique pour les consommateurs JS (charts/SVG). Construite À PARTIR de
 * {@link COLOR_TOKEN_CSS} → ne peut pas diverger de la source.
 */
export const tokens = {
  brand: {
    primary: {
      50: C["primary-50"], 100: C["primary-100"], 200: C["primary-200"],
      300: C["primary-300"], 400: C["primary-400"], 500: C["primary-500"],
      600: C["primary-600"], 700: C["primary-700"], 800: C["primary-800"],
      900: C["primary-900"], 950: C["primary-950"],
    },
    secondary: {
      50: C["secondary-50"], 100: C["secondary-100"], 200: C["secondary-200"],
      300: C["secondary-300"], 400: C["secondary-400"], 500: C["secondary-500"],
      600: C["secondary-600"], 700: C["secondary-700"], 800: C["secondary-800"],
      900: C["secondary-900"], 950: C["secondary-950"],
    },
  },
  neutral: {
    50: C["neutral-50"], 100: C["neutral-100"], 200: C["neutral-200"],
    300: C["neutral-300"], 400: C["neutral-400"], 500: C["neutral-500"],
    600: C["neutral-600"], 700: C["neutral-700"], 800: C["neutral-800"],
    900: C["neutral-900"], 950: C["neutral-950"],
  },
  glycemia: {
    veryLow: C["glycemia-very-low"], low: C["glycemia-low"],
    normal: C["glycemia-normal"], high: C["glycemia-high"],
    veryHigh: C["glycemia-very-high"], critical: C["glycemia-critical"],
  },
  /** Couleurs des 5 zones Time-in-Range (charts). */
  tir: {
    veryLow: C["tir-very-low"], low: C["tir-low"], inRange: C["tir-in-range"],
    high: C["tir-high"], veryHigh: C["tir-very-high"],
  },
  semantic: {
    success: C["success"], warning: C["warning"], error: C["error"], info: C["info"],
  },
  pathology: {
    DT1: C["dt1"], DT2: C["dt2"], GD: C["gd"],
  },
  /** Blanc pur — fonds de bandes/segments de charts (≡ neutral-50 visuel). */
  white: "#FFFFFF",
} as const
