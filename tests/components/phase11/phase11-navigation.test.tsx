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
 * Items with minRole="ADMIN": /users, /audit
 * All other items visible to all roles.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { usePathname } from "next/navigation"

// --- Mocks (must be before component import) ---

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard"),
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
 */
function getNavLinks(container: HTMLElement): HTMLAnchorElement[] {
  const allLinks = container.querySelectorAll<HTMLAnchorElement>("a[href]")
  const navPaths = [
    "/dashboard",
    "/patients",
    "/medications",
    "/analytics",
    "/documents",
    "/users",
    "/audit",
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

  describe("RBAC — navigation item filtering", () => {
    it("VIEWER sees 6 nav items (no Users, no Audit)", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="VIEWER">
          <div>content</div>
        </NavigationShell>
      )
      const hrefs = getUniqueNavHrefs(container)
      expect(hrefs).toHaveLength(6)
      expect(hrefs).not.toContain("/users")
      expect(hrefs).not.toContain("/audit")
    })

    it("NURSE sees 6 nav items (no Users, no Audit)", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="NURSE">
          <div>content</div>
        </NavigationShell>
      )
      const hrefs = getUniqueNavHrefs(container)
      expect(hrefs).toHaveLength(6)
      expect(hrefs).not.toContain("/users")
      expect(hrefs).not.toContain("/audit")
    })

    it("DOCTOR sees 6 nav items (no Users, no Audit)", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="DOCTOR">
          <div>content</div>
        </NavigationShell>
      )
      const hrefs = getUniqueNavHrefs(container)
      expect(hrefs).toHaveLength(6)
      expect(hrefs).not.toContain("/users")
      expect(hrefs).not.toContain("/audit")
    })

    it("ADMIN sees 8 nav items (includes Users + Audit)", () => {
      const { container } = render(
        <NavigationShell pageTitle="Dashboard" userRole="ADMIN">
          <div>content</div>
        </NavigationShell>
      )
      const hrefs = getUniqueNavHrefs(container)
      expect(hrefs).toHaveLength(8)
      expect(hrefs).toContain("/users")
      expect(hrefs).toContain("/audit")
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
