"use client";

import { useEffect, useState } from "react";

import { PreVisitSummary } from "@/components/ai/PreVisitSummary";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getVisitLink } from "@/lib/actions/telehealth.actions";
import { cn } from "@/lib/utils";

import { LocalTime } from "./LocalTime";
import type { AppointmentRow } from "./rows";
import { ui } from "./ui";

type VisitLink =
  | { state: "loading" }
  | { state: "ready"; url: string; opensAt: string }
  | { state: "unavailable"; message: string };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-12-semibold uppercase tracking-wide text-dark-700">
        {label}
      </dt>
      <dd className="text-14-regular mt-1 whitespace-pre-wrap break-words text-light-200">
        {children || "-"}
      </dd>
    </div>
  );
}

function VideoVisit({ appointmentId }: { appointmentId: string }) {
  const [link, setLink] = useState<VisitLink>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLink({ state: "loading" });
    getVisitLink(appointmentId)
      .then((result) => {
        if (cancelled) return;
        setLink(
          result.ok
            ? { state: "ready", ...result.data }
            : { state: "unavailable", message: result.error }
        );
      })
      .catch(() => {
        if (!cancelled) {
          setLink({ state: "unavailable", message: "Link unavailable" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  return (
    <section aria-labelledby="video-heading" className={ui.card}>
      <h3 id="video-heading" className="text-16-semibold text-blue-500">
        Video visit
      </h3>
      <div aria-live="polite" className="mt-2">
        {link.state === "loading" && (
          <p className={ui.hint}>Checking join link...</p>
        )}
        {link.state === "ready" && (
          <div className="space-y-2">
            <p className={ui.hint}>
              Opens <LocalTime iso={link.opensAt} />
            </p>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(ui.btnPrimary, ui.btnSm)}
            >
              Open video visit
            </a>
          </div>
        )}
        {link.state === "unavailable" && (
          <p className={ui.hint}>Join link not available: {link.message}</p>
        )}
      </div>
    </section>
  );
}

/**
 * Right-hand detail panel for one appointment (Radix dialog: focus trap,
 * Escape, focus return). Status history is derived from the fields the
 * appointment document carries; there is no separate history collection.
 */
export function AppointmentDetailDrawer({
  row,
  onOpenChange,
}: {
  row: AppointmentRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          ui.dialog,
          "left-auto right-0 top-0 h-full max-h-full w-full max-w-md translate-x-0 translate-y-0 rounded-none data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:rounded-none"
        )}
      >
        {row && (
          <>
            <DialogHeader>
              <DialogTitle className="text-white">{row.patientName}</DialogTitle>
              <DialogDescription>
                Dr. {row.physician} &middot; <LocalTime iso={row.schedule} />
              </DialogDescription>
            </DialogHeader>

            <dl className="grid gap-4">
              <Field label="Status">{row.status}</Field>
              <Field label="Reason">{row.reason}</Field>
              <Field label="Notes">{row.note}</Field>
              {row.status === "cancelled" && (
                <Field label="Cancellation">
                  {[row.cancellationReason, row.cancelledBy && `by ${row.cancelledBy}`]
                    .filter(Boolean)
                    .join(" - ")}
                </Field>
              )}
            </dl>

            <section aria-labelledby="contact-heading" className={ui.card}>
              <h3 id="contact-heading" className="text-16-semibold">
                Patient contact
              </h3>
              <dl className="mt-3 grid gap-3">
                <Field label="Email">
                  {row.patientEmail && (
                    <a className="text-green-500 underline" href={`mailto:${row.patientEmail}`}>
                      {row.patientEmail}
                    </a>
                  )}
                </Field>
                <Field label="Phone">
                  {row.patientPhone && (
                    <a className="text-green-500 underline" href={`tel:${row.patientPhone}`}>
                      {row.patientPhone}
                    </a>
                  )}
                </Field>
              </dl>
            </section>

            {row.visitType === "video" && <VideoVisit appointmentId={row.id} />}

            <PreVisitSummary appointmentId={row.id} />

            <section aria-labelledby="history-heading">
              <h3 id="history-heading" className="text-16-semibold">
                History
              </h3>
              <ol className="text-14-regular mt-2 space-y-1 border-l border-dark-500 pl-4">
                <li>
                  Requested <LocalTime iso={row.createdAt} />
                </li>
                {row.reminderSentAt && (
                  <li>
                    Reminder sent <LocalTime iso={row.reminderSentAt} />
                  </li>
                )}
                <li>
                  Last changed <LocalTime iso={row.updatedAt} />
                  {row.status === "cancelled" ? " (cancelled)" : ` (${row.status})`}
                </li>
              </ol>
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
