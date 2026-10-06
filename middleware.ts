import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

export async function middleware(request: NextRequest) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  // Fail closed: missing secret or invalid/expired/forged token => back to login.
  const authed = secret ? await verifySessionToken(token, secret) : false;

  if (!authed) {
    return NextResponse.redirect(new URL("/?admin=true", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
