/**
 * Source unique des destinations de navigation (sidebar + palette Ctrl/Cmd-K).
 *
 * Extrait de `NavigationShell` (US-2601) pour être consommé AUSSI par
 * `CommandPalette` sans dupliquer la liste ni les gates de rôle — les deux
 * devaient rester synchronisés (review PR #541, M3 « drift »). Module feuille
 * (aucun import de `NavigationShell`/`CommandPalette`) → pas de cycle.
 */

import {
  LayoutDashboard,
  Users,
  Settings,
  FileText,
  Activity,
  Pill,
  Download,
  CalendarDays,
  Syringe,
  Smartphone,
  Home,
  CalendarClock,
  MessageSquare,
  type LucideIcon,
} from "lucide-react"

export type UserRole = "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"

export interface NavItem {
  href: string
  labelKey: string
  icon: LucideIcon
  minRole?: UserRole
  /**
   * US-2076-UI iter 1 — badge dynamique unread count via `useUnreadCount()`.
   * Activé uniquement sur `/messages`. Cf. NavigationShell pour le détail.
   */
  showUnreadBadge?: boolean
}

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  VIEWER: 0,
  NURSE: 1,
  DOCTOR: 2,
  ADMIN: 3,
}

export function hasRoleAccess(userRole: UserRole, minRole?: UserRole): boolean {
  if (!minRole) return true
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole]
}

/**
 * Marker sentinel pour `NavItem.href` : résolu dynamiquement vers le home
 * rôle-spécifique au render (DOCTOR → /medecin, NURSE → /infirmier, etc.).
 * Mapping centralisé : `@/lib/auth/role-home`.
 */
export const HOME_HREF_MARKER = "__home__"

/**
 * Pro nav (DOCTOR / NURSE / ADMIN). `/admin/users` et `/audit` ADMIN-only.
 * `1er item HOME_HREF_MARKER` résolu selon le rôle courant.
 */
export const navItems: NavItem[] = [
  { href: HOME_HREF_MARKER, labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/patients", labelKey: "patients", icon: Users },
  { href: "/appointments", labelKey: "appointments", icon: CalendarClock, minRole: "NURSE" },
  { href: "/messages", labelKey: "messages", icon: MessageSquare, minRole: "NURSE", showUnreadBadge: true },
  { href: "/medications", labelKey: "medications", icon: Pill },
  { href: "/analytics", labelKey: "analytics", icon: Activity },
  { href: "/weekly", labelKey: "weekly", icon: CalendarDays },
  { href: "/insulin-therapy", labelKey: "insulinTherapy", icon: Syringe, minRole: "NURSE" },
  { href: "/devices", labelKey: "devices", icon: Smartphone },
  { href: "/documents", labelKey: "documents", icon: FileText },
  { href: "/import", labelKey: "import", icon: Download, minRole: "DOCTOR" },
  { href: "/admin/users", labelKey: "users", icon: Users, minRole: "ADMIN" },
  { href: "/audit", labelKey: "audit", icon: FileText, minRole: "ADMIN" },
  { href: "/settings", labelKey: "settings", icon: Settings },
]

/** Patient self-service nav (VIEWER, layout `(patient)`). */
export const patientNavItems: NavItem[] = [
  { href: "/patient/dashboard", labelKey: "patientHome", icon: Home },
  { href: "/patient/appointments", labelKey: "appointments", icon: CalendarClock },
  { href: "/settings", labelKey: "settings", icon: Settings },
]
