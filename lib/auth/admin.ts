// Server only: do not import from client components (uses next/headers).
import { cookies } from "next/headers";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

export class AdminAuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AdminAuthError";
  }
}

// True only when a valid, unexpired, correctly signed admin session cookie is present.
// Fails closed if ADMIN_SESSION_SECRET is not configured.
export async function isAdminAuthenticated(): Promise<boolean> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return false;

  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, secret);
}

// Use at the top of admin-only server actions / route handlers.
export async function requireAdmin(): Promise<void> {
  if (!(await isAdminAuthenticated())) {
    throw new AdminAuthError();
  }
}
