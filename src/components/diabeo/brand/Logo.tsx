import { cn } from "@/lib/utils"
import { tokens } from "@/design-system/tokens"

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
  const drop =
    tone === "inverse" ? COLOR.white : tone === "mono" ? "currentColor" : COLOR.primary
  const dropShadow =
    tone === "inverse" ? COLOR.primaryLight : tone === "mono" ? "currentColor" : COLOR.primaryDark
  const wave =
    tone === "inverse" ? COLOR.primary : tone === "mono" ? COLOR.white : COLOR.white
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
        <linearGradient id="diabeo-drop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={drop} />
          <stop offset="100%" stopColor={dropShadow} />
        </linearGradient>
      </defs>
      <g transform="rotate(-6 24 24)">
        {/* Glucose drop */}
        <path
          d="M24 3
             C 33 14, 40 22, 40 29
             A 16 16 0 1 1 8 29
             C 8 22, 15 14, 24 3 Z"
          fill={tone === "default" ? "url(#diabeo-drop)" : drop}
        />
        {/* CGM wave */}
        <path
          d="M11 30
             C 14 24, 18 24, 21 30
             C 24 36, 28 36, 31 30
             C 33 26, 35 26, 37 28"
          fill="none"
          stroke={wave}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Live data point */}
        <circle cx="37" cy="28" r="2.4" fill={dot} stroke={wave} strokeWidth="1" />
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
