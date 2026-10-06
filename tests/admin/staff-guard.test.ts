import { describe, expect, it } from "vitest";

import { generatePassword } from "@/lib/admin/password";
import { checkStaffChange, type StaffTarget } from "@/lib/admin/staff-guard";

const admin = (id: string, blocked = false): StaffTarget => ({ id, role: "admin", blocked });

describe("checkStaffChange", () => {
  it("rejects non-staff targets", () => {
    const r = checkStaffChange({
      actorId: "a",
      target: { id: "p", role: null, blocked: false },
      change: { type: "set_role", role: "admin" },
      activeAdminIds: ["a"],
    });
    expect(r).toEqual({ ok: false, error: "That account is not a staff account" });
  });

  it("blocks self role change and self disable", () => {
    const base = { actorId: "a", target: admin("a"), activeAdminIds: ["a", "b"] };
    expect(checkStaffChange({ ...base, change: { type: "set_role", role: "doctor" } }).ok).toBe(false);
    expect(checkStaffChange({ ...base, change: { type: "disable" } }).ok).toBe(false);
  });

  it("blocks demoting or disabling the last active admin", () => {
    const base = { actorId: "legacy", target: admin("a"), activeAdminIds: ["a"] };
    expect(checkStaffChange({ ...base, change: { type: "set_role", role: "frontdesk" } })).toMatchObject({ ok: false, error: /last admin/ });
    expect(checkStaffChange({ ...base, change: { type: "disable" } })).toMatchObject({ ok: false, error: /last admin/ });
  });

  it("allows it when another active admin exists", () => {
    const base = { actorId: "a", target: admin("b"), activeAdminIds: ["a", "b"] };
    expect(checkStaffChange({ ...base, change: { type: "set_role", role: "frontdesk" } }).ok).toBe(true);
    expect(checkStaffChange({ ...base, change: { type: "disable" } }).ok).toBe(true);
  });

  it("a blocked admin does not count as the last one and can be re-enabled", () => {
    const target = admin("b", true);
    expect(checkStaffChange({ actorId: "a", target, change: { type: "enable" }, activeAdminIds: ["a"] }).ok).toBe(true);
    expect(checkStaffChange({ actorId: "a", target, change: { type: "disable" }, activeAdminIds: ["a"] }).ok).toBe(false);
  });

  it("allows promoting to admin and no-op checks", () => {
    const t: StaffTarget = { id: "d", role: "doctor", blocked: false };
    expect(checkStaffChange({ actorId: "a", target: t, change: { type: "set_role", role: "admin" }, activeAdminIds: ["a"] }).ok).toBe(true);
    expect(checkStaffChange({ actorId: "a", target: t, change: { type: "set_role", role: "doctor" }, activeAdminIds: ["a"] }).ok).toBe(false);
    expect(checkStaffChange({ actorId: "a", target: t, change: { type: "enable" }, activeAdminIds: ["a"] }).ok).toBe(false);
    expect(checkStaffChange({ actorId: "a", target: t, change: { type: "reset_password" }, activeAdminIds: ["a"] }).ok).toBe(true);
  });
});

describe("generatePassword", () => {
  it("is long, varied and random", () => {
    const a = generatePassword();
    expect(a).toHaveLength(24);
    expect(a).toMatch(/[a-z]/);
    expect(a).toMatch(/[A-Z]/);
    expect(a).toMatch(/[0-9]/);
    expect(a).toMatch(/[^a-zA-Z0-9]/);
    expect(generatePassword()).not.toBe(a);
  });
});
