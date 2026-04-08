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

import { useState, useCallback } from "react"
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
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
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
}

// --- Constants ---

const ROLE_HIERARCHY: Record<UserRole, number> = {
  VIEWER: 0,
  NURSE: 1,
  DOCTOR: 2,
  ADMIN: 3,
}

const navItems: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/patients", labelKey: "patients", icon: Users },
  { href: "/medications", labelKey: "medications", icon: Pill },
  { href: "/analytics", labelKey: "analytics", icon: Activity },
  { href: "/weekly", labelKey: "weekly", icon: CalendarDays },
  { href: "/documents", labelKey: "documents", icon: FileText },
  { href: "/import", labelKey: "import", icon: Download, minRole: "DOCTOR" },
  { href: "/users", labelKey: "users", icon: Users, minRole: "ADMIN" },
  { href: "/audit", labelKey: "audit", icon: FileText, minRole: "ADMIN" },
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

  return (
    <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Menu principal">
      {items.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`)
        const label = t(item.labelKey)

        const linkEl = (
          <Link
            href={item.href}
            onClick={onItemClick}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              collapsed && "justify-center px-2",
              isActive
                ? "bg-teal-50 text-teal-600"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            {!collapsed && <span>{label}</span>}
          </Link>
        )

        if (collapsed) {
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger className="w-full">{linkEl}</TooltipTrigger>
              <TooltipContent side="inline-end">
                <p>{label}</p>
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

// --- Main Component ---

export function NavigationShell({
  children,
  pageTitle,
  pageSubtitle,
  breadcrumbs = [],
  userRole = "VIEWER",
  userName,
  onRefresh,
}: NavigationShellProps) {
  const t = useTranslations()
  const tNav = useTranslations("nav")
  const pathname = usePathname()
  const { logout } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const filteredItems = navItems.filter((item) =>
    hasRoleAccess(userRole, item.minRole)
  )

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
              onClick={() => setCollapsed((c) => !c)}
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
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}

export type { NavigationShellProps, BreadcrumbItem, UserRole, NavItem }
