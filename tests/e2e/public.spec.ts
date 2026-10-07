import { expect, test } from "@playwright/test";

import { expectStyled, watchErrors } from "./support/page-checks";

const PUBLIC_PAGES = [
  { path: "/", heading: /hi there/i },
  { path: "/login", heading: /sign in|welcome|verify|code/i },
  { path: "/login/staff", heading: /staff|sign in/i },
  { path: "/privacy", heading: /privacy/i },
];

test.describe("public pages", () => {
  for (const { path, heading } of PUBLIC_PAGES) {
    test(`${path} renders styled with no errors`, async ({ page }) => {
      const errors = watchErrors(page);
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await expectStyled(page);
      expect(errors).toEqual([]);
    });
  }

  test("security headers are set", async ({ request }) => {
    const response = await request.get("/privacy");
    const headers = response.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toContain("max-age");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });

  test("favicon is served", async ({ request }) => {
    const response = await request.get("/favicon.ico");
    expect(response.status()).toBe(200);
  });
});

test.describe("closed endpoints", () => {
  test("admin pages redirect anonymous visitors to staff login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\/staff\?next=%2Fadmin/);
  });

  test("cron routes reject calls without the bearer secret", async ({ request }) => {
    for (const path of ["/api/cron/reminders", "/api/cron/retention"]) {
      expect((await request.get(path)).status()).toBe(401);
      expect(
        (await request.get(path, { headers: { authorization: "Bearer wrong" } })).status()
      ).toBe(401);
    }
  });

  test("FHIR API is disabled by default and read-only", async ({ request }) => {
    expect((await request.get("/api/fhir/metadata")).status()).toBe(404);
    expect((await request.post("/api/fhir/Patient", { data: {} })).status()).toBe(404);
  });

  test("invalid signed links show a friendly page, not an error", async ({ page }) => {
    for (const path of ["/visit/not-a-token", "/a/not-a-token"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(500);
      await expect(page.getByText(/invalid|expired|not available/i).first()).toBeVisible();
    }
  });

  test("staff login rejects wrong credentials without revealing which part was wrong", async ({
    page,
  }) => {
    await page.goto("/login/staff");
    await page.getByLabel(/email/i).fill("nobody+e2e@example.com");
    await page.locator("#staff-password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: /sign in|log in|continue/i }).click();
    // Next renders its own role="alert" route announcer, so scope to the form message.
    await expect(page.locator("p[role=alert]")).toContainText(/invalid email or password/i);
  });
});
