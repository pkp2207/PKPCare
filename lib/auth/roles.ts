// Edge-safe (no Node / next/headers imports): usable from middleware, server
// code and tests.
//
// Permission map (enforced by call sites via requireRole / hasRole):
//
//   admin      Everything: staff + doctor management, audit log viewing, all
//              appointment and patient management.
//   frontdesk  Manage appointments and patients (schedule, confirm, cancel,
//              register). No staff/doctor management, no audit viewing.
//   doctor     Own schedule and own appointments only. No other doctors'
//              data, no patient-directory management.
//
// Staff are Appwrite users carrying a label equal to the role name. Patients are
// NOT roles: they authenticate with a separate patient session (see patient.ts).

export const ROLES = ["admin", "frontdesk", "doctor"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

// True when `role` is one of `allowed`. An empty `allowed` list means "any role".
export function hasRole(
  role: Role | null | undefined,
  allowed: readonly Role[]
): boolean {
  if (!role || !isRole(role)) return false;
  if (allowed.length === 0) return true;
  return allowed.includes(role);
}

// Picks the role from Appwrite user labels. If several role labels are present the
// most privileged wins (ROLES is ordered most to least privileged).
export function roleFromLabels(labels: readonly string[] | null | undefined): Role | null {
  if (!labels) return null;
  for (const role of ROLES) {
    if (labels.includes(role)) return role;
  }
  return null;
}
