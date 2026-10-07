import { expect, test } from "@playwright/test";

import { newStaffContext } from "./support/auth";
import { expectStyled, watchErrors } from "./support/page-checks";

const ADMIN_PAGES = [
  { path: "/admin", heading: /appointments/i },
  { path: "/admin/doctors", heading: /doctors/i },
  { path: "/admin/staff", heading: /staff/i },
  { path: "/admin/analytics", heading: /analytics/i },
  { path: "/admin/privacy", heading: /privacy/i },
  { path: "/admin/audit", heading: /audit/i },
  { path: "/admin/schedule", heading: /schedule/i },
];

test.describe("admin console (admin role)", () => {
  for (const { path, heading } of ADMIN_PAGES) {
    test(`${path} renders styled with no errors`, async ({ browser }) => {
      const { context, page } = await newStaffContext(browser, "admin");
      const errors = watchErrors(page);
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await expectStyled(page);
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test("appointments page lists real data with status filters", async ({ browser }) => {
    const { context, page } = await newStaffContext(browser, "admin");
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: /^all/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /scheduled/i }).first()).toBeVisible();
    await page.getByRole("link", { name: /^pending/i }).first().click();
    await expect(page).toHaveURL(/status=pending/);
    await expect(page.getByRole("table")).toBeVisible();
    await context.close();
  });

  test("navigation links reach every console page", async ({ browser }) => {
    const { context, page } = await newStaffContext(browser, "admin");
    await page.goto("/admin");
    const nav = page.getByRole("navigation").first();
    for (const name of ["Doctors", "Staff", "Analytics", "Privacy requests", "Audit"]) {
      await nav.getByRole("link", { name }).click();
      await expect(page).toHaveURL(/\/admin\//);
      await page.goBack();
    }
    await context.close();
  });

  test("sign out ends the session", async ({ browser }) => {
    const { context, page } = await newStaffContext(browser, "admin");
    await page.goto("/admin");
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login\/staff/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\/staff/);
    await context.close();
  });
});

test.describe("role restrictions", () => {
  test("front desk cannot open admin-only pages", async ({ browser }) => {
    const { context, page } = await newStaffContext(browser, "frontdesk");
    for (const path of ["/admin/staff", "/admin/doctors", "/admin/audit", "/admin/privacy"]) {
      await page.goto(path);
      await expect(page, `${path} must not be reachable by frontdesk`).not.toHaveURL(
        new RegExp(`${path}$`)
      );
    }
    await page.goto("/admin/analytics");
    await expect(page.getByRole("heading", { name: /analytics/i }).first()).toBeVisible();
    await context.close();
  });

  test("doctor role is sent to its own schedule", async ({ browser }) => {
    const { context, page } = await newStaffContext(browser, "doctor");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/schedule/);
    await context.close();
  });
});
