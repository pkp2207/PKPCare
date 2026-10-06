// Server only (server components / layouts). Redirects instead of throwing.
import { redirect } from "next/navigation";

import { getStaffSession, type StaffSession } from "@/lib/auth/admin";
import { hasRole, type Role } from "@/lib/auth/roles";

// Use in server components / layouts: returns the staff session, or redirects to
// staff login (no session) / back to login with a notice (wrong role).
export async function requireStaffPage(...roles: Role[]): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect("/login/staff");
  if (!hasRole(session.role, roles)) redirect("/login/staff?reason=forbidden");
  return session;
}
