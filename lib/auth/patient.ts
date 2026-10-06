// Server only: do not import from client components (uses next/headers).
import { cookies } from "next/headers";

import { getStaffSession, type StaffSession } from "@/lib/auth/admin";
import { isPatientAuthEnforced } from "@/lib/auth/config";
import { PATIENT_SESSION_COOKIE, readPatientToken } from "@/lib/auth/session";

export { isPatientAuthEnforced };

export class PatientAuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "PatientAuthError";
  }
}

export type PatientSession = { userId: string };

export async function getPatientSession(): Promise<PatientSession | null> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return null;

  const token = cookies().get(PATIENT_SESSION_COOKIE)?.value;
  const session = await readPatientToken(token, secret);
  return session ? { userId: session.sub } : null;
}

export async function requirePatient(): Promise<PatientSession> {
  const session = await getPatientSession();
  if (!session) throw new PatientAuthError();
  return session;
}

// Authorises access to a specific patient's data: any staff session, or the
// patient session whose userId matches.
//
// Enforcement is switchable. Until PATIENT_AUTH_ENFORCED === "true" (phase 2 ships
// the login UI) anonymous callers are allowed through as `{ actor: "patient" }`,
// preserving today's behaviour (patient pages trust the userId in the URL). Staff
// and matching patient sessions are still recognised when present so callers can
// attribute actions. When enforced, everything else throws PatientAuthError.
export async function assertPatientOrStaffOwns(
  userId: string
): Promise<{ actor: "patient" | "staff"; staff?: StaffSession }> {
  const staff = await getStaffSession();
  if (staff) return { actor: "staff", staff };

  if (!isPatientAuthEnforced()) return { actor: "patient" };

  const patient = await getPatientSession();
  if (patient && userId && patient.userId === userId) {
    return { actor: "patient" };
  }
  throw new PatientAuthError();
}
