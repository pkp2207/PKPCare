import { describe, expect, it } from "vitest";

import {
  allowedRolesForAdminPath,
  canAccessAdminPath,
  patientIdFromPath,
} from "@/lib/auth/access";
import { ROLES, hasRole, isRole, roleFromLabels } from "@/lib/auth/roles";

describe("roles", () => {
  it("lists the three roles", () => {
    expect([...ROLES]).toEqual(["admin", "frontdesk", "doctor"]);
  });

  it("hasRole matches allowed roles", () => {
    expect(hasRole("admin", ["admin"])).toBe(true);
    expect(hasRole("doctor", ["admin", "frontdesk"])).toBe(false);
    expect(hasRole("frontdesk", ["admin", "frontdesk"])).toBe(true);
  });

  it("hasRole with an empty allow-list accepts any valid role", () => {
    expect(hasRole("doctor", [])).toBe(true);
  });

  it("hasRole rejects missing / unknown roles even for an empty allow-list", () => {
    expect(hasRole(null, [])).toBe(false);
    expect(hasRole(undefined, ["admin"])).toBe(false);
    expect(hasRole("root" as never, [])).toBe(false);
  });

  it("isRole narrows strings", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("Admin")).toBe(false);
    expect(isRole(1)).toBe(false);
  });

  it("roleFromLabels picks the most privileged role label", () => {
    expect(roleFromLabels(["doctor"])).toBe("doctor");
    expect(roleFromLabels(["x", "doctor", "admin"])).toBe("admin");
    expect(roleFromLabels([])).toBeNull();
    expect(roleFromLabels(["patient"])).toBeNull();
    expect(roleFromLabels(null)).toBeNull();
  });
});

describe("admin route access", () => {
  it("lets every staff role into /admin", () => {
    for (const role of ROLES) {
      expect(canAccessAdminPath(role, "/admin")).toBe(true);
      expect(canAccessAdminPath(role, "/admin/appointments")).toBe(true);
    }
  });

  it("restricts management areas to admin", () => {
    expect(canAccessAdminPath("admin", "/admin/staff")).toBe(true);
    expect(canAccessAdminPath("frontdesk", "/admin/staff/new")).toBe(false);
    expect(canAccessAdminPath("doctor", "/admin/audit")).toBe(false);
    expect(allowedRolesForAdminPath("/admin/doctors")).toEqual(["admin"]);
  });

  it("does not treat lookalike prefixes as restricted or as admin", () => {
    expect(canAccessAdminPath("doctor", "/admin/staffing")).toBe(true);
    expect(allowedRolesForAdminPath("/administrator")).toEqual([]);
    expect(canAccessAdminPath(null, "/admin")).toBe(false);
  });

  it("extracts the patient id from a patient path", () => {
    expect(patientIdFromPath("/patients/abc123/register")).toBe("abc123");
    expect(patientIdFromPath("/patients/abc123")).toBe("abc123");
    expect(patientIdFromPath("/patients")).toBeNull();
    expect(patientIdFromPath("/other/abc")).toBeNull();
    expect(patientIdFromPath("/patients/%E0%A4%A")).toBeNull();
  });
});
