"use client"

/**
 * Dashboard sidebar — main navigation for the backoffice.
 * Displays navigation links with icons, user role badge, and logout button.
 */

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  LayoutDashboard,
  Users,
  Settings,
  FileText,
  LogOut,
  Activity,
  Pill,
  ShieldAlert,
  HardDrive,
  Heart,
  Building2,
  Receipt,
  UserCog,
  Percent,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LocaleSwitcher } from "./LocaleSwitcher"
import { Logo } from "./brand/Logo"

interface NavItem {
  href: string
  /** Fix M3 round 1 PR #457 — i18n key dans messages/{fr,en,ar}.json sous `sidebar.*`. */
  labelKey: string
  icon: typeof LayoutDashboard
  /** Si défini, item visible uniquement pour les rôles listés. */
  roles?: ReadonlyArray<"ADMIN" | "DOCTOR" | "NURSE" | "VIEWER">
}

const navItems: ReadonlyArray<NavItem> = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/patients", labelKey: "patients", icon: Users },
  { href: "/medications", labelKey: "medications", icon: Pill },
  { href: "/analytics", labelKey: "analytics", icon: Activity },
  { href: "/documents", labelKey: "documents", icon: FileText },
  { href: "/settings", labelKey: "settings", icon: Settings },
  // US-2137 RGPD Art. 33 (iter 1 PR — Groupe 9 Admin/Ops) — ADMIN-only.
  // Le gate côté server "/admin/data-breaches/page.tsx" redirige vers "/"
  // pour non-ADMIN, donc cacher l'item côté Sidebar évite la confusion UX.
  { href: "/admin/data-breaches", labelKey: "adminDataBreaches", icon: ShieldAlert, roles: ["ADMIN"] },
  // US-2150 + US-2151 (iter 2 PR Plan B) — ADMIN ops monitoring.
  { href: "/admin/system-health", labelKey: "adminSystemHealth", icon: Heart, roles: ["ADMIN"] },
  { href: "/admin/backups", labelKey: "adminBackups", icon: HardDrive, roles: ["ADMIN"] },
  // US-2117/2118 + US-2506 (iter 3 PR Plan B) — Admin cabinets + SMS config.
  { href: "/admin/cabinets", labelKey: "adminCabinets", icon: Building2, roles: ["ADMIN"] },
  // US-2102/2108 (iter 4 PR Plan B) — Admin invoices + PDF download.
  { href: "/admin/invoices", labelKey: "adminInvoices", icon: Receipt, roles: ["ADMIN"] },
  // US-2148 + US-2110 (iter 5 PR Plan B FINAL) — Admin users + tax rules.
  { href: "/admin/users", labelKey: "adminUsers", icon: UserCog, roles: ["ADMIN"] },
  { href: "/admin/tax-rules", labelKey: "adminTaxRules", icon: Percent, roles: ["ADMIN"] },
]

/**
 * ⚠️ SECURITY (Fix H6 round 1 review PR #457 — HSA HIGH-1) ⚠️
 *
 * Le cache `sessionStorage.diabeo_user_role` est utilisé **UNIQUEMENT** pour
 * gater la VISIBILITÉ d'items de navigation côté UI. Ce N'EST PAS une
 * source of truth de sécurité.
 *
 * La vraie authentification se fait :
 *   1. Server-side dans chaque "/admin/<route>/page.tsx" via `headers().get("x-user-role")`
 *      (JWT validé par middleware) → redirect "/" si non-ADMIN.
 *   2. Backend API dans `auditedRequireRole(ADMIN, ...)` (audit log automatique).
 *
 * Un attaquant XSS pourrait `sessionStorage.setItem("diabeo_user_role","ADMIN")`
 * et cliquer programmatically sur l'item ADMIN → mais click → server-side
 * redirect → backend refuse 403. Cache UI bypassé = juste leak existence route,
 * pas accès aux données.
 *
 * ⚠️ TOUTE référence à `diabeo_user_role` côté API/middleware = FAILLE CRITIQUE.
 *
 * Le cache est clear au logout via `useAuth.logout()` (Fix C1 round 1).
 */
const USER_ROLE_CACHE_KEY = "diabeo_user_role"

type KnownRole = "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"
const KNOWN_ROLES: ReadonlySet<KnownRole> = new Set(["ADMIN", "DOCTOR", "NURSE", "VIEWER"])

function isKnownRole(value: unknown): value is KnownRole {
  return typeof value === "string" && KNOWN_ROLES.has(value as KnownRole)
}

export function Sidebar() {
  const pathname = usePathname()
  const { logout } = useAuth()
  const t = useTranslations("sidebar")
  // US-2137 iter 1 — récupère le rôle courant pour filtrer items ADMIN-only.
  // Fix M5 round 1 PR #457 — type guard `isKnownRole` au lieu de cast `as`.
  const [role, setRole] = useState<KnownRole | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cached = sessionStorage.getItem(USER_ROLE_CACHE_KEY)
        if (cached && isKnownRole(cached)) {
          if (!cancelled) setRole(cached)
          return
        }
        const res = await fetch("/api/account", { credentials: "include" })
        if (!res.ok) return
        const data = (await res.json()) as { role?: unknown }
        if (isKnownRole(data.role) && !cancelled) {
          sessionStorage.setItem(USER_ROLE_CACHE_KEY, data.role)
          setRole(data.role)
        }
      } catch {
        // Silent — gate sera fail-closed (item ADMIN caché par défaut).
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const visibleItems = navItems.filter(
    (item) => !item.roles || (role !== null && (item.roles as readonly string[]).includes(role)),
  )

  return (
    <aside
      className="flex h-screen w-64 flex-col border-e border-border bg-white"
      aria-label="Navigation principale"
    >
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-border px-6">
        <Logo variant="full" size={28} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Menu principal">
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {t(item.labelKey as Parameters<typeof t>[0])}
            </Link>
          )
        })}
      </nav>

      {/* Locale switcher (US-2112) */}
      <div className="border-t border-border p-3">
        <LocaleSwitcher />
      </div>

      {/* Logout */}
      <div className="border-t border-border p-3">
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={t("logout")}
        >
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("logout")}
        </button>
      </div>
    </aside>
  )
}
