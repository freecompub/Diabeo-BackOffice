"use client"

/**
 * Navigation Shell — responsive app layout with sidebar, header, and breadcrumbs.
 *
 * Desktop: fixed sidebar 256px + header + content
 * Tablet: collapsible sidebar (icons only ~64px)
 * Mobile: hamburger menu overlay (Sheet from shadcn)
 *
 * Supports RTL layout (sidebar positions via CSS logical properties).
 * Navigation items filtered by user role (RBAC).
 *
 * Note: shadcn/ui in this project uses @base-ui/react (React 19).
 * No `asChild` prop — use `render` prop for composition.
 */

import { useState, useCallback, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  LayoutDashboard,
  Users,
  Settings,
  FileText,
  LogOut,
  Activity,
  Pill,
  Menu,
  ChevronLeft,
  ChevronRight,
  Bell,
  RefreshCw,
  User,
  Download,
  CalendarDays,
  Syringe,
  Smartphone,
  Home,
  CalendarClock,
  MessageSquare,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import {
  UnreadCountProvider,
  useUnreadCountFromContext,
} from "@/components/diabeo/messaging/UnreadCountContext"
import { resolveHomeForRole } from "@/lib/auth/role-home"
import { LocaleReconciliationBanner } from "@/components/diabeo/LocaleReconciliationBanner"
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

// --- Types ---

type UserRole = "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"

interface NavItem {
  href: string
  labelKey: string
  icon: LucideIcon
  minRole?: UserRole
  /**
   * US-2076-UI iter 1 — affiche un badge dynamique unread count via
   * `useUnreadCount()`. Activé uniquement sur `/messages` pour le moment.
   * Polling 60s + pause sur tab hidden + refetch sur visibilitychange.
   *
   * **Single global count (Fix M7 round 1 review PR #440)** : tous les
   * items avec `showUnreadBadge=true` partagent LA MÊME source
   * `/api/messages/unread-count`. Si V2 nécessite des badges différents
   * (ex: notifications cabinet ≠ messages patients), créer un
   * `useNotificationCount` séparé avec un nouveau Context.
   */
  showUnreadBadge?: boolean
}

interface BreadcrumbItem {
  label: string
  href?: string
}

interface NavigationShellProps {
  children: React.ReactNode
  pageTitle: string
  pageSubtitle?: string
  breadcrumbs?: BreadcrumbItem[]
  userRole?: UserRole
  userName?: string
  onRefresh?: () => void
  /**
   * US-3356 — Variant selector for nav items.
   *
   * - `"pro"` (default) : sidebar cabinet (Patients, Analytics, Médicaments…)
   * - `"patient"` : sidebar self-service (Accueil)
   *
   * Fix RSC (#3 session 2026-05-22) : `variant` (string) traverse la boundary
   * server→client sans problème ; un `navItemsOverride` contenant des
   * références `LucideIcon` ne peut pas être sérialisé entre RSC et CC.
   */
  variant?: "pro" | "patient"
}

// --- Constants ---

const ROLE_HIERARCHY: Record<UserRole, number> = {
  VIEWER: 0,
  NURSE: 1,
  DOCTOR: 2,
  ADMIN: 3,
}

/**
 * Marker sentinel pour `NavItem.href` : résolu dynamiquement vers le home
 * rôle-spécifique au render (DOCTOR → /medecin, NURSE → /infirmier, etc.).
 *
 * Fix CRIT-1 round 2 review PR #426 — Le pattern précédent `href: "/"`
 * dépendait du role-router serveur qui était cassé par `src/app/page.tsx`
 * (supprimé). Le marker permet de garder une nav statique tout en
 * dispatchant côté client selon le `userRole` prop.
 *
 * Mapping centralisé : `@/lib/auth/role-home` (SoT partagée).
 */
const HOME_HREF_MARKER = "__home__"

/**
 * Pro nav (DOCTOR / NURSE / ADMIN).
 *
 * Fix #11.b/#11.c (session 2026-05-22) :
 *   - 1er item `href: HOME_HREF_MARKER` — résolu vers `/medecin` / `/infirmier`
 *     / `/admin` selon le role courant.
 *   - `/admin/users` et `/audit` ADMIN-only. `/admin/users` = UI réelle
 *     (US-2148) ; `/users` n'est plus qu'une redirection legacy (anomalie A5).
 */
const navItems: NavItem[] = [
  { href: HOME_HREF_MARKER, labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/patients", labelKey: "patients", icon: Users },
  // US-2500-UI — Calendrier RDV pro (issue #428, spec docs/UserStory/.../23-rdv/).
  // Fix L-2 round 2 review — `CalendarClock` (vs `CalendarDays` partagé avec /weekly)
  // pour distinguer visuellement dans la sidebar collapsed (icône seule).
  { href: "/appointments", labelKey: "appointments", icon: CalendarClock, minRole: "NURSE" },
  // US-2076-UI iter 1 — Messagerie pro (issue #429). Badge unread count
  // dynamique via useUnreadCount() polling 60s. Gated NURSE+ (backend
  // /api/messages route accepte tout user authentifié + GDPR consent
  // mais la page pro est destinée aux praticiens uniquement).
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

/**
 * Patient self-service nav (VIEWER, layout `(patient)`).
 *
 * #10 (session 2026-05-22) — Batch 1 US-3356 ne livre que la page
 * `/patient/dashboard` ; les items nav sont limités aux routes
 * réellement implémentées pour qu'un clic ne tombe jamais sur 404.
 * Futures sections (glycémie/événements/RDV/profil/préférences) à
 * ajouter ici quand les pages correspondantes atterriront en Batch 2+.
 *
 * #3 (session 2026-05-22) — Déclaré dans ce client component pour
 * éviter de passer une référence `LucideIcon` à travers la boundary
 * RSC depuis `(patient)/layout.tsx`.
 */
const patientNavItems: NavItem[] = [
  { href: "/patient/dashboard", labelKey: "patientHome", icon: Home },
  // US-2500-UI iter 12 — UI patient "Mes RDV" : vue read-only des RDV
  // du patient connecté + bouton "Accepter alternative" si propAlt set.
  // Fix L1 round 1 review PR #438 — `CalendarClock` cohérent avec sidebar pro
  // (vs `CalendarDays` réservé /weekly côté pro).
  { href: "/patient/appointments", labelKey: "appointments", icon: CalendarClock },
  // US-3356 extension — /settings is the single page shared across all roles.
  // VIEWER sees it in the patient sidebar (patient-only sections: medicalData,
  // administrative, dayMoments, privacy) ; PS roles access it via the pro sidebar.
  { href: "/settings", labelKey: "settings", icon: Settings },
]

function hasRoleAccess(userRole: UserRole, minRole?: UserRole): boolean {
  if (!minRole) return true
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole]
}

// --- Sidebar Content ---

function SidebarNav({
  items,
  pathname,
  collapsed,
  onItemClick,
}: {
  items: NavItem[]
  pathname: string
  collapsed: boolean
  onItemClick?: () => void
}) {
  const t = useTranslations("nav")
  // Fix M8 round 1 review PR #440 note — `useTranslations("messages")`
  // scope une lookup mais ne lazy-load PAS le namespace (next-intl charge
  // tous les namespaces dans le bundle initial via `getMessages()` root
  // layout). Pas de coût bundle additionnel par utilisation.
  const tMessages = useTranslations("messages")

  // Fix B2 round 1 review PR #440 — consume via Context (mounted UNE FOIS
  // dans NavigationShell parent). `SidebarNav` est rendu 2× (desktop +
  // mobile Sheet) ; sans Context = 2 polling timers + désynchro.
  // Fallback `{ count: 0, error: null }` si Provider absent (tests unit
  // isolés hors NavigationShell parent).
  const ctx = useUnreadCountFromContext()
  const unreadCount = ctx?.count ?? 0
  const unreadError = ctx?.error ?? null

  return (
    <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Menu principal">
      {items.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`)
        const label = t(item.labelKey)
        const showBadge = item.showUnreadBadge && unreadCount > 0 && unreadError !== "gdprConsentRevoked"
        // Fix M11 round 1 review PR #440 — si consent révoqué, on n'affiche
        // pas le badge mais l'item reste visible. Pas de marker visuel
        // additionnel pour ne pas révéler en open-space que l'utilisateur a
        // refusé le consent (sensible RGPD Art. 9). Feedback côté
        // /account/privacy uniquement (à créer V1.5 — page UI).
        // Fix M1 round 1 review PR #440 — cap à 9 max sur l'affichage visuel
        // pour limiter inférence cliniques (open-space, screen-sharing,
        // capture journaliste). Au-delà = "9+". Le aria-label reste précis
        // pour SR (utilisateurs qui ont besoin du count exact pour gérer
        // leur charge — non visible à l'œil tiers).
        const badgeDisplay = unreadCount > 9 ? "9+" : String(unreadCount)
        const badgeAriaLabel = showBadge
          ? tMessages("unreadBadgeAria", { count: unreadCount })
          : undefined

        // Fix H4 + H7 round 1 review PR #440 — `aria-label` sur Link
        // remplace `aria-current="page"` côté SR. On retire aria-label et
        // on annonce le count via un span `sr-only` SEUL (non-redondant
        // avec tooltip mode collapsed). aria-current reste exposé.
        const linkEl = (
          <Link
            href={item.href}
            onClick={onItemClick}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors relative",
              collapsed && "justify-center px-2",
              isActive
                ? "bg-teal-50 text-teal-600"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="relative shrink-0">
              <item.icon className="h-5 w-5" aria-hidden="true" />
              {showBadge && collapsed && (
                // Mode collapsed : badge en overlay sur l'icône (top-right corner).
                <span
                  className="absolute -top-1 -end-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-700 px-1 text-[10px] font-semibold leading-none text-white"
                  aria-hidden="true"
                >
                  {badgeDisplay}
                </span>
              )}
            </span>
            {!collapsed && (
              <>
                <span className="flex-1">{label}</span>
                {showBadge && (
                  // Mode expanded : badge inline à droite.
                  <span
                    className="ms-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-700 px-1.5 text-xs font-semibold text-white"
                    aria-hidden="true"
                  >
                    {badgeDisplay}
                  </span>
                )}
              </>
            )}
            {/* Fix H4 PR #440 — SR-only label discriminant single-source.
                Tooltip mode collapsed annonce le même contenu visuel mais
                en lecture, on garde UN seul source (sr-only) pour pas
                double-vocaliser. Le label visible (`<span>{label}</span>`)
                est lu en mode expanded ; en mode collapsed le linkEl
                fallback sur cet sr-only. */}
            {showBadge && (
              <span className="sr-only">{badgeAriaLabel}</span>
            )}
          </Link>
        )

        if (collapsed) {
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger className="w-full">{linkEl}</TooltipTrigger>
              <TooltipContent side="inline-end">
                {/* Fix H4 PR #440 — Tooltip visuel uniquement (aria-hidden).
                    SR lit le label via icon-context + sr-only `<span>` du
                    Link parent (single-source — pas de double-annonce). */}
                <p aria-hidden="true">{showBadge ? `${label} — ${badgeDisplay}` : label}</p>
              </TooltipContent>
            </Tooltip>
          )
        }

        return <div key={item.href}>{linkEl}</div>
      })}
    </nav>
  )
}

// --- Breadcrumbs ---

function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const t = useTranslations("nav")

  if (items.length === 0) return null

  return (
    <nav aria-label={t("breadcrumb")} className="mb-2">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={index} className="flex items-center gap-1.5">
              {index > 0 && (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 rtl:rotate-180"
                  aria-hidden="true"
                />
              )}
              {isLast || !item.href ? (
                <span
                  className={cn(
                    isLast ? "font-medium text-foreground" : "text-muted-foreground"
                  )}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="hover:text-teal-600 transition-colors"
                >
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

const COLLAPSED_COOKIE = "sidebar_collapsed"

function readCollapsedCookie(): boolean {
  if (typeof document === "undefined") return false
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${COLLAPSED_COOKIE}=`))
  return match?.split("=")[1] === "1"
}

function writeCollapsedCookie(collapsed: boolean) {
  if (typeof document === "undefined") return
  document.cookie = `${COLLAPSED_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; SameSite=Lax` +
    (location.protocol === "https:" ? "; Secure" : "")
}

/**
 * Cookie-backed sidebar state exposed via `useSyncExternalStore` — the React
 * primitive for client-only external state. Avoids both the SSR hydration
 * mismatch (server snapshot is always `false`, client reads the cookie) AND a
 * `setState`-in-effect (the lint-flagged pattern). Toggling writes the cookie
 * then notifies subscribers so the snapshot re-reads.
 */
const collapsedListeners = new Set<() => void>()
function subscribeCollapsed(onChange: () => void): () => void {
  collapsedListeners.add(onChange)
  return () => collapsedListeners.delete(onChange)
}
function toggleCollapsedCookie(next: boolean) {
  writeCollapsedCookie(next)
  collapsedListeners.forEach((cb) => cb())
}

// --- Main Component ---

export function NavigationShell({
  children,
  pageTitle,
  pageSubtitle,
  breadcrumbs = [],
  userRole = "VIEWER",
  userName,
  onRefresh,
  variant = "pro",
}: NavigationShellProps) {
  const t = useTranslations()
  const tNav = useTranslations("nav")
  const pathname = usePathname()
  const { logout } = useAuth()
  // Server snapshot is always `false`; the client reads the cookie post-hydration.
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsedCookie,
    () => false,
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  const sourceItems = variant === "patient" ? patientNavItems : navItems
  const filteredItems = sourceItems
    .filter((item) => hasRoleAccess(userRole, item.minRole))
    .map((item) =>
      item.href === HOME_HREF_MARKER
        ? { ...item, href: resolveHomeForRole(userRole) }
        : item,
    )

  // Fix B2 round 1 review PR #440 — Skip `useUnreadCount` si aucun item
  // visible n'a `showUnreadBadge=true` (économise un fetch /api/messages/
  // unread-count sur tous les rôles qui n'ont pas accès à /messages).
  const hasBadgeItem = filteredItems.some((it) => it.showUnreadBadge)

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  const initials = userName
    ? userName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U"

  return (
    <UnreadCountProvider skip={!hasBadgeItem}>
    <TooltipProvider delay={300}>
      <div className="flex h-screen overflow-hidden bg-[var(--background)]">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "hidden md:flex h-screen flex-col border-e border-border bg-card transition-all duration-300",
            collapsed ? "w-16" : "w-64"
          )}
          aria-label="Navigation principale"
        >
          {/* Logo */}
          <div className="flex h-16 items-center gap-3 border-b border-border px-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-600">
              <span className="text-sm font-bold text-white">D</span>
            </div>
            {!collapsed && (
              <span className="text-lg font-semibold text-foreground">
                Diabeo
              </span>
            )}
          </div>

          <SidebarNav
            items={filteredItems}
            pathname={pathname}
            collapsed={collapsed}
          />

          {/* Collapse toggle */}
          <div className="border-t border-border p-2">
            <button
              onClick={() => toggleCollapsedCookie(!collapsed)}
              className="flex w-full items-center justify-center rounded-lg p-2 text-gray-400 hover:bg-muted hover:text-gray-600 transition-colors"
              aria-label={collapsed ? tNav("expandSidebar") : tNav("collapseSidebar")}
            >
              {collapsed ? (
                <ChevronRight className="h-5 w-5 rtl:rotate-180" />
              ) : (
                <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
              )}
            </button>
          </div>

          {/* Logout */}
          <div className="border-t border-border p-3">
            <button
              onClick={logout}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600",
                collapsed && "justify-center px-2"
              )}
              aria-label={t("common.logout")}
            >
              <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
              {!collapsed && <span>{t("common.logout")}</span>}
            </button>
          </div>
        </aside>

        {/* Mobile sidebar (Sheet overlay) */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">{tNav("navigation")}</SheetTitle>
            <div className="flex h-16 items-center gap-3 border-b border-border px-6">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600">
                <span className="text-sm font-bold text-white">D</span>
              </div>
              <span className="text-lg font-semibold text-foreground">
                Diabeo
              </span>
            </div>
            <SidebarNav
              items={filteredItems}
              pathname={pathname}
              collapsed={false}
              onItemClick={closeMobile}
            />
            <div className="border-t border-border p-3">
              <button
                onClick={() => {
                  closeMobile()
                  logout()
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-red-50 hover:text-red-600"
                aria-label={t("common.logout")}
              >
                <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
                {t("common.logout")}
              </button>
            </div>
          </SheetContent>
        </Sheet>

        {/* Main content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 md:px-6">
            <div className="flex items-center gap-3">
              {/* Mobile hamburger */}
              <button
                onClick={() => setMobileOpen(true)}
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted md:hidden"
                aria-label={tNav("openNavigation")}
                aria-expanded={mobileOpen}
              >
                <Menu className="h-5 w-5" />
              </button>

              <div>
                <h1 className="text-lg font-semibold text-foreground">
                  {pageTitle}
                </h1>
                {pageSubtitle && (
                  <p className="text-sm text-muted-foreground">{pageSubtitle}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Refresh button */}
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label={t("common.refresh")}
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              )}

              {/* Notifications */}
              <button
                className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label={tNav("notifications")}
              >
                <Bell className="h-5 w-5" />
              </button>

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-muted transition-colors"
                  aria-label={t("nav.profile")}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-teal-100 text-teal-700 text-xs font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {userName && (
                    <>
                      <div className="px-2 py-1.5 text-sm font-medium text-foreground">
                        {userName}
                      </div>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem>
                    <Link href="/settings" className="flex items-center gap-2 w-full">
                      <User className="h-4 w-4" />
                      {t("nav.profile")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Link href="/settings" className="flex items-center gap-2 w-full">
                      <Settings className="h-4 w-4" />
                      {t("nav.settings")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={logout}
                    className="text-red-600 focus:text-red-600"
                  >
                    <LogOut className="h-4 w-4" />
                    {t("common.logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            {breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
            {/* US-2112b AC-3 — alerte si langue active ≠ préférence enregistrée. */}
            <LocaleReconciliationBanner />
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
    </UnreadCountProvider>
  )
}

export type { NavigationShellProps, BreadcrumbItem, UserRole, NavItem }
