import type { Browser, BrowserContext, Page } from "@playwright/test";

import type { Role } from "@/lib/auth/roles";
import { SESSION_COOKIE, createSessionToken } from "@/lib/auth/session";

// Staff sessions are minted with the app's own signing secret, so the suite needs no
// password. Pages that look the user up in Appwrite see a staff token for a user id
// that does not exist, which is fine for the read-only pages exercised here.
export const staffCookie = async (role: Role = "admin") => {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set (loaded from .env)");
  return {
    name: SESSION_COOKIE,
    value: await createSessionToken(secret, 3600, {
      kind: "staff",
      sub: `e2e-${role}`,
      role,
      email: null,
      name: `E2E ${role}`,
    }),
    url: "http://localhost:3100",
    httpOnly: true,
    sameSite: "Strict" as const,
  };
};

export const newStaffContext = async (
  browser: Browser,
  role: Role = "admin"
): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext();
  await context.addCookies([await staffCookie(role)]);
  return { context, page: await context.newPage() };
};
