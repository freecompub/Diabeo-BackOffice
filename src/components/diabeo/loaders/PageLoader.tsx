import { cn } from "@/lib/utils"

type PageLoaderProps = {
  label?: string
  sublabel?: string
  fullscreen?: boolean
  className?: string
}

export function PageLoader({
  label = "Chargement sécurisé en cours",
  sublabel = "Vérification du chiffrement & des droits d'accès…",
  fullscreen = true,
  className,
}: PageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "flex items-center justify-center",
        fullscreen && "fixed inset-0 z-50 bg-background/90 backdrop-blur-sm",
        !fullscreen && "py-16",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-5 max-w-xs text-center">
        <div className="relative h-20 w-20">
          <svg
            viewBox="0 0 80 80"
            className="h-20 w-20"
            aria-hidden
          >
            <circle
              cx="40"
              cy="40"
              r="32"
              fill="none"
              stroke="#E6FFFA"
              strokeWidth="4"
            />
            <circle
              cx="40"
              cy="40"
              r="32"
              fill="none"
              stroke="#0D9488"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="50 200"
              className="loader-spin"
            />
            <path
              d="M40 20 C 28 32, 28 45, 40 55 C 52 45, 52 32, 40 20 Z"
              fill="#0D9488"
              className="loader-drop"
            />
          </svg>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-semibold text-ink-900">{label}</div>
          <div className="text-xs text-ink-500">{sublabel}</div>
        </div>

        <div className="flex items-center gap-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-teal-700">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal-600 animate-pulse" />
          HDS · AES-256-GCM
        </div>
      </div>

      <style>{`
        .loader-spin {
          transform-origin: 40px 40px;
          animation: spin 1.1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .loader-drop {
          transform-origin: 40px 40px;
          animation: drop-pulse 1.6s ease-in-out infinite;
        }
        @keyframes drop-pulse {
          0%, 100% { transform: scale(0.85); opacity: 0.85; }
          50% { transform: scale(1); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .loader-spin, .loader-drop { animation: none; }
        }
      `}</style>
    </div>
  )
}

export function InlinePageLoader({ label = "Chargement…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-ink-500">
      <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin text-teal-600" aria-hidden>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span>{label}</span>
    </div>
  )
}
