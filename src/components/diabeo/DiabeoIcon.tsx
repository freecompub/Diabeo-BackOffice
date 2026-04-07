import { forwardRef, type SVGAttributes } from "react"
import {
  Heart,
  User,
  Settings,
  Lock,
  Calendar,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Plus,
  Pencil,
  ChevronRight,
  ChevronLeft,
  Download,
  Phone,
  Mail,
  Wifi,
  HelpCircle,
  Syringe,
  UtensilsCrossed,
  Activity,
  FileText,
  Clock,
  Bell,
  type LucideProps,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * DiabeoIcon — Icon wrapper for lucide-react with Diabeo size tokens.
 *
 * Maps semantic Diabeo icon names to their lucide-react counterparts.
 * Handles RTL support for directional icons (forward, back) via CSS transform.
 *
 * Accessibility:
 * - Decorative icons (no aria-label): aria-hidden="true" + role="none"
 * - Standalone meaningful icons: require aria-label (enforced by type)
 *
 * Size scale:
 *   sm=16px | md=20px | lg=24px | xl=32px | xxl=40px
 */

// ---------------------------------------------------------------------------
// Icon registry — maps Diabeo semantic names to lucide components
// ---------------------------------------------------------------------------

const ICON_MAP = {
  heart: Heart,
  profile: User,
  settings: Settings,
  lock: Lock,
  calendar: Calendar,
  statistics: BarChart3,
  warning: AlertTriangle,
  success: CheckCircle,
  error: XCircle,
  refresh: RefreshCw,
  add: Plus,
  edit: Pencil,
  forward: ChevronRight,
  back: ChevronLeft,
  export: Download,
  call: Phone,
  email: Mail,
  connection: Wifi,
  help: HelpCircle,
  insulin: Syringe,
  meal: UtensilsCrossed,
  heartRate: Activity,
  document: FileText,
  time: Clock,
  notifications: Bell,
} as const

export type DiabeoIconName = keyof typeof ICON_MAP

// ---------------------------------------------------------------------------
// Size mapping
// ---------------------------------------------------------------------------

const SIZE_PX: Record<DiabeoIconSize, number> = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
  xxl: 40,
}

export type DiabeoIconSize = "sm" | "md" | "lg" | "xl" | "xxl"

// ---------------------------------------------------------------------------
// Directional icons that need to be flipped in RTL contexts
// ---------------------------------------------------------------------------

const DIRECTIONAL_ICONS = new Set<DiabeoIconName>(["forward", "back"])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AccessibilityProps =
  | { "aria-label": string; "aria-hidden"?: never }
  | { "aria-label"?: never; "aria-hidden": true }

export type DiabeoIconProps = {
  /** Diabeo semantic icon name */
  name: DiabeoIconName
  /** Size token — maps to px: sm=16, md=20, lg=24, xl=32, xxl=40 */
  size?: DiabeoIconSize
  /** Additional CSS classes */
  className?: string
} & AccessibilityProps &
  Omit<SVGAttributes<SVGSVGElement>, "aria-label" | "aria-hidden">

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * DiabeoIcon renders a named icon from the Diabeo icon vocabulary.
 *
 * Standalone meaningful icons must provide `aria-label`.
 * Decorative icons must explicitly set `aria-hidden={true}`.
 *
 * @example
 * // Standalone icon with label
 * <DiabeoIcon name="warning" size="lg" aria-label="Alerte glycemie" />
 *
 * @example
 * // Decorative icon (next to visible text label)
 * <DiabeoIcon name="insulin" size="md" aria-hidden={true} />
 */
export const DiabeoIcon = forwardRef<SVGSVGElement, DiabeoIconProps>(
  function DiabeoIcon(
    {
      name,
      size = "md",
      className,
      "aria-label": ariaLabel,
      "aria-hidden": ariaHidden,
      ...props
    },
    ref
  ) {
    const IconComponent = ICON_MAP[name] as React.ComponentType<LucideProps>
    const px = SIZE_PX[size]

    // Directional icons are flipped in RTL via logical CSS transform
    const isDirectional = DIRECTIONAL_ICONS.has(name)

    return (
      <IconComponent
        ref={ref}
        width={px}
        height={px}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : true}
        role={ariaLabel ? "img" : "none"}
        focusable={false}
        className={cn(
          // RTL flip for directional icons: mirrors the icon on rtl documents
          isDirectional && "[dir=rtl]:[transform:scaleX(-1)]",
          className
        )}
        {...props}
      />
    )
  }
)

DiabeoIcon.displayName = "DiabeoIcon"

export { ICON_MAP, SIZE_PX }
