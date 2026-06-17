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
  UsersRound,
  Receipt,
  CreditCard,
  Building2,
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

/**
 * Sidebar maigre (US-2600, décisions D1/D3) — **destinations seulement**,
 * sous-ensemble ORDONNÉ de la source canonique `navItems` (pas de liste
 * dupliquée → pas de drift). Les sections hors sidebar (Médicaments,
 * Dispositifs, Insulinothérapie, Weekly, Import, Administration…) ne sont PAS
 * supprimées : elles restent joignables via la palette Ctrl-K (US-2601), et
 * rejoindront les onglets du dossier patient (US-2604) / l'espace admin dédié
 * (US-2613). La palette consomme toujours `navItems` complet.
 */
const SIDEBAR_ORDER: string[] = [
  HOME_HREF_MARKER, // Ma journée
  "/patients",
  "/appointments", // Rendez-vous
  "/messages", // Messagerie
  "/documents",
  "/analytics",
  "/settings", // Paramètres
]
export const sidebarNavItems: NavItem[] = SIDEBAR_ORDER.map((href) =>
  navItems.find((item) => item.href === href),
).filter((item): item is NavItem => item !== undefined)

// Garde anti-drift : un href de `SIDEBAR_ORDER` introuvable dans `navItems`
// (typo, route renommée d'un seul côté) doit échouer FORT au boot, pas
// produire silencieusement une sidebar tronquée (cf. revue PR #542).
if (sidebarNavItems.length !== SIDEBAR_ORDER.length) {
  const missing = SIDEBAR_ORDER.filter((h) => !navItems.some((i) => i.href === h))
  throw new Error(`navigation-items: SIDEBAR_ORDER href(s) absent(s) de navItems: ${missing.join(", ")}`)
}

/** Patient self-service nav (VIEWER, layout `(patient)`). */
export const patientNavItems: NavItem[] = [
  { href: "/patient/dashboard", labelKey: "patientHome", icon: Home },
  { href: "/patient/appointments", labelKey: "appointments", icon: CalendarClock },
  { href: "/settings", labelKey: "settings", icon: Settings },
]

/**
 * US-2606 — Bloc « Gestion cabinet » (Variante A). Destinations **cabinet-agnostiques**
 * (sans `[id]`) : chaque route résout le scope managé du caller serveur (1 → direct,
 * N → sélecteur). Rendu **uniquement si Q2** (`canManageOrg`), sous un séparateur
 * « — GESTION — ». Groupé/isolé dès la V1 pour préparer la bascule B (US-2607) sans
 * refonte. Labels dans le namespace nav (`gestion*`). Aucun acronyme nu.
 *
 * Axe orthogonal au rôle clinique : ces items n'ouvrent AUCUN accès aux données de
 * santé (PII admin uniquement) → pas de `minRole`, le gating est porté par Q2 seul.
 *
 * ⚠️ Source de vérité du **routage** : ces `href` doivent matcher les routes
 * d'atterrissage `src/app/(dashboard)/cabinet/{team,billing,payments,settings}/`,
 * elles-mêmes mappées vers les segments per-id par `SECTION_SEGMENT`
 * (`CabinetManagementLanding.tsx`, ex. `team → members`). Tout renommage de route
 * doit toucher les trois (href ici + dossier de page + `SECTION_SEGMENT`) ; le test
 * `phase11-navigation` vérifie la présence des 4 href dans la sidebar Q2.
 */
export const managementNavItems: NavItem[] = [
  { href: "/cabinet/team", labelKey: "gestionTeam", icon: UsersRound },
  { href: "/cabinet/billing", labelKey: "gestionBilling", icon: Receipt },
  { href: "/cabinet/payments", labelKey: "gestionPayments", icon: CreditCard },
  { href: "/cabinet/settings", labelKey: "gestionSettings", icon: Building2 },
]
