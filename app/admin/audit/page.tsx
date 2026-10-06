import Link from "next/link";

import { LocalTime } from "@/components/admin/LocalTime";
import { ui } from "@/components/admin/ui";
import { ErrorState } from "@/components/ErrorState";
import { listAuditLogs } from "@/lib/actions/compliance.actions";
import { parseDateParam } from "@/lib/admin/filters";
import { requireStaffPage } from "@/lib/auth/guards";

export const metadata = { title: "Audit log | PKPCare admin" };

const PAGE_SIZE = 25;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AuditPage({ searchParams }: SearchParamProps) {
  await requireStaffPage("admin");

  const action = one(searchParams.action)?.trim().slice(0, 64) || undefined;
  const actorId = one(searchParams.actorId)?.trim().slice(0, 64) || undefined;
  const from = parseDateParam(one(searchParams.from));
  const to = parseDateParam(one(searchParams.to));
  const rawPage = Number.parseInt(one(searchParams.page) ?? "", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1;

  const result = await listAuditLogs({
    page,
    pageSize: PAGE_SIZE,
    action,
    actorId,
    from: from ? `${from}T00:00:00.000Z` : undefined,
    to: to ? `${to}T23:59:59.999Z` : undefined,
  });

  if (!result.ok) {
    return (
      <ErrorState title="Couldn't load the audit log" message={result.error} href="/admin/audit" linkLabel="Try again" />
    );
  }

  const { logs, total } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (actorId) params.set("actorId", actorId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (p > 1) params.set("page", String(p));
    const q = params.toString();
    return q ? `/admin/audit?${q}` : "/admin/audit";
  };

  return (
    <>
      <section className="space-y-2">
        <h1 className="header">Audit log</h1>
        <p className="text-dark-700">
          Who did what, when. No patient data is stored here. Viewing this page is itself logged.
        </p>
      </section>

      <form method="get" action="/admin/audit" role="search" aria-label="Filter audit log" className={`${ui.card} grid gap-4 sm:grid-cols-2 lg:grid-cols-5`}>
        <div className="space-y-1">
          <label htmlFor="a-action" className={ui.label}>Action (exact)</label>
          <input id="a-action" name="action" defaultValue={action ?? ""} className={ui.input} placeholder="appointment.cancel" />
        </div>
        <div className="space-y-1">
          <label htmlFor="a-actor" className={ui.label}>Actor id</label>
          <input id="a-actor" name="actorId" defaultValue={actorId ?? ""} className={ui.input} />
        </div>
        <div className="space-y-1">
          <label htmlFor="a-from" className={ui.label}>From (UTC)</label>
          <input id="a-from" name="from" type="date" defaultValue={from ?? ""} className={ui.input} />
        </div>
        <div className="space-y-1">
          <label htmlFor="a-to" className={ui.label}>To (UTC)</label>
          <input id="a-to" name="to" type="date" defaultValue={to ?? ""} className={ui.input} />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className={ui.btnPrimary}>Apply</button>
          {(action || actorId || from || to) && (
            <Link href="/admin/audit" className={ui.btnSecondary}>Clear</Link>
          )}
        </div>
      </form>

      <div className={ui.tableWrap}>
        <table className="w-full min-w-[900px] text-sm">
          <caption className="sr-only">Audit log entries, newest first</caption>
          <thead className="bg-dark-200">
            <tr>
              {["Time", "Actor", "Action", "Resource", "Outcome", "Details"].map((h) => (
                <th key={h} scope="col" className={ui.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={6} className={`${ui.td} text-center text-dark-700`}>No entries.</td></tr>
            )}
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-dark-400">
                <td className={ui.td}><LocalTime iso={log.createdAt} /></td>
                <td className={ui.td}>
                  {log.actorRole}
                  <span className="block font-mono text-xs text-dark-700">{log.actorId ?? "-"}</span>
                </td>
                <td className={ui.td}>{log.action}</td>
                <td className={ui.td}>
                  {log.resource}
                  {log.resourceId && <span className="block font-mono text-xs text-dark-700">{log.resourceId}</span>}
                </td>
                <td className={`${ui.td} ${log.outcome === "success" ? "" : "text-red-400"}`}>{log.outcome}</td>
                <td className={`${ui.td} font-mono text-xs`}>{log.meta ? JSON.stringify(log.meta) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Pagination" className="flex items-center justify-between">
        {page > 1 ? (
          <Link href={href(page - 1)} rel="prev" className={`${ui.btnSecondary} ${ui.btnSm}`}>Previous</Link>
        ) : (
          <span className={`${ui.btnSecondary} ${ui.btnSm} opacity-50`} aria-disabled="true">Previous</span>
        )}
        <p className="text-14-regular text-dark-700" aria-live="polite">
          Page {page} of {totalPages} &middot; {total} entries
        </p>
        {page < totalPages ? (
          <Link href={href(page + 1)} rel="next" className={`${ui.btnSecondary} ${ui.btnSm}`}>Next</Link>
        ) : (
          <span className={`${ui.btnSecondary} ${ui.btnSm} opacity-50`} aria-disabled="true">Next</span>
        )}
      </nav>
    </>
  );
}
