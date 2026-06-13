"use client"

import { useId } from "react"
import { cn } from "@/lib/utils"
import { tokens } from "@/design-system/tokens"
import {
  DROP_PATH,
  WAVE_PATH,
  DOT,
  GLYPH_TRANSFORM,
  WAVE_STROKE_WIDTH,
  DOT_OUTLINE_STROKE_WIDTH,
} from "./logo-paths"

type LogoVariant = "full" | "mark" | "mono" | "inverse"
type LogoProps = {
  variant?: LogoVariant
  size?: number
  className?: string
  title?: string
}

const TITLE = "Diabeo — Supervision de l'insulinothérapie"

// Couleurs depuis le design system (US-2269) — JAMAIS de hex hardcodés.
// `tokens.brand.primary[600]` = teal principal, `[700]` = teal foncé pour
// le gradient drop, `secondary[500]` = coral pour le point de données live.
const COLOR = {
  primaryLight: tokens.brand.primary[50],
  primary: tokens.brand.primary[600],
  primaryDark: tokens.brand.primary[700],
  secondary: tokens.brand.secondary[500],
  textPrimary: tokens.neutral[800],
  white: tokens.white,
} as const

export function Logo({
  variant = "full",
  size = 32,
  className,
  title = TITLE,
}: LogoProps) {
  if (variant === "mark") return <LogoMark size={size} className={className} title={title} />
  if (variant === "mono") return <LogoWordmark size={size} className={className} title={title} tone="mono" />
  if (variant === "inverse") return <LogoWordmark size={size} className={className} title={title} tone="inverse" />
  return <LogoWordmark size={size} className={className} title={title} tone="default" />
}

export function LogoMark({
  size = 32,
  className,
  title = TITLE,
  tone = "default",
}: {
  size?: number
  className?: string
  title?: string
  tone?: "default" | "mono" | "inverse"
}) {
  // Variant `mono` doit utiliser `currentColor` partout pour suivre la couleur
  // du parent (impression noir-et-blanc, mode high-contrast, PDF d'export
  // patient). Le wave en blanc hardcodé serait invisible sur fond clair.
  // useId() garantit un ID unique par instance de LogoMark dans la page —
  // évite les ID SVG dupliqués quand plusieurs logos coexistent (HTML invalid).
  const gradientId = useId()

  const drop =
    tone === "inverse" ? COLOR.white : tone === "mono" ? "currentColor" : COLOR.primary
  const dropShadow =
    tone === "inverse" ? COLOR.primaryLight : tone === "mono" ? "currentColor" : COLOR.primaryDark
  const wave =
    tone === "inverse" ? COLOR.primary : tone === "mono" ? "currentColor" : COLOR.white
  const dot = tone === "mono" ? "currentColor" : COLOR.secondary

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={drop} />
          <stop offset="100%" stopColor={dropShadow} />
        </linearGradient>
      </defs>
      <g transform={GLYPH_TRANSFORM}>
        {/* Glucose drop */}
        <path
          d={DROP_PATH}
          fill={tone === "default" ? `url(#${gradientId})` : drop}
        />
        {/* CGM wave */}
        <path
          d={WAVE_PATH}
          fill="none"
          stroke={wave}
          strokeWidth={WAVE_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Live data point.
          * En mode `mono`, fill et wave valent tous deux `currentColor` →
          * le stroke serait invisible (même couleur que le fill). On le désactive. */}
        <circle
          cx={DOT.cx}
          cy={DOT.cy}
          r={DOT.r}
          fill={dot}
          stroke={tone === "mono" ? "none" : wave}
          strokeWidth={tone === "mono" ? 0 : DOT_OUTLINE_STROKE_WIDTH}
        />
      </g>
    </svg>
  )
}

function LogoWordmark({
  size = 32,
  className,
  title,
  tone = "default",
}: {
  size?: number
  className?: string
  title?: string
  tone?: "default" | "mono" | "inverse"
}) {
  const text =
    tone === "inverse" ? COLOR.white : tone === "mono" ? "currentColor" : COLOR.textPrimary
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role="img"
      aria-label={title}
    >
      <LogoMark size={size} tone={tone} title={title} />
      <span
        className="font-extrabold tracking-tight leading-none"
        style={{ color: text, fontSize: size * 0.78 }}
      >
        Diabeo
      </span>
    </span>
  )
}
