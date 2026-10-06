// Edge-safe route -> role policy, shared by middleware and server components.
import { ROLES, type Role } from "@/lib/auth/roles";

// Longest matching prefix wins. Any staff role may reach /admin itself; narrower
// areas are listed explicitly. Other agents adding admin sub-routes should add
// their prefix here (the pages must still call requireRole/requireStaffPage).
export const ADMIN_ROUTE_ROLES: ReadonlyArray<{
  prefix: string;
  roles: readonly Role[];
}> = [
  { prefix: "/admin/staff", roles: ["admin"] },
  { prefix: "/admin/doctors", roles: ["admin"] },
  { prefix: "/admin/audit", roles: ["admin"] },
  { prefix: "/admin/privacy", roles: ["admin"] },
  { prefix: "/admin/analytics", roles: ["admin", "frontdesk"] },
  { prefix: "/admin/schedule", roles: ROLES },
  { prefix: "/admin", roles: ROLES },
];

export function allowedRolesForAdminPath(pathname: string): readonly Role[] {
  let best: { prefix: string; roles: readonly Role[] } | null = null;
  for (const rule of ADMIN_ROUTE_ROLES) {
    const matches =
      pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`);
    if (matches && (!best || rule.prefix.length > best.prefix.length)) {
      best = rule;
    }
  }
  return best ? best.roles : [];
}

export function canAccessAdminPath(
  role: Role | null | undefined,
  pathname: string
): boolean {
  if (!role) return false;
  return allowedRolesForAdminPath(pathname).includes(role);
}

// Patient routes look like /patients/:userId/...; returns the userId segment.
export function patientIdFromPath(pathname: string): string | null {
  const match = /^\/patients\/([^/]+)(?:\/|$)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
