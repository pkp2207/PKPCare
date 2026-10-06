// Server only: do not import from client components (uses next/headers).
import { cookies } from "next/headers";

import { isLegacyPasskeyAllowed } from "@/lib/auth/config";
import { hasRole, type Role } from "@/lib/auth/roles";
import { SESSION_COOKIE, readStaffToken } from "@/lib/auth/session";

export class AdminAuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AdminAuthError";
  }
}

export type StaffSession = {
  userId: string;
  email: string | null;
  name: string | null;
  role: Role;
};

// Valid, unexpired, correctly signed staff session (or, while
// ALLOW_LEGACY_ADMIN_PASSKEY is not "false", a legacy passkey session which maps
// to role "admin"). Fails closed if ADMIN_SESSION_SECRET is not configured.
export async function getStaffSession(): Promise<StaffSession | null> {
  // Read cookies first, unconditionally: it opts the caller into dynamic rendering.
  // Returning early on a missing secret would let a build without runtime env
  // prerender admin pages as static (baked-in redirect) instead of per request.
  const token = cookies().get(SESSION_COOKIE)?.value;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return null;

  const session = await readStaffToken(token, secret, isLegacyPasskeyAllowed());
  if (!session || !session.role) return null;

  return {
    userId: session.sub,
    email: session.email ?? null,
    name: session.name ?? null,
    role: session.role,
  };
}

export async function isAdminAuthenticated(): Promise<boolean> {
  return (await getStaffSession()) !== null;
}

// Any valid staff session (any role). Use at the top of staff-only server
// actions / route handlers; prefer requireRole() when a role restriction applies.
export async function requireAdmin(): Promise<void> {
  if (!(await getStaffSession())) {
    throw new AdminAuthError();
  }
}

// Throws AdminAuthError unless a staff session exists and its role is one of
// `roles`. With no arguments, any staff role is accepted.
export async function requireRole(...roles: Role[]): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) throw new AdminAuthError();
  if (!hasRole(session.role, roles)) {
    throw new AdminAuthError("Forbidden");
  }
  return session;
}
