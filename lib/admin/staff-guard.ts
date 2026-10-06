// Pure guard rules for staff account changes (no I/O), so the "cannot lock
// yourself or the clinic out" logic is unit-testable.
import { isRole, type Role } from "@/lib/auth/roles";

export type StaffTarget = {
  id: string;
  /** Role label currently on the account, or null when it is not a staff user. */
  role: Role | null;
  /** True when the Appwrite user is disabled (blocked). */
  blocked: boolean;
};

export type StaffChange =
  | { type: "set_role"; role: Role }
  | { type: "disable" }
  | { type: "enable" }
  | { type: "reset_password" };

export type GuardResult = { ok: true } | { ok: false; error: string };

const deny = (error: string): GuardResult => ({ ok: false, error });

/**
 * `activeAdminIds` = ids of every admin account that is currently enabled.
 * The rules:
 *  - only existing staff accounts can be managed (never promotes a patient);
 *  - you cannot change your own role or disable yourself;
 *  - the last enabled admin can be neither demoted nor disabled.
 */
export const checkStaffChange = ({
  actorId,
  target,
  change,
  activeAdminIds,
}: {
  actorId: string;
  target: StaffTarget;
  change: StaffChange;
  activeAdminIds: readonly string[];
}): GuardResult => {
  if (!target.role) return deny("That account is not a staff account");

  const isSelf = target.id === actorId;
  const isActiveAdmin =
    target.role === "admin" && !target.blocked && activeAdminIds.includes(target.id);
  const onlyAdmin = isActiveAdmin && activeAdminIds.length <= 1;

  switch (change.type) {
    case "set_role":
      if (!isRole(change.role)) return deny("Unknown role");
      if (isSelf) return deny("You cannot change your own role");
      if (change.role === target.role) return deny("Already has that role");
      if (onlyAdmin && change.role !== "admin") {
        return deny("Cannot demote the last admin");
      }
      return { ok: true };
    case "disable":
      if (isSelf) return deny("You cannot disable your own account");
      if (target.blocked) return deny("Account is already disabled");
      if (onlyAdmin) return deny("Cannot disable the last admin");
      return { ok: true };
    case "enable":
      if (!target.blocked) return deny("Account is already enabled");
      return { ok: true };
    case "reset_password":
      return { ok: true };
    default:
      return deny("Unknown change");
  }
};
