/**
 * Swiss Modernism 2.0 layout primitives — design prototype.
 *
 * Principes appliqués :
 *   - Grille 12 colonnes stricte (Tailwind grid-cols-12)
 *   - Spacing mathématique base 8px (gap-2, gap-4, gap-6, gap-8)
 *   - Pas d'ombres décoratives, pas de gradients
 *   - Hiérarchie typographique forte (Inter weight 300/400/500)
 *   - High contrast WCAG AAA (#000 sur #FFF, accent teal unique)
 *   - Asymétrie volontaire (col-span 7/5 plutôt que 6/6)
 *
 * Ce module est ISOLÉ du design system production (`Sérénité Active`).
 * Aucun composant ici n'est utilisé en prod — preview seulement.
 */

import type { ReactNode } from "react"

// ── Constants design Swiss ──────────────────────────────────────────

export const SWISS_TOKENS = {
  // Single accent (brand Diabeo préservé pour cohérence patient safety)
  accent: "#0D9488",
  // Grayscale strict
  black: "#000000",
  textSecondary: "#525252",
  border: "#E5E5E5",
  borderSubtle: "#F5F5F5",
  bg: "#FFFFFF",
  // Glycemia colors (jamais altérés — patient safety)
  glycemiaCritical: "#991B1B",
  glycemiaHigh: "#F59E0B",
  glycemiaNormal: "#10B981",
} as const

// ── Page container ──────────────────────────────────────────────────

export function SwissPage({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen bg-white text-black antialiased"
      style={{ fontFamily: "'Inter', 'Helvetica Neue', Helvetica, sans-serif" }}
    >
      <div className="mx-auto max-w-[1440px] px-8 py-12">{children}</div>
    </div>
  )
}

// ── Header (rule line + metadata aside) ────────────────────────────

export function SwissHeader({
  title,
  subtitle,
  meta,
}: {
  title: string
  subtitle?: string
  meta?: ReactNode
}) {
  return (
    <header className="grid grid-cols-12 gap-8 border-b border-black/10 pb-12">
      <div className="col-span-12 lg:col-span-8">
        <h1 className="text-[64px] font-light leading-[1.05] tracking-tight">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-4 max-w-prose text-base font-normal text-neutral-600">
            {subtitle}
          </p>
        ) : null}
      </div>
      {meta ? (
        <aside
          className="col-span-12 mt-8 flex items-start justify-start gap-8 text-xs uppercase tracking-[0.12em] text-neutral-600 lg:col-span-4 lg:mt-0 lg:justify-end"
          aria-label="Informations de la page"
        >
          {meta}
        </aside>
      ) : null}
    </header>
  )
}

// ── Section heading (rule + number + label) ────────────────────────

export function SwissSection({
  number,
  title,
  description,
  children,
  className = "",
}: {
  number: string
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`mt-16 ${className}`}>
      <div className="mb-8 grid grid-cols-12 items-end gap-8">
        <div className="col-span-12 flex items-baseline gap-6 lg:col-span-8">
          <span
            className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500"
            aria-hidden="true"
          >
            {number}
          </span>
          <h2 className="text-2xl font-medium tracking-tight">{title}</h2>
        </div>
        {description ? (
          <p className="col-span-12 max-w-prose text-sm text-neutral-600 lg:col-span-4 lg:text-right">
            {description}
          </p>
        ) : null}
      </div>
      <div className="border-t border-black/10 pt-8">{children}</div>
    </section>
  )
}

// ── Metric block (large number, weight 300) ────────────────────────

export function SwissMetric({
  label,
  value,
  unit,
  delta,
  deltaTone = "neutral",
}: {
  label: string
  value: string
  unit?: string
  delta?: string
  deltaTone?: "positive" | "negative" | "neutral"
}) {
  const deltaColor =
    deltaTone === "positive"
      ? "text-[#10B981]"
      : deltaTone === "negative"
        ? "text-[#991B1B]"
        : "text-neutral-600"
  return (
    <div className="border-l border-black pl-6">
      <div className="text-xs uppercase tracking-[0.15em] text-neutral-600">
        {label}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[56px] font-light leading-none tabular-nums tracking-tight">
          {value}
        </span>
        {unit ? (
          <span className="text-base font-normal text-neutral-600">{unit}</span>
        ) : null}
      </div>
      {delta ? (
        <div className={`mt-2 text-xs font-medium tabular-nums ${deltaColor}`}>
          {delta}
        </div>
      ) : null}
    </div>
  )
}

// ── Data row (table-like, no shadow, fine border) ──────────────────

export function SwissDataRow({
  cells,
  isHeader = false,
  severity,
}: {
  cells: ReactNode[]
  isHeader?: boolean
  severity?: "critical" | "warning" | "normal"
}) {
  const severityClass =
    severity === "critical"
      ? "border-l-2 border-l-[#991B1B]"
      : severity === "warning"
        ? "border-l-2 border-l-[#F59E0B]"
        : ""
  return (
    <div
      className={[
        "grid grid-cols-12 gap-4 border-b border-black/10 py-4",
        isHeader ? "text-xs uppercase tracking-[0.12em] text-neutral-600" : "text-sm",
        severityClass,
        severityClass ? "pl-4 -ml-4" : "",
      ].join(" ")}
      role={isHeader ? undefined : "row"}
    >
      {cells.map((cell, i) => (
        <div key={i} className="col-span-2 first:col-span-3 last:col-span-3 tabular-nums">
          {cell}
        </div>
      ))}
    </div>
  )
}
