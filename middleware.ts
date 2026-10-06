import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { canAccessAdminPath, patientIdFromPath } from "@/lib/auth/access";
import { isLegacyPasskeyAllowed, isPatientAuthEnforced } from "@/lib/auth/config";
import {
  PATIENT_SESSION_COOKIE,
  SESSION_COOKIE,
  readPatientToken,
  readStaffToken,
} from "@/lib/auth/session";

function redirectTo(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Fail closed: missing secret => no valid session.
  const secret = process.env.ADMIN_SESSION_SECRET ?? "";

  // ---- Staff area: /admin/** -------------------------------------------------
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const staff = await readStaffToken(
      request.cookies.get(SESSION_COOKIE)?.value,
      secret,
      isLegacyPasskeyAllowed()
    );

    if (!staff) {
      // Staff login page links to the legacy /?admin=true passkey modal while
      // ALLOW_LEGACY_ADMIN_PASSKEY is on.
      const next = encodeURIComponent(`${pathname}${search}`);
      return redirectTo(request, `/login/staff?next=${next}`);
    }
    if (!canAccessAdminPath(staff.role, pathname)) {
      return redirectTo(request, "/login/staff?reason=forbidden");
    }
    return NextResponse.next();
  }

  // ---- Patient area: /patients/:userId/** -----------------------------------
  if (pathname === "/patients" || pathname.startsWith("/patients/")) {
    // Off by default until the patient login UI has shipped (phase 2).
    if (!isPatientAuthEnforced()) return NextResponse.next();

    // Staff may open any patient's pages (mirrors assertPatientOrStaffOwns).
    const staff = await readStaffToken(
      request.cookies.get(SESSION_COOKIE)?.value,
      secret,
      isLegacyPasskeyAllowed()
    );
    if (staff) return NextResponse.next();

    const patient = await readPatientToken(
      request.cookies.get(PATIENT_SESSION_COOKIE)?.value,
      secret
    );
    if (!patient) {
      // `next` is our own same-origin path+query, re-validated on /login.
      const next = encodeURIComponent(`${pathname}${search}`);
      return redirectTo(request, `/login?next=${next}`);
    }

    const requested = patientIdFromPath(pathname);
    if (requested !== null && requested !== patient.sub) {
      const url = request.nextUrl.clone();
      url.pathname = pathname.replace(
        /^\/patients\/[^/]+/,
        `/patients/${encodeURIComponent(patient.sub)}`
      );
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/patients", "/patients/:path*"],
};
