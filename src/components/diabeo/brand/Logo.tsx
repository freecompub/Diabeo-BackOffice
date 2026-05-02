import { cn } from "@/lib/utils"

type LogoVariant = "full" | "mark" | "mono" | "inverse"
type LogoProps = {
  variant?: LogoVariant
  size?: number
  className?: string
  title?: string
}

const TITLE = "Diabeo — Supervision de l'insulinothérapie"

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
  const drop = tone === "inverse" ? "#FFFFFF" : tone === "mono" ? "currentColor" : "#0D9488"
  const dropShadow = tone === "inverse" ? "#F0FDFA" : tone === "mono" ? "currentColor" : "#0F766E"
  const wave = tone === "inverse" ? "#0D9488" : tone === "mono" ? "#FFFFFF" : "#FFFFFF"
  const dot = tone === "mono" ? "currentColor" : "#F97316"

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
    tone === "inverse" ? "#FFFFFF" : tone === "mono" ? "currentColor" : "#1F2937"
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
