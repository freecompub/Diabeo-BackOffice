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
  Settings,
  LogOut,
  Menu,
  ChevronLeft,
  ChevronRight,
  Bell,
  RefreshCw,
  Search,
  User,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { Logo, LogoMark } from "@/components/diabeo/brand/Logo"
import {
  UnreadCountProvider,
  useUnreadCountFromContext,
} from "@/components/diabeo/messaging/UnreadCountContext"
import { resolveHomeForRole } from "@/lib/auth/role-home"
import {
  sidebarNavItems,
  patientNavItems,
  managementNavItems,
  hasRoleAccess,
  HOME_HREF_MARKER,
  type NavItem,
  type UserRole,
} from "@/components/diabeo/navigation-items"
import { CommandPalette } from "@/components/diabeo/CommandPalette"
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
  /**
   * US-2606 — capacité de gestion cabinet (Q2). Résolue **serveur** dans le
   * layout (`hasManagementCapability`). Quand `true` (et variant `pro`), la
   * sidebar rend le bloc « Gestion cabinet » sous un séparateur. Défaut `false`
   * (fail-safe : pas de bloc gestion si la capacité n'a pas pu être résolue).
   */
  canManageOrg?: boolean
}

// --- Constants ---
// Définitions de nav (UserRole, NavItem, navItems, patientNavItems,
// ROLE_HIERARCHY, hasRoleAccess, HOME_HREF_MARKER) extraites dans
// `./navigation-items` — source unique partagée avec `CommandPalette` (US-2601).

// --- Sidebar Content ---

function SidebarNav({
  items,
  managementItems,
  pathname,
  collapsed,
  onItemClick,
}: {
  items: NavItem[]
  /**
   * US-2606 — items du bloc « Gestion cabinet » (Q2). Rendus sous un séparateur
   * « — GESTION — » quand non vide ; le parent ne les passe que si Q2 = true
   * (gating serveur). Pas de badge non-lu sur ces items (PII admin, pas de soin).
   */
  managementItems?: NavItem[]
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

  const renderItem = (item: NavItem) => {
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
              // min-h-11 (44px) — cible tactile WCAG 2.5.5 (tablette) ; ≥ 24px desktop OK.
              "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors relative",
              collapsed && "justify-center px-2",
              isActive
                ? "bg-role-soft text-role-text"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="relative shrink-0">
              <item.icon className="h-5 w-5" aria-hidden="true" />
              {showBadge && collapsed && (
                // Mode collapsed : badge en overlay sur l'icône (top-right corner).
                <span
                  className="absolute -top-1 -end-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
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
                    className="ms-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground"
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
  }

  const hasManagement = !!managementItems && managementItems.length > 0

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label={t("mainMenu")}>
      {/* Bloc clinique (Q1) — cf. US-2600. */}
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.href}>{renderItem(item)}</li>
        ))}
      </ul>

      {/* US-2606 — Bloc « Gestion cabinet » (Q2) : séparateur + items, rendu
          uniquement si le parent a passé des managementItems (gating serveur). */}
      {hasManagement && (
        <>
          {collapsed ? (
            // Mode replié : pas de libellé visible → simple divider visuel.
            <div className="my-2 border-t border-border" role="separator" />
          ) : (
            // Mode étendu : vrai titre de section (pas un `role="separator"`
            // porteur de texte, sémantiquement ambigu pour les lecteurs d'écran).
            <h2 className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("gestionSection")}
            </h2>
          )}
          <ul className="space-y-1" aria-label={t("gestionSection")}>
            {managementItems!.map((item) => (
              <li key={item.href}>{renderItem(item)}</li>
            ))}
          </ul>
        </>
      )}
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
                  className="hover:text-primary transition-colors"
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
  canManageOrg = false,
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
  // US-2623 — ouverture contrôlée de la palette depuis le bouton de recherche visible.
  const [searchOpen, setSearchOpen] = useState(false)

  // US-2600 — sidebar maigre côté pro (sous-ensemble destinations) ; la palette
  // Ctrl-K (CommandPalette) garde l'accès à toutes les sections autorisées.
  const sourceItems = variant === "patient" ? patientNavItems : sidebarNavItems
  const filteredItems = sourceItems
    .filter((item) => hasRoleAccess(userRole, item.minRole))
    .map((item) =>
      item.href === HOME_HREF_MARKER
        ? {
            ...item,
            href: resolveHomeForRole(userRole),
            // US-2602 (Ma journée) — le home médecin est libellé « Ma journée »
            // (vue jour : urgences, RDV, relances, propositions, messages).
            // Les autres rôles gardent « Tableau de bord » (libellé générique).
            labelKey: userRole === "DOCTOR" ? "dashboardMedecin" : item.labelKey,
          }
        : item,
    )

  // Fix B2 round 1 review PR #440 — Skip `useUnreadCount` si aucun item
  // visible n'a `showUnreadBadge=true` (économise un fetch /api/messages/
  // unread-count sur tous les rôles qui n'ont pas accès à /messages).
  const hasBadgeItem = filteredItems.some((it) => it.showUnreadBadge)

  // US-2606 — bloc « Gestion cabinet » : uniquement côté pro et si Q2 (gating
  // serveur via `canManageOrg`). `undefined` => SidebarNav ne rend pas le bloc.
  const managementItems =
    variant === "pro" && canManageOrg ? managementNavItems : undefined

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  const initials = userName
    ? userName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U"

  // Accent par rôle (design-system §Role Accent). Pose `data-role` sur la
  // racine du shell → résout --role-accent* (teal par défaut, nurse=indigo,
  // admin=slate). Doctor & patient retombent sur le teal par défaut.
  const roleSlug =
    variant === "patient" || userRole === "VIEWER"
      ? "patient"
      : userRole === "ADMIN"
        ? "admin"
        : userRole === "NURSE"
          ? "nurse"
          : "doctor"

  return (
    <UnreadCountProvider skip={!hasBadgeItem}>
    <TooltipProvider delay={300}>
      {/* US-2601 — Palette de commande Ctrl/Cmd-K (staff uniquement). */}
      {variant === "pro" && (
        <CommandPalette userRole={userRole} open={searchOpen} onOpenChange={setSearchOpen} />
      )}
      <div data-role={roleSlug} className="flex h-screen overflow-hidden bg-[var(--background)]">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "hidden md:flex h-screen flex-col border-e border-border bg-card transition-all duration-300",
            collapsed ? "w-16" : "w-64"
          )}
          aria-label="Navigation principale"
        >
          {/* Logo */}
          <div className="flex h-16 items-center border-b border-border px-4">
            {collapsed ? (
              <LogoMark size={32} />
            ) : (
              <Logo variant="full" size={28} />
            )}
          </div>

          <SidebarNav
            items={filteredItems}
            managementItems={managementItems}
            pathname={pathname}
            collapsed={collapsed}
          />

          {/* Collapse toggle */}
          <div className="border-t border-border p-2">
            <button
              onClick={() => toggleCollapsedCookie(!collapsed)}
              className="flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
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
                "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
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
            <div className="flex h-16 items-center border-b border-border px-6">
              <Logo variant="full" size={28} />
            </div>
            <SidebarNav
              items={filteredItems}
              managementItems={managementItems}
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
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
              {/* US-2623 — déclencheur de recherche visible (ouvre la palette
                  US-2601). Desktop : barre « Rechercher… ⌘K » ; mobile : loupe.
                  Staff uniquement (la palette n'existe qu'en variant `pro`). */}
              {variant === "pro" && (
                <button
                  onClick={() => setSearchOpen(true)}
                  className="flex min-h-11 items-center gap-2 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:min-w-56 md:justify-start md:border md:border-border md:px-3"
                  aria-label={tNav("search")}
                >
                  <Search className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="hidden flex-1 text-start text-sm md:inline">{tNav("search")}</span>
                  <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-xs md:inline" aria-hidden="true">
                    {tNav("searchShortcut")}
                  </kbd>
                </button>
              )}

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
                    <AvatarFallback className="bg-primary/15 text-primary text-xs font-medium">
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
                    className="text-destructive focus:text-destructive"
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

export type { NavigationShellProps, BreadcrumbItem }
export type { UserRole, NavItem }
