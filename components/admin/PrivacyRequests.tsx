"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeletionRequestWithName } from "@/lib/actions/admin.actions";
import { resolveDeletionRequest } from "@/lib/actions/compliance.actions";
import { cn } from "@/lib/utils";

import { LocalTime } from "./LocalTime";
import { ui } from "./ui";

type Decision = "approved" | "rejected";

/** What approval does, from docs/compliance.md "Erasure semantics". */
const DELETED = [
  "Uploaded ID document file(s)",
  "The patient record (profile, contact, medical history, insurance)",
  "The patient's login account",
  "Personal details on their appointments (reason, notes, user and patient link)",
];
const RETAINED = [
  "Anonymised appointment records (date, status, doctor) for statistics",
  "Audit log entries",
  "Consent history (evidence of what was consented to)",
  "This deletion request record",
  "Backups and third-party copies (email/SMS logs, error reports) are not touched",
];

export function PrivacyRequests({ requests }: { requests: DeletionRequestWithName[] }) {
  const router = useRouter();
  const [active, setActive] = useState<{ request: DeletionRequestWithName; decision: Decision } | null>(null);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const resolved = requests.filter((r) => r.status !== "pending");

  const close = () => {
    setActive(null);
    setTyped("");
    setNote("");
    setError(null);
  };

  const canSubmit =
    active !== null &&
    (active.decision === "rejected" || typed.trim() === active.request.id);

  const submit = () => {
    if (!active || !canSubmit) return;
    startTransition(async () => {
      setError(null);
      const result = await resolveDeletionRequest({
        id: active.request.id,
        decision: active.decision,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        active.decision === "approved"
          ? "Request approved and the data was erased."
          : "Request rejected."
      );
      close();
      router.refresh();
    });
  };

  return (
    <div className="space-y-8">
      <div role="status" aria-live="polite">
        {notice && <p className="text-14-regular text-green-500">{notice}</p>}
      </div>

      <section aria-labelledby="pending-h" className="space-y-3">
        <h2 id="pending-h" className="sub-header">Pending ({pendingRequests.length})</h2>
        {pendingRequests.length === 0 && <p className="text-dark-700">No pending requests.</p>}
        <ul className="space-y-3">
          {pendingRequests.map((r) => (
            <li key={r.id} className={ui.card}>
              <p className="text-16-semibold">{r.patientName ?? "Unknown patient"}</p>
              <p className="text-12-regular text-dark-700">
                Request {r.id} &middot; received <LocalTime iso={r.createdAt} />
              </p>
              {r.reason && <p className="text-14-regular mt-2">Reason given: {r.reason}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={`${ui.btnDanger} ${ui.btnSm}`} onClick={() => setActive({ request: r, decision: "approved" })}>
                  Approve and erase<span className="sr-only"> request {r.id}</span>
                </button>
                <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => setActive({ request: r, decision: "rejected" })}>
                  Reject<span className="sr-only"> request {r.id}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="resolved-h" className="space-y-3">
        <h2 id="resolved-h" className="sub-header">Resolved ({resolved.length})</h2>
        {resolved.length > 0 && (
          <div className={ui.tableWrap}>
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Resolved privacy requests</caption>
              <thead className="bg-dark-200">
                <tr>
                  <th scope="col" className={ui.th}>Request</th>
                  <th scope="col" className={ui.th}>Decision</th>
                  <th scope="col" className={ui.th}>Resolved</th>
                  <th scope="col" className={ui.th}>Note</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((r) => (
                  <tr key={r.id} className="border-t border-dark-400">
                    <td className={`${ui.td} font-mono text-xs`}>{r.id}</td>
                    <td className={`${ui.td} capitalize`}>{r.status}</td>
                    <td className={ui.td}>{r.resolvedAt ? <LocalTime iso={r.resolvedAt} /> : "-"}</td>
                    <td className={ui.td}>{r.note ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={active !== null} onOpenChange={(open) => !open && !pending && close()}>
        <DialogContent className={cn(ui.dialog, "sm:max-w-xl")}>
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="text-white">
                  {active.decision === "approved" ? "Approve and permanently erase" : "Reject request"}
                </DialogTitle>
                <DialogDescription>
                  {active.request.patientName ?? "Unknown patient"} &middot; request {active.request.id}
                </DialogDescription>
              </DialogHeader>

              {active.decision === "approved" && (
                <div className="space-y-4">
                  <p role="alert" className="text-14-medium rounded-md border border-red-500 p-3 text-red-400">
                    This cannot be undone. Confirm legal retention requirements first.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <h3 className="text-14-medium text-red-400">Deleted</h3>
                      <ul className="text-14-regular mt-1 list-disc space-y-1 pl-5">
                        {DELETED.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                    <div>
                      <h3 className="text-14-medium text-green-500">Retained</h3>
                      <ul className="text-14-regular mt-1 list-disc space-y-1 pl-5">
                        {RETAINED.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="confirm-id" className={ui.label}>
                      Type the request id <code className="text-white">{active.request.id}</code> to confirm
                    </label>
                    <input id="confirm-id" className={ui.input} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="resolve-note" className={ui.label}>Note (optional, kept with the request)</label>
                <textarea id="resolve-note" className={ui.textarea} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {error && <p role="alert" className={ui.error}>{error}</p>}

              <div className="flex justify-end gap-2">
                <button type="button" className={ui.btnSecondary} disabled={pending} onClick={close}>Go back</button>
                <button
                  type="button"
                  className={active.decision === "approved" ? ui.btnDanger : ui.btnPrimary}
                  disabled={!canSubmit || pending}
                  onClick={submit}
                >
                  {pending ? "Working..." : active.decision === "approved" ? "Erase data permanently" : "Reject request"}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
