import { cn } from "@/lib/utils"

type UploadStatus = "pending" | "uploading" | "scanning" | "encrypting" | "done" | "error"

type UploadLoaderProps = {
  fileName: string
  sizeBytes: number
  loadedBytes: number
  status?: UploadStatus
  onCancel?: () => void
  className?: string
}

const STAGE_LABEL: Record<UploadStatus, string> = {
  pending: "En attente…",
  uploading: "Transfert en cours",
  scanning: "Analyse antivirus",
  encrypting: "Chiffrement AES-256-GCM",
  done: "Document chiffré & archivé",
  error: "Échec du transfert",
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} o`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`
  return `${(b / 1024 / 1024).toFixed(2)} Mo`
}

export function UploadLoader({
  fileName,
  sizeBytes,
  loadedBytes,
  status = "uploading",
  onCancel,
  className,
}: UploadLoaderProps) {
  const pct = sizeBytes > 0 ? Math.min(100, Math.round((loadedBytes / sizeBytes) * 100)) : 0
  const isDone = status === "done"
  const isError = status === "error"
  const isActive = status === "uploading" || status === "scanning" || status === "encrypting"

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={isActive}
      className={cn(
        "rounded-xl border bg-white p-4",
        isError ? "border-red-200" : isDone ? "border-emerald-200" : "border-ink-100",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <UploadRing pct={pct} status={status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink-900">{fileName}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
                <span className="font-mono">
                  {fmtBytes(loadedBytes)} / {fmtBytes(sizeBytes)}
                </span>
                <span className="text-ink-300">·</span>
                <span
                  className={cn(
                    "font-medium",
                    isError && "text-red-600",
                    isDone && "text-emerald-600",
                    !isError && !isDone && "text-teal-700",
                  )}
                >
                  {STAGE_LABEL[status]}
                </span>
              </div>
            </div>
            {!isDone && !isError && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label={`Annuler l'envoi de ${fileName}`}
                className="rounded-md p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-900 cursor-pointer transition-colors"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
                  <path d="M6 6l12 12M18 6l-12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>

          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden>
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                isError ? "bg-red-500" : isDone ? "bg-emerald-500" : "bg-teal-600",
                isActive && "upload-stripes",
              )}
              style={{ width: `${isDone ? 100 : pct}%` }}
            />
          </div>

          <UploadStages status={status} />
        </div>
      </div>

      <style>{`
        .upload-stripes {
          background-image: linear-gradient(
            45deg,
            rgba(255,255,255,0.35) 25%, transparent 25%,
            transparent 50%, rgba(255,255,255,0.35) 50%,
            rgba(255,255,255,0.35) 75%, transparent 75%,
            transparent
          );
          background-size: 16px 16px;
          animation: stripes 1s linear infinite;
        }
        @keyframes stripes {
          to { background-position: 16px 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .upload-stripes { animation: none; }
        }
      `}</style>
    </div>
  )
}

function UploadRing({ pct, status }: { pct: number; status: UploadStatus }) {
  const r = 20
  const c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  const isDone = status === "done"
  const isError = status === "error"

  return (
    <div className="relative h-12 w-12 flex-shrink-0">
      <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90" aria-hidden>
        <circle cx="24" cy="24" r={r} fill="none" stroke="#F3F4F6" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke={isError ? "#EF4444" : isDone ? "#10B981" : "#0D9488"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {isDone ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-600" aria-hidden>
            <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : isError ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-red-600" aria-hidden>
            <path d="M12 9v4m0 4h.01M5 20h14a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0L3.3 17A2 2 0 0 0 5 20Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className="text-[0.65rem] font-bold text-teal-700 font-mono">{pct}%</span>
        )}
      </div>
    </div>
  )
}

function UploadStages({ status }: { status: UploadStatus }) {
  const stages: { key: UploadStatus; label: string }[] = [
    { key: "uploading", label: "Transfert" },
    { key: "scanning", label: "Antivirus" },
    { key: "encrypting", label: "Chiffrement" },
    { key: "done", label: "Archivé" },
  ]
  const order = ["pending", "uploading", "scanning", "encrypting", "done", "error"] as const
  const currentIdx = order.indexOf(status)

  return (
    <div className="mt-3 flex items-center gap-1.5" aria-hidden>
      {stages.map((s) => {
        const idx = order.indexOf(s.key)
        const active = idx === currentIdx
        const passed = idx < currentIdx
        return (
          <div key={s.key} className="flex items-center gap-1.5 first:ml-0">
            <span
              className={cn(
                "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[0.55rem] font-bold transition-colors",
                passed && "border-emerald-500 bg-emerald-500 text-white",
                active && "border-teal-600 bg-teal-50 text-teal-700 ring-2 ring-teal-200",
                !passed && !active && "border-ink-300 bg-white text-ink-300",
              )}
            >
              {passed ? "✓" : idx + 1}
            </span>
            <span
              className={cn(
                "text-[0.65rem] font-medium",
                passed && "text-emerald-700",
                active && "text-teal-700",
                !passed && !active && "text-ink-300",
              )}
            >
              {s.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
