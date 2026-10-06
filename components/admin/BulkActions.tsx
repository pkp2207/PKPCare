"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  type BulkResult,
  bulkUpdateAppointments,
} from "@/lib/actions/admin.actions";

import { ui } from "./ui";

type Action = "confirm" | "cancel";

export function BulkActions({
  selectedIds,
  onDone,
}: {
  selectedIds: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [pending, startTransition] = useTransition();

  const count = selectedIds.length;
  const close = () => {
    setAction(null);
    setReason("");
    setError(null);
  };

  const run = () => {
    if (!action) return;
    if (action === "cancel" && reason.trim().length < 2) {
      setError("Enter a cancellation reason (at least 2 characters).");
      return;
    }
    setError(null);
    startTransition(async () => {
      const response = await bulkUpdateAppointments({
        ids: selectedIds,
        action,
        reason: action === "cancel" ? reason.trim() : undefined,
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult(response.data);
      close();
      onDone();
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div
        className={`${ui.card} flex flex-wrap items-center gap-3 py-3`}
        role="region"
        aria-label="Bulk actions"
      >
        <p className="text-14-medium">
          {count === 0 ? "Select appointments to act on them in bulk" : `${count} selected`}
        </p>
        <button
          type="button"
          className={`${ui.btnPrimary} ${ui.btnSm}`}
          disabled={count === 0}
          onClick={() => setAction("confirm")}
        >
          Confirm selected
        </button>
        <button
          type="button"
          className={`${ui.btnDanger} ${ui.btnSm}`}
          disabled={count === 0}
          onClick={() => setAction("cancel")}
        >
          Cancel selected
        </button>
      </div>

      {/* Live region: results are announced when they arrive. */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {result && (
          <div className={ui.card}>
            <p className="text-14-medium">
              {result.action === "confirm" ? "Confirmed" : "Cancelled"}{" "}
              {result.succeeded}; skipped {result.skipped}; failed {result.failed}.
            </p>
            {result.results.some((r) => r.status !== "ok") && (
              <ul className="text-14-regular mt-2 list-disc space-y-1 pl-5">
                {result.results
                  .filter((r) => r.status !== "ok")
                  .map((r) => (
                    <li key={r.id} className={r.status === "failed" ? "text-red-400" : "text-dark-700"}>
                      {r.patientName ?? r.id}: {r.status === "failed" ? "failed" : "skipped"}
                      {r.message ? ` (${r.message})` : ""}
                    </li>
                  ))}
              </ul>
            )}
            <button
              type="button"
              className={`${ui.btnGhost} ${ui.btnSm} mt-2`}
              onClick={() => setResult(null)}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      <AlertDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !pending) close();
        }}
      >
        <AlertDialogContent className="shad-alert-dialog text-light-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {action === "cancel" ? "Cancel" : "Confirm"} {count} appointment
              {count === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {action === "cancel"
                ? "Each patient is notified and the slot is released. This cannot be undone in bulk."
                : "Each patient is notified that the appointment is scheduled. Past or conflicting appointments are reported and skipped."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {action === "cancel" && (
            <div className="space-y-2">
              <label htmlFor="bulk-reason" className={ui.label}>
                Reason for cancellation (sent to patients)
              </label>
              <textarea
                id="bulk-reason"
                className={ui.textarea}
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          )}
          {error && (
            <p role="alert" className={ui.error}>
              {error}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={pending}
              className={`${ui.btnSecondary} mt-0`}
            >
              Go back
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className={action === "cancel" ? ui.btnDanger : ui.btnPrimary}
              onClick={(event) => {
                event.preventDefault();
                run();
              }}
            >
              {pending ? "Working..." : action === "cancel" ? "Cancel appointments" : "Confirm appointments"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
