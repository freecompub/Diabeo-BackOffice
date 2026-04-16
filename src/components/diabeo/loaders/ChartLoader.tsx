import { cn } from "@/lib/utils"

type ChartLoaderProps = {
  variant?: "line" | "agp" | "bars" | "donut"
  label?: string
  className?: string
}

export function ChartLoader({
  variant = "line",
  label = "Chargement des données glycémiques…",
  className,
}: ChartLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "relative overflow-hidden rounded-xl border border-ink-100 bg-white p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="space-y-2">
          <div className="h-3 w-32 rounded bg-teal-100/70 animate-pulse" />
          <div className="h-4 w-48 rounded bg-ink-100 animate-pulse" />
        </div>
        <div className="flex gap-1">
          <div className="h-6 w-10 rounded bg-ink-100 animate-pulse" />
          <div className="h-6 w-10 rounded bg-ink-100 animate-pulse" />
          <div className="h-6 w-10 rounded bg-ink-100 animate-pulse" />
        </div>
      </div>

      {variant === "line" && <LineSkeleton />}
      {variant === "agp" && <AgpSkeleton />}
      {variant === "bars" && <BarsSkeleton />}
      {variant === "donut" && <DonutSkeleton />}

      <div className="shimmer-overlay pointer-events-none absolute inset-0" aria-hidden />
      <span className="sr-only">{label}</span>

      <style>{`
        .shimmer-overlay {
          background: linear-gradient(
            110deg,
            rgba(255,255,255,0) 0%,
            rgba(13,148,136,0.05) 45%,
            rgba(13,148,136,0.12) 50%,
            rgba(13,148,136,0.05) 55%,
            rgba(255,255,255,0) 100%
          );
          background-size: 200% 100%;
          animation: shimmer 1.8s linear infinite;
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .shimmer-overlay { animation: none; opacity: 0.4; }
        }
        .chart-draw {
          stroke-dasharray: 600;
          stroke-dashoffset: 600;
          animation: draw 2.2s ease-in-out infinite;
        }
        @keyframes draw {
          0% { stroke-dashoffset: 600; opacity: 0.4; }
          50% { stroke-dashoffset: 0; opacity: 0.9; }
          100% { stroke-dashoffset: -600; opacity: 0.4; }
        }
        @media (prefers-reduced-motion: reduce) {
          .chart-draw { animation: none; stroke-dashoffset: 0; opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}

function LineSkeleton() {
  return (
    <svg viewBox="0 0 600 200" className="w-full h-48" aria-hidden>
      <rect x="0" y="70" width="600" height="70" fill="rgba(16,185,129,0.06)" />
      <line x1="0" y1="70" x2="600" y2="70" stroke="#E5E7EB" strokeDasharray="3 3" />
      <line x1="0" y1="140" x2="600" y2="140" stroke="#E5E7EB" strokeDasharray="3 3" />
      <path
        className="chart-draw"
        d="M0,120 L50,110 L100,95 L150,80 L200,100 L250,130 L300,145 L350,130 L400,115 L450,95 L500,105 L550,120 L600,115"
        fill="none"
        stroke="#0D9488"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function AgpSkeleton() {
  return (
    <svg viewBox="0 0 600 200" className="w-full h-48" aria-hidden>
      <rect x="0" y="70" width="600" height="70" fill="rgba(16,185,129,0.06)" />
      <path
        d="M0,140 L100,155 L200,125 L300,80 L400,100 L500,135 L600,140 L600,50 L500,45 L400,30 L300,15 L200,40 L100,75 L0,90 Z"
        fill="rgba(13,148,136,0.12)"
        className="animate-pulse"
      />
      <path
        d="M0,130 L100,140 L200,115 L300,85 L400,100 L500,125 L600,130 L600,65 L500,60 L400,50 L300,40 L200,55 L100,85 L0,95 Z"
        fill="rgba(13,148,136,0.22)"
        className="animate-pulse"
      />
      <path
        className="chart-draw"
        d="M0,115 L100,125 L200,110 L300,88 L400,95 L500,115 L600,120"
        fill="none"
        stroke="#0D9488"
        strokeWidth="2"
      />
    </svg>
  )
}

function BarsSkeleton() {
  const bars = Array.from({ length: 14 })
  return (
    <svg viewBox="0 0 600 200" className="w-full h-48" aria-hidden>
      {bars.map((_, i) => {
        const h = 40 + ((i * 37) % 120)
        return (
          <rect
            key={i}
            x={20 + i * 40}
            y={190 - h}
            width="28"
            height={h}
            rx="4"
            fill="#CCFBF1"
            className="animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        )
      })}
    </svg>
  )
}

function DonutSkeleton() {
  return (
    <div className="flex items-center justify-center py-4">
      <svg viewBox="0 0 120 120" className="w-36 h-36" aria-hidden>
        <circle cx="60" cy="60" r="48" fill="none" stroke="#F3F4F6" strokeWidth="14" />
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          stroke="#0D9488"
          strokeWidth="14"
          strokeDasharray="60 302"
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="-90 60 60"
            to="270 60 60"
            dur="1.4s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    </div>
  )
}
