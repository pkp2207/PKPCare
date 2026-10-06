// Role-aware admin navigation (pure). Every link must be reachable by the role
// per ADMIN_ROUTE_ROLES; a test enforces that so nav and middleware cannot drift.
import type { Role } from "@/lib/auth/roles";

export type AdminNavItem = {
  href: string;
  label: string;
  roles: readonly Role[];
  /** When true only an exact pathname match marks the item current. */
  exact?: boolean;
};

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin", label: "Appointments", roles: ["admin", "frontdesk"], exact: true },
  { href: "/admin/schedule", label: "My schedule", roles: ["doctor"] },
  { href: "/admin/doctors", label: "Doctors", roles: ["admin"] },
  { href: "/admin/staff", label: "Staff", roles: ["admin"] },
  { href: "/admin/analytics", label: "Analytics", roles: ["admin", "frontdesk"] },
  { href: "/admin/privacy", label: "Privacy requests", roles: ["admin"] },
  { href: "/admin/audit", label: "Audit", roles: ["admin"] },
];

export const navItemsForRole = (role: Role): AdminNavItem[] =>
  ADMIN_NAV.filter((item) => item.roles.includes(role));

export const isNavItemCurrent = (item: AdminNavItem, pathname: string) =>
  item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);

/** Where a role lands when it opens /admin. */
export const homeForRole = (role: Role): string =>
  role === "doctor" ? "/admin/schedule" : "/admin";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  frontdesk: "Front desk",
  doctor: "Doctor",
};
