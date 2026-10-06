// Who is calling an AI action (for rate limits and the audit record). Server only.
// Never throws: outside a request scope, or with no session, the caller is
// simply anonymous.
import { getStaffSession } from "@/lib/auth/admin";
import { getPatientSession } from "@/lib/auth/patient";
import { getRequestContext } from "@/lib/compliance/request-context";

import type { AiCaller } from "./rate-limit";

export type AiActor = AiCaller & { role: string };

export const resolveAiActor = async (): Promise<AiActor> => {
  const { ip } = getRequestContext();
  try {
    const staff = await getStaffSession();
    if (staff) return { userId: staff.userId, role: staff.role, ip };
  } catch {
    // fall through to patient / anonymous
  }
  try {
    const patient = await getPatientSession();
    if (patient) return { userId: patient.userId, role: "patient", ip };
  } catch {
    // fall through to anonymous
  }
  return { userId: null, role: "anonymous", ip };
};
