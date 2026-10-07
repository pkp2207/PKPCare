import { test } from "@playwright/test";

import { newStaffContext } from "./support/auth";
import { expectNoSeriousA11yViolations } from "./support/page-checks";

// Serious/critical WCAG 2.x A/AA violations fail the suite. Automated scans find only
// part of the problems (roughly a third); keyboard and screen-reader checks are still manual.
// Rules disabled below each need a reason.
const PUBLIC_PAGES = ["/", "/login", "/login/staff", "/privacy"];
const ADMIN_PAGES = [
  "/admin",
  "/admin/doctors",
  "/admin/staff",
  "/admin/analytics",
  "/admin/privacy",
  "/admin/audit",
];

test.describe("accessibility (axe)", () => {
  for (const path of PUBLIC_PAGES) {
    test(`public ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoSeriousA11yViolations(page);
    });
  }

  for (const path of ADMIN_PAGES) {
    test(`admin ${path}`, async ({ browser }) => {
      const { context, page } = await newStaffContext(browser, "admin");
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoSeriousA11yViolations(page);
      await context.close();
    });
  }
});
