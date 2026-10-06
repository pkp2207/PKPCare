"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createStaff,
  disableStaff,
  enableStaff,
  resetStaffPassword,
  setStaffRole,
  type StaffMember,
} from "@/lib/actions/admin.actions";
import { ROLES, type Role } from "@/lib/auth/roles";

import { LocalTime } from "./LocalTime";
import { ROLE_LABELS } from "./nav";
import { ui } from "./ui";

type Secret = { who: string; password: string };

export function StaffManager({
  staff,
  currentUserId,
}: {
  staff: StaffMember[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("frontdesk");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const result = await fn();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else setNotice(done);
      router.refresh();
    });

  const create = () =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      setSecret(null);
      const result = await createStaff({ name, email, role });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSecret({ who: result.data.staff.email, password: result.data.password });
      setName("");
      setEmail("");
      router.refresh();
    });

  const reset = (member: StaffMember) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      setSecret(null);
      const result = await resetStaffPassword({ userId: member.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSecret({ who: member.email, password: result.data.password });
    });

  return (
    <div className="space-y-6">
      <p className={`${ui.card} text-14-regular`} role="note">
        Role changes apply at that person&apos;s <strong>next login</strong>: the
        role is stored in their 8-hour session. Disabling an account blocks new
        logins, but a session that is already open keeps working until it
        expires. The last admin and your own account cannot be demoted or
        disabled.
      </p>

      <div role="status" aria-live="polite">
        {notice && <p className="text-14-regular text-green-500">{notice}</p>}
      </div>
      {error && <p role="alert" className={ui.error}>{error}</p>}

      {secret && (
        <div className={`${ui.card} border-green-500`} role="alert">
          <h2 className="text-16-semibold">One-time password for {secret.who}</h2>
          <p className="text-14-regular mt-1 text-dark-700">
            Shown once and not stored. Hand it over securely; it cannot be shown again.
          </p>
          <p className="mt-3 select-all break-all rounded-md bg-dark-300 p-3 font-mono text-sm text-white">
            {secret.password}
          </p>
          <button type="button" className={`${ui.btnSecondary} ${ui.btnSm} mt-3`} onClick={() => setSecret(null)}>
            I have saved it
          </button>
        </div>
      )}

      <section aria-labelledby="add-staff" className={ui.card}>
        <h2 id="add-staff" className="sub-header mb-4">Add staff member</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="s-name" className={ui.label}>Full name</label>
            <input id="s-name" className={ui.input} value={name} maxLength={128} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="s-email" className={ui.label}>Email</label>
            <input id="s-email" type="email" className={ui.input} value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="s-role" className={ui.label}>Role</label>
            <select id="s-role" className={ui.input} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
        </div>
        <button type="button" className={`${ui.btnPrimary} mt-4`} disabled={pending || !name || !email} onClick={create}>
          Create account
        </button>
      </section>

      <div className={ui.tableWrap}>
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Staff accounts</caption>
          <thead className="bg-dark-200">
            <tr>
              <th scope="col" className={ui.th}>Name</th>
              <th scope="col" className={ui.th}>Role</th>
              <th scope="col" className={ui.th}>Status</th>
              <th scope="col" className={ui.th}>Last access</th>
              <th scope="col" className={ui.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => {
              const self = member.id === currentUserId;
              return (
                <tr key={member.id} className="border-t border-dark-400">
                  <th scope="row" className={`${ui.td} text-left font-medium`}>
                    {member.name}
                    {self && <span className="text-12-regular text-dark-700"> (you)</span>}
                    <span className="text-12-regular block text-dark-700">{member.email}</span>
                  </th>
                  <td className={ui.td}>
                    <label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.name}</label>
                    <select
                      id={`role-${member.id}`}
                      className={`${ui.input} h-10 w-36`}
                      value={member.role ?? ""}
                      disabled={pending || self}
                      onChange={(e) =>
                        run(
                          () => setStaffRole({ userId: member.id, role: e.target.value as Role }),
                          `Role updated for ${member.name}. It applies at their next login.`
                        )
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </td>
                  <td className={ui.td}>
                    {member.blocked ? "Disabled" : "Active"}
                    {member.mfa ? " - MFA" : ""}
                  </td>
                  <td className={ui.td}>
                    {member.lastAccess ? <LocalTime iso={member.lastAccess} /> : "Never"}
                  </td>
                  <td className={ui.td}>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} disabled={pending} onClick={() => reset(member)}>
                        New password<span className="sr-only"> for {member.name}</span>
                      </button>
                      {member.blocked ? (
                        <button type="button" className={`${ui.btnGhost} ${ui.btnSm} text-green-500`} disabled={pending}
                          onClick={() => run(() => enableStaff({ userId: member.id }), `${member.name} enabled.`)}>
                          Enable<span className="sr-only"> {member.name}</span>
                        </button>
                      ) : (
                        <button type="button" className={`${ui.btnGhost} ${ui.btnSm} text-red-500`} disabled={pending || self}
                          onClick={() => {
                            if (window.confirm(`Disable ${member.name}? They will not be able to sign in.`)) {
                              run(() => disableStaff({ userId: member.id }), `${member.name} disabled.`);
                            }
                          }}>
                          Disable<span className="sr-only"> {member.name}</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
