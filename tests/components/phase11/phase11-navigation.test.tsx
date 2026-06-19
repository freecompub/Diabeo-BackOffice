/**
 * @vitest-environment jsdom
 */

/**
 * Tests for NavigationShell — responsive app layout with RBAC-filtered navigation.
 *
 * Clinical safety context: navigation filtering by role (RBAC) ensures that
 * unauthorized users cannot discover admin-only routes (Users, Audit) in the UI.
 * While API routes enforce server-side authorization, hiding navigation items
 * prevents accidental access attempts and reduces the attack surface.
 *
 * Role hierarchy: ADMIN > DOCTOR > NURSE > VIEWER
 * Items with minRole="ADMIN": /admin/users, /audit
 * All other items visible to all roles.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { usePathname } from "next/navigation"

// --- Mocks (must be before component import) ---

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard"),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

// US-2601 — la palette (Ctrl-K) est montée dans NavigationShell mais hors
// périmètre de ces tests (nav items / RBAC) ; on la neutralise pour éviter de
// tirer Dialog base-ui + le fetch de recherche patient.
vi.mock("@/components/diabeo/CommandPalette", () => ({
  CommandPalette: () => null,
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(() => ({ logout: vi.fn() })),
}))

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <button {...props}>{children}</button>,
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
}))

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
  AvatarFallback: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <span {...props}>{children}</span>,
}))

import { NavigationShell } from "@/components/diabeo/NavigationShell"

// --- Helpers ---

/**
 * Counts visible nav links (excludes logout buttons, breadcrumbs, etc.).
 * The sidebar renders links with href matching known nav paths.
 *
 * Round 2 review PR #426 — Le 1er item "Dashboard" pointe désormais sur
 * le home rôle-spécifique (`/medecin`, `/infirmier`, `/admin`,
 * `/patient/dashboard`) via `HOME_HREF_MARKER` résolu au render dans
 * `NavigationShell.tsx` (fix CRIT-1 `src/app/page.tsx` supprimé qui
 * shadowait `(dashboard)/page.tsx`). L'ancien path `/dashboard` est
 * remplacé par les 4 home roots possibles.
 *
 * Le sous-ensemble navPaths reste volontairement limité (les items
 * `/weekly`, `/insulin-therapy`, `/devices`, `/import` ne sont pas
 * testés ici — couverts par d'autres tests RBAC ailleurs si besoin).
 */
function getNavLinks(container: HTMLElement): HTMLAnchorElement[] {
  const allLinks = container.querySelectorAll<HTMLAnchorElement>("a[href]")
  const navPaths = [
    // Home roots résolus dynamiquement (HOME_HREF_MARKER) — remplacent
    // l'ancien `/dashboard` selon le role courant.
    "/medecin",
    "/infirmier",
    "/admin",
    "/patient/dashboard",
    "/patients",
    "/appointments", // US-2600 sidebar maigre (gated minRole NURSE)
    "/messages", // US-2600 sidebar maigre (gated minRole NURSE)
    "/medications", // hors sidebar US-2600 — sert de check négatif
    "/analytics",
    "/documents",
    "/admin/users", // hors sidebar US-2600 — check négatif
    "/audit", // hors sidebar US-2600 — check négatif
    "/settings",
  ]
  return Array.from(allLinks).filter((a) => navPaths.includes(a.getAttribute("href") || ""))
}

/**
 * Gets unique nav hrefs from the desktop sidebar (first occurrence of each).
 * The component renders nav items in both desktop sidebar and mobile sheet,
 * so we deduplicate by href.
 */
function getUniqueNavHrefs(container: HTMLElement): string[] {
  const links = getNavLinks(container)
  const seen = new Set<string>()
  const unique: string[] = []
  for (const link of links) {
    const href = link.getAttribute("href") || ""
    if (!seen.has(href)) {
      seen.add(href)
      unique.push(href)
    }
  }
  return unique
}

// --- Tests ---

describe("NavigationShell", () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue("/dashboard")
  })

  // US-2600 — Sidebar maigre : destinations seulement (Ma journée · Patients ·
  // Rendez-vous · Messagerie · Documents · Analytics · Paramètres). Les sections
  // hors sidebar (Médicaments, Administration : Users/Audit…) ne sont PLUS dans
  // la sidebar pour AUCUN rôle ; elles restent joignables via la palette Ctrl-K
  // (US-2601) / l'espace admin dédié (US-2613). Le gating minRole est exercé
  // ici (VIEWER < NURSE → pas de Rendez-vous/Messagerie) ET dans
  // command-palette.test.tsx (Users/Audit ADMIN-only côté palette).
  describe("RBAC — navigation item filtering (slim sidebar US-2600)", () => {
    // VIEWER+variant=pro n'existe pas en prod (VIEWER → variant=patient) ; cas
    // conservé pour vérifier le gating minRole sur la sidebar maigre.
    it("VIEWER : Rendez-vous/Messagerie filtrés (minRole NURSE), pas d'admin", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="VIEWER">
          <div>content</div>
        </NavigationShell>
      )
      const hrefs = getUniqueNavHrefs(container)
      expect(hrefs).toHaveLength(5) // 7 destinations − /appointments − /messages
      expect(hrefs).not.toContain("/appointments")
      expect(hrefs).not.toContain("/messages")
      expect(hrefs).not.toContain("/admin/users")
      expect(hrefs).not.toContain("/medications")
    })

    it("NURSE : 7 destinations (avec Rendez-vous + Messagerie), pas d'admin ni Médicaments", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="NURSE">
          <div>content</div>
        </NavigationShell>
      )
      const hrefs = getUniqueNavHrefs(container)
      expect(hrefs).toHaveLength(7)
      expect(hrefs).toContain("/appointments")
      expect(hrefs).toContain("/messages")
      expect(hrefs).not.toContain("/admin/users")
      expect(hrefs).not.toContain("/audit")
      expect(hrefs).not.toContain("/medications")
    })

    it("DOCTOR : 7 destinations, pas d'items admin ni Médicaments", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="DOCTOR">
          <div>content</div>
        </NavigationShell>
      )
      const hrefs = getUniqueNavHrefs(container)
      expect(hrefs).toHaveLength(7)
      expect(hrefs).not.toContain("/admin/users")
      expect(hrefs).not.toContain("/audit")
      expect(hrefs).not.toContain("/medications")
    })

    it("ADMIN : 7 destinations — Users/Audit déplacés hors sidebar (US-2600/US-2613)", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="ADMIN">
          <div>content</div>
        </NavigationShell>
      )
      const hrefs = getUniqueNavHrefs(container)
      expect(hrefs).toHaveLength(7)
      // Administration retirée de la sidebar clinique (joignable via palette /
      // futur espace admin) — ne doit plus apparaître ici.
      expect(hrefs).not.toContain("/admin/users")
      expect(hrefs).not.toContain("/audit")
      expect(hrefs).toContain("/patients")
      expect(hrefs).toContain("/analytics")
    })
  })

  describe("active page indication", () => {
    it("marks the current page with aria-current='page'", () => {
      vi.mocked(usePathname).mockReturnValue("/patients")
      const { container } = render(
        <NavigationShell pageTitle="Patients" userRole="VIEWER">
          <div>content</div>
        </NavigationShell>
      )
      const activeLinks = container.querySelectorAll("[aria-current='page']")
      // Desktop sidebar + mobile sheet both render the active link
      expect(activeLinks.length).toBeGreaterThanOrEqual(1)
      const firstActive = activeLinks[0] as HTMLAnchorElement
      expect(firstActive.getAttribute("href")).toBe("/patients")
    })

    it("does not mark non-active pages with aria-current", () => {
      vi.mocked(usePathname).mockReturnValue("/dashboard")
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="VIEWER">
          <div>content</div>
        </NavigationShell>
      )
      const patientsLinks = container.querySelectorAll("a[href='/patients']")
      for (const link of Array.from(patientsLinks)) {
        expect(link.getAttribute("aria-current")).toBeNull()
      }
    })
  })

  describe("page title and breadcrumbs", () => {
    it("renders the page title as an h1", () => {
      render(
        <NavigationShell pageTitle="Patients" userRole="VIEWER">
          <div>content</div>
        </NavigationShell>
      )
      const heading = screen.getByRole("heading", { level: 1 })
      expect(heading.textContent).toBe("Patients")
    })

    it("renders page subtitle when provided", () => {
      render(
        <NavigationShell pageTitle="Dashboard" pageSubtitle="Overview" userRole="VIEWER">
          <div>content</div>
        </NavigationShell>
      )
      expect(screen.getByText("Overview")).toBeTruthy()
    })

    it("renders breadcrumbs when provided", () => {
      render(
        <NavigationShell
          pageTitle="Patient Detail"
          userRole="VIEWER"
          breadcrumbs={[
            { label: "Patients", href: "/patients" },
            { label: "Jean Dupont" },
          ]}
        >
          <div>content</div>
        </NavigationShell>
      )
      expect(screen.getByText("Patients")).toBeTruthy()
      expect(screen.getByText("Jean Dupont")).toBeTruthy()
    })

    it("does not render breadcrumb nav when breadcrumbs is empty", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="VIEWER">
          <div>content</div>
        </NavigationShell>
      )
      // Breadcrumb nav has aria-label="nav.breadcrumb"
      const breadcrumbNav = container.querySelector("nav[aria-label='nav.breadcrumb']")
      expect(breadcrumbNav).toBeNull()
    })
  })

  describe("logout button", () => {
    it("renders at least one logout button with correct aria-label", () => {
      render(
        <NavigationShell pageTitle="Dashboard" userRole="VIEWER">
          <div>content</div>
        </NavigationShell>
      )
      // The desktop sidebar has a logout button with aria-label="common.logout"
      const logoutButtons = screen.getAllByLabelText("common.logout")
      expect(logoutButtons.length).toBeGreaterThanOrEqual(1)
    })
  })

  // US-2606 — Bloc « Gestion cabinet » (Q2). Rendu SSI `canManageOrg` (gating
  // serveur) ET variant pro. 4 destinations cabinet-agnostiques. Le rôle
  // clinique est orthogonal : un DOCTOR sans Q2 ne voit pas le bloc.
  describe("US-2606 — bloc Gestion cabinet (Q2)", () => {
    const GESTION_HREFS = [
      "/cabinet/team",
      "/cabinet/billing",
      "/cabinet/payments",
      "/cabinet/settings",
    ]

    it("canManageOrg=true → rend les 4 items + séparateur GESTION", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="DOCTOR" canManageOrg>
          <div>content</div>
        </NavigationShell>
      )
      for (const href of GESTION_HREFS) {
        expect(container.querySelector(`a[href="${href}"]`)).toBeTruthy()
      }
      // Séparateur libellé (mock i18n → clé namespacée).
      expect(screen.getAllByText("nav.gestionSection").length).toBeGreaterThanOrEqual(1)
    })

    it("canManageOrg absent (défaut) → aucun item gestion (absent du DOM)", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="DOCTOR">
          <div>content</div>
        </NavigationShell>
      )
      for (const href of GESTION_HREFS) {
        expect(container.querySelector(`a[href="${href}"]`)).toBeNull()
      }
      expect(screen.queryByText("nav.gestionSection")).toBeNull()
    })

    it("variant patient → pas de bloc gestion même si canManageOrg", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="VIEWER" variant="patient" canManageOrg>
          <div>content</div>
        </NavigationShell>
      )
      for (const href of GESTION_HREFS) {
        expect(container.querySelector(`a[href="${href}"]`)).toBeNull()
      }
    })
  })

  // US-2623 — bouton de recherche visible dans le header (ouvre la palette).
  // Staff (variant `pro`) uniquement ; absent pour l'espace patient.
  describe("US-2623 — bouton de recherche header", () => {
    it("pro : le bouton de recherche est rendu (aria-label nav.search)", () => {
      render(
        <NavigationShell pageTitle="Dashboard" userRole="DOCTOR">
          <div>content</div>
        </NavigationShell>
      )
      expect(screen.getByRole("button", { name: "nav.search" })).toBeTruthy()
    })

    it("patient : pas de bouton de recherche", () => {
      render(
        <NavigationShell pageTitle="Dashboard" userRole="VIEWER" variant="patient">
          <div>content</div>
        </NavigationShell>
      )
      expect(screen.queryByRole("button", { name: "nav.search" })).toBeNull()
    })
  })

  describe("user avatar", () => {
    it("renders user initials from userName", () => {
      render(
        <NavigationShell pageTitle="Dashboard" userRole="ADMIN" userName="Jean Dupont">
          <div>content</div>
        </NavigationShell>
      )
      expect(screen.getByText("JD")).toBeTruthy()
    })

    it("renders 'U' fallback when no userName", () => {
      render(
        <NavigationShell pageTitle="Dashboard" userRole="VIEWER">
          <div>content</div>
        </NavigationShell>
      )
      expect(screen.getByText("U")).toBeTruthy()
    })
  })

  describe("children rendering", () => {
    it("renders children inside the main content area", () => {
      render(
        <NavigationShell pageTitle="Dashboard" userRole="VIEWER">
          <div data-testid="child-content">Hello</div>
        </NavigationShell>
      )
      expect(screen.getByTestId("child-content")).toBeTruthy()
    })
  })
})
