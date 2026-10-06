"use server";

import { headers } from "next/headers";

import { requestPatientOtp } from "@/lib/actions/auth.actions";
import * as patientRepo from "@/lib/appwrite/patient.repository";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { UserFormValidation } from "@/lib/validation";

// Onboarding for PATIENT_AUTH_ENFORCED=true. Unlike createUser() this NEVER
// returns a user id: the only way to learn it is to prove ownership of the
// email through the one-time code (verifyPatientOtp). The response is the same
// whether the email was new or already registered, so it cannot be used to find
// out who has an account.

const WINDOW_MS = 15 * 60 * 1000;
// Separate from the OTP limiter in auth.actions: this one bounds account
// creation (Appwrite user rows) per client. In memory, per instance.
const startByIp = createRateLimiter({ max: 10, windowMs: WINDOW_MS });

const LOCKED = "Too many attempts. Please try again later.";

const clientIp = (): string => {
  try {
    const h = headers();
    const forwarded = h.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
};

/**
 * Step 1 of enforced onboarding: create the Appwrite user if there is none for
 * this email (an existing user is left untouched - name/phone are NOT
 * overwritten, so this cannot be used to edit someone else's account), then
 * email a 6-digit code via requestPatientOtp. The UI moves to the code step and
 * calls verifyPatientOtp, which sets the session and returns the userId.
 *
 * Always `{ ok: true }` for well-formed input unless rate limited. Internal
 * failures (Appwrite down, email provider not configured) are logged, not
 * surfaced, because surfacing them would differ between new and existing
 * emails. Check the server log for `startPatientRegistration` /
 * `requestPatientOtp failed` if codes do not arrive.
 */
export const startPatientRegistration = async (input: {
  name: string;
  email: string;
  phone: string;
}): Promise<ActionResult<null>> => {
  const parsed = UserFormValidation.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ip = clientIp();
  if (startByIp.isLimited(ip)) return { ok: false, error: LOCKED };
  startByIp.hit(ip);

  const email = parsed.data.email.trim().toLowerCase();

  try {
    // createUser() in the repo returns the existing user on a 409; the result is
    // deliberately discarded so no id can leak.
    await patientRepo.createUser({
      name: parsed.data.name,
      email,
      phone: parsed.data.phone,
    });
  } catch (error) {
    console.error("startPatientRegistration: could not create user", error);
  }

  const otp = await requestPatientOtp(email);
  if (!otp.ok) return { ok: false, error: otp.error };

  return { ok: true, data: null };
};
