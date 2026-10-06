import { describe, expect, it } from "vitest";

import {
  ADMIN_NAV,
  homeForRole,
  isNavItemCurrent,
  navItemsForRole,
} from "@/components/admin/nav";
import { canAccessAdminPath } from "@/lib/auth/access";
import { ROLES } from "@/lib/auth/roles";

describe("role nav", () => {
  it("maps roles to the documented links", () => {
    expect(navItemsForRole("admin").map((i) => i.label)).toEqual([
      "Appointments",
      "Doctors",
      "Staff",
      "Analytics",
      "Privacy requests",
      "Audit",
    ]);
    expect(navItemsForRole("frontdesk").map((i) => i.label)).toEqual(["Appointments", "Analytics"]);
    expect(navItemsForRole("doctor").map((i) => i.label)).toEqual(["My schedule"]);
  });

  it("never links to a page the role cannot open (nav and middleware agree)", () => {
    for (const role of ROLES) {
      for (const item of navItemsForRole(role)) {
        expect(canAccessAdminPath(role, item.href), `${role} -> ${item.href}`).toBe(true);
      }
    }
  });

  it("route policy matches the spec", () => {
    for (const path of ["/admin/staff", "/admin/doctors", "/admin/audit", "/admin/privacy"]) {
      expect(canAccessAdminPath("admin", path)).toBe(true);
      expect(canAccessAdminPath("frontdesk", path)).toBe(false);
      expect(canAccessAdminPath("doctor", path)).toBe(false);
    }
    expect(canAccessAdminPath("frontdesk", "/admin/analytics")).toBe(true);
    expect(canAccessAdminPath("admin", "/admin/analytics")).toBe(true);
    expect(canAccessAdminPath("doctor", "/admin/analytics")).toBe(false);
    for (const role of ROLES) {
      expect(canAccessAdminPath(role, "/admin")).toBe(true);
      expect(canAccessAdminPath(role, "/admin/schedule")).toBe(true);
    }
  });

  it("marks the current item; /admin only matches exactly", () => {
    const appts = ADMIN_NAV.find((i) => i.href === "/admin")!;
    const docs = ADMIN_NAV.find((i) => i.href === "/admin/doctors")!;
    expect(isNavItemCurrent(appts, "/admin")).toBe(true);
    expect(isNavItemCurrent(appts, "/admin/doctors")).toBe(false);
    expect(isNavItemCurrent(docs, "/admin/doctors/x")).toBe(true);
  });

  it("doctors land on their schedule", () => {
    expect(homeForRole("doctor")).toBe("/admin/schedule");
    expect(homeForRole("admin")).toBe("/admin");
  });
});
